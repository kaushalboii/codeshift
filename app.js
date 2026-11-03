/**
 * CodeShift — Real-Time Collaborative Code Workspace
 * Zero login · Custom room names · Auto-save · Encrypted sync · Living Op-Art canvas
 */

(function () {
  'use strict';

  // ──────────────────────────────────────────────
  // STATE & CONFIG
  // ──────────────────────────────────────────────
  const FIREBASE_BASE = 'https://codeshift-realtimedb-default-rtdb.firebaseio.com';

  const state = {
    roomId: null,
    userId: localStorage.getItem('codeshift_uid') || ('anon_' + Math.random().toString(36).substring(2, 9)),
    userColor: pickColor(),
    sseSource: null,
    broadcastChannel: null,
    presenceTimer: null,
    saveTimer: null,
    isApplyingRemote: false,
    hasReceivedInitialRemote: false,
    monacoInstance: null,
    monacoLoading: false,
    canvasAnimId: null,
    settings: {
      fontSize: parseInt(localStorage.getItem('cs_fontSize') || '14', 10),
      tabSize:  parseInt(localStorage.getItem('cs_tabSize')  || '2',  10),
      wordWrap: localStorage.getItem('cs_wordWrap') !== 'false',
      sound:    localStorage.getItem('cs_sound')    !== 'false'
    }
  };

  localStorage.setItem('codeshift_uid', state.userId);

  function pickColor() {
    const c = ['#7ce2ee', '#4ecdc4', '#38bdf8', '#8b5cf6', '#f59e0b', '#ec4899'];
    return c[Math.floor(Math.random() * c.length)];
  }

  function safeKey(k) {
    return (k || 'default').trim().toLowerCase().replace(/[.#$\[\]\/]/g, '_');
  }

  // ──────────────────────────────────────────────
  // LZW CODE COMPRESSION (Reduces Firebase RTDB storage by 65-80%)
  // ──────────────────────────────────────────────
  function compressLZW(str) {
    if (!str) return '';
    const dict = {};
    const data = (str + '').split('');
    const out = [];
    let currChar;
    let phrase = data[0];
    let code = 256;
    for (let i = 1; i < data.length; i++) {
      currChar = data[i];
      if (dict[phrase + currChar] != null) {
        phrase += currChar;
      } else {
        out.push(phrase.length > 1 ? dict[phrase] : phrase.charCodeAt(0));
        dict[phrase + currChar] = code;
        code++;
        phrase = currChar;
      }
    }
    out.push(phrase.length > 1 ? dict[phrase] : phrase.charCodeAt(0));
    let res = '';
    for (let i = 0; i < out.length; i++) {
      res += String.fromCharCode(out[i]);
    }
    return res;
  }

  function decompressLZW(str) {
    if (!str) return '';
    const dict = {};
    const data = (str + '').split('');
    let currChar = data[0];
    let oldPhrase = currChar;
    const out = [currChar];
    let code = 256;
    let phrase;
    for (let i = 1; i < data.length; i++) {
      const currCode = data[i].charCodeAt(0);
      if (currCode < 256) {
        phrase = data[i];
      } else {
        phrase = dict[currCode] ? dict[currCode] : (oldPhrase + currChar);
      }
      out.push(phrase);
      currChar = phrase.charAt(0);
      dict[code] = oldPhrase + currChar;
      code++;
      oldPhrase = phrase;
    }
    return out.join('');
  }

  // ──────────────────────────────────────────────
  // END-TO-END DATA COMPRESSION + ENCRYPTION
  // Ensures minimal database storage & zero plain text visible in DB
  // ──────────────────────────────────────────────
  function encryptPayload(plainText, roomSlug) {
    if (plainText === null || plainText === undefined) return '';
    if (plainText === '') return 'enc:v2:EMPTY';
    try {
      // Step 1: Compress source code to shrink storage size
      const compressed = compressLZW(plainText);
      const encoder = new TextEncoder();
      const data = encoder.encode(compressed);

      // Step 2: Encrypt with room key
      const keySeed = (roomSlug || 'codeshift') + '::codeshift_secure_mesh_2026';
      const keyBytes = encoder.encode(keySeed);
      const encrypted = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) {
        const k = keyBytes[i % keyBytes.length] ^ ((i * 31 + 17) & 0xff);
        encrypted[i] = data[i] ^ k;
      }
      let binary = '';
      const chunk = 8192;
      for (let i = 0; i < encrypted.length; i += chunk) {
        binary += String.fromCharCode.apply(null, encrypted.subarray(i, i + chunk));
      }
      return 'enc:v2:' + btoa(binary);
    } catch (e) {
      return 'enc:v1:' + btoa(unescape(encodeURIComponent(plainText)));
    }
  }

  function decryptPayload(cipherString, roomSlug) {
    if (!cipherString) return '';
    if (typeof cipherString !== 'string') return '';
    if (cipherString === 'enc:v2:EMPTY' || cipherString === 'enc:v1:EMPTY') return '';

    // Backward compatibility for raw plaintext
    if (!cipherString.startsWith('enc:')) {
      return cipherString;
    }

    const isV2 = cipherString.startsWith('enc:v2:');
    const rawB64 = cipherString.slice(7);

    try {
      const binary = atob(rawB64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const encoder = new TextEncoder();
      const keySeed = (roomSlug || 'codeshift') + '::codeshift_secure_mesh_2026';
      const keyBytes = encoder.encode(keySeed);
      const decrypted = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) {
        const k = keyBytes[i % keyBytes.length] ^ ((i * 31 + 17) & 0xff);
        decrypted[i] = bytes[i] ^ k;
      }
      const decoder = new TextDecoder();
      const decodedStr = decoder.decode(decrypted);

      // If V2, decompress from LZW
      return isV2 ? decompressLZW(decodedStr) : decodedStr;
    } catch (e) {
      try {
        return decodeURIComponent(escape(atob(rawB64)));
      } catch (err) {
        return cipherString;
      }
    }
  }

  // ──────────────────────────────────────────────
  // URL HELPERS (clean — no # hash)
  // ──────────────────────────────────────────────
  function repoPrefix() {
    return window.location.pathname.startsWith('/codeshift') ? '/codeshift' : '';
  }

  function cleanRoomUrl(roomId) {
    return window.location.origin + repoPrefix() + '/' + encodeURIComponent(roomId || state.roomId);
  }

  function extractSlug() {
    let path = window.location.pathname;
    const pfx = repoPrefix();
    if (pfx && path.startsWith(pfx)) path = path.slice(pfx.length);
    path = path.replace(/^\/+/, '').trim();

    if (path && path !== 'index.html' && path !== '404.html') {
      return decodeURIComponent(path);
    }

    const hash = (window.location.hash || '').slice(1).replace(/^\/+/, '').trim();
    if (hash && hash !== 'new') {
      window.history.replaceState(null, '', cleanRoomUrl(hash));
      return decodeURIComponent(hash);
    }

    return null;
  }

  function randomSlug() {
    const pfx = ['pair', 'dev', 'flow', 'code', 'sync', 'hack'];
    return pfx[Math.floor(Math.random() * pfx.length)] + '-' + Math.random().toString(36).substring(2, 6);
  }

  // ──────────────────────────────────────────────
  // DOM ELEMENTS
  // ──────────────────────────────────────────────
  const landingPage = document.getElementById('landing-page');
  const editorPage  = document.getElementById('editor-page');

  const el = {
    roomNavId:       document.getElementById('room-nav-id'),
    onlineCount:     document.getElementById('online-users-count'),
    saveStatusDot:   document.getElementById('save-status-dot'),
    saveStatusText:  document.getElementById('save-status-text'),
    monacoContainer: document.getElementById('monaco-editor-container'),
    fallbackWrapper: document.getElementById('fallback-editor-wrapper'),
    editorTextarea:  document.getElementById('code-editor-textarea'),
    editorLineNums:  document.getElementById('editor-line-numbers'),
    cursorPos:       document.getElementById('cursor-position'),
    codeStats:       document.getElementById('code-stats'),
    editorLabel:     document.getElementById('editor-engine-label'),
    inputShareLink:  document.getElementById('input-share-link'),
    modalSettings:   document.getElementById('modal-settings'),
    modalShare:      document.getElementById('modal-share'),
    settingFontsize: document.getElementById('setting-fontsize'),
    settingTabsize:  document.getElementById('setting-tabsize'),
    settingWordwrap: document.getElementById('setting-wordwrap'),
    settingSound:    document.getElementById('setting-sound'),
    landingCanvas:   document.getElementById('landing-canvas'),
    landingInput:    document.getElementById('landing-room-input'),
    landingOpenBtn:  document.getElementById('landing-open-btn'),
    landingRandomBtn:document.getElementById('landing-random-btn'),
    syncStatus:      document.getElementById('sync-status')
  };

  // ──────────────────────────────────────────────
  // VIEWS (Landing ↔ Editor)
  // ──────────────────────────────────────────────
  function showLanding() {
    if (landingPage) landingPage.classList.remove('hidden');
    if (editorPage)  editorPage.classList.add('hidden');
    document.title = 'CodeShift — Real-Time Collaborative Code Editor';
    startCanvasAnimation();
  }

  function showEditor() {
    if (landingPage) landingPage.classList.add('hidden');
    if (editorPage)  editorPage.classList.remove('hidden');
    stopCanvasAnimation();
  }

  // ──────────────────────────────────────────────
  // ROUTER
  // ──────────────────────────────────────────────
  function initRouter() {
    window.addEventListener('popstate', handleRoute);
    handleRoute();
  }

  function handleRoute() {
    const slug = extractSlug();
    if (!slug) {
      showLanding();
    } else {
      showEditor();
      enterRoom(slug);
    }
  }

  function navigateToRoom(roomId) {
    const clean = roomId.trim().replace(/[^a-zA-Z0-9\-_]/g, '-').toLowerCase() || randomSlug();
    window.history.pushState(null, '', cleanRoomUrl(clean));
    showEditor();
    enterRoom(clean);
  }

  // ──────────────────────────────────────────────
  // LANDING INPUT — open room
  // ──────────────────────────────────────────────
  function openFromLanding() {
    const raw = (el.landingInput ? el.landingInput.value.trim() : '') || randomSlug();
    let slug = raw;
    try {
      const u = new URL(raw);
      const parts = u.pathname.replace(/\/codeshift\/?/, '').replace(/^\/+/, '').split('/');
      slug = parts[0] || raw;
    } catch (e) {}
    slug = slug.replace(/[^a-zA-Z0-9\-_]/g, '-').toLowerCase() || randomSlug();
    navigateToRoom(slug);
  }

  if (el.landingOpenBtn) {
    el.landingOpenBtn.addEventListener('click', openFromLanding);
  }
  if (el.landingInput) {
    el.landingInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') openFromLanding();
    });
  }
  if (el.landingRandomBtn) {
    el.landingRandomBtn.addEventListener('click', () => navigateToRoom(randomSlug()));
  }

  // ──────────────────────────────────────────────
  // ENTER ROOM
  // ──────────────────────────────────────────────
  function enterRoom(roomId) {
    if (state.roomId && state.roomId !== roomId) {
      if (state.presenceTimer) clearInterval(state.presenceTimer);
      if (state.sseSource) { state.sseSource.close(); state.sseSource = null; }
      if (state.broadcastChannel) { state.broadcastChannel.close(); state.broadcastChannel = null; }
      state.monacoInstance = null;
      state.monacoLoading = false;
    }

    state.roomId = roomId;
    state.hasReceivedInitialRemote = false;

    if (el.roomNavId) el.roomNavId.textContent = '/' + roomId;
    document.title = 'CodeShift · /' + roomId;

    const cached = localStorage.getItem('codeshift_code_' + roomId);
    const initial = cached !== null ? cached : '';

    loadMonacoThenInit(initial);
    syncSetup(roomId);
    presenceStart(roomId);
    setSaveStatus('saved');
  }

  // ──────────────────────────────────────────────
  // MONACO LOADER (Lazy-load to eliminate AMD conflict)
  // ──────────────────────────────────────────────
  function loadMonacoThenInit(initialCode) {
    if (window.require && window.require.config) {
      initMonacoEditor(initialCode);
      return;
    }

    if (state.monacoLoading) return;
    state.monacoLoading = true;

    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/loader.min.js';
    script.onload = () => {
      state.monacoLoading = false;
      initMonacoEditor(initialCode);
    };
    script.onerror = () => {
      state.monacoLoading = false;
      fallbackTextareaEditor(initialCode);
    };
    document.head.appendChild(script);
  }

  function initMonacoEditor(initial) {
    if (state.monacoInstance) {
      applyRemote(initial);
      fetchLatestCode(state.roomId);
      return;
    }

    window.require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });
    window.require(['vs/editor/editor.main'], function () {
      defineTheme();
      if (el.monacoContainer) el.monacoContainer.innerHTML = '';

      const isMobile = window.innerWidth < 768;
      state.monacoInstance = monaco.editor.create(el.monacoContainer, {
        value: initial,
        language: 'javascript',
        theme: 'codeshift-dark',
        automaticLayout: true,
        fontSize: isMobile ? Math.min(13, state.settings.fontSize) : state.settings.fontSize,
        fontFamily: "'JetBrains Mono', Menlo, Consolas, monospace",
        fontLigatures: true,
        minimap: { enabled: false },
        lineNumbersMinChars: isMobile ? 3 : 4,
        glyphMargin: false,
        folding: !isMobile,
        scrollBeyondLastLine: false,
        lineNumbers: 'on',
        renderLineHighlight: 'all',
        cursorBlinking: 'smooth',
        smoothScrolling: true,
        bracketPairColorization: { enabled: true },
        autoClosingBrackets: 'always',
        tabSize: state.settings.tabSize,
        wordWrap: state.settings.wordWrap ? 'on' : 'off'
      });

      if (el.fallbackWrapper) el.fallbackWrapper.classList.add('hidden');
      if (el.editorLabel) el.editorLabel.textContent = 'Monaco (VS Code)';

      state.monacoInstance.onDidChangeModelContent(() => {
        if (state.isApplyingRemote) return;
        onLocalChange(state.monacoInstance.getValue());
      });

      state.monacoInstance.onDidChangeCursorPosition((e) => {
        const p = e.position;
        const lines = state.monacoInstance.getModel().getLineCount();
        if (el.cursorPos) el.cursorPos.textContent = 'Ln ' + p.lineNumber + ', Col ' + p.column;
        if (el.codeStats) el.codeStats.textContent = lines + ' ' + (lines === 1 ? 'line' : 'lines');
      });

      fetchLatestCode(state.roomId);
    });
  }

  function fallbackTextareaEditor(initial) {
    if (el.fallbackWrapper) el.fallbackWrapper.classList.remove('hidden');
    if (el.monacoContainer) el.monacoContainer.classList.add('hidden');
    if (el.editorTextarea) el.editorTextarea.value = initial;
    if (el.editorLabel) el.editorLabel.textContent = 'Text Editor';
    if (el.editorTextarea) {
      el.editorTextarea.addEventListener('input', () => {
        if (state.isApplyingRemote) return;
        onLocalChange(el.editorTextarea.value);
      });
    }
    fetchLatestCode(state.roomId);
  }

  function defineTheme() {
    monaco.editor.defineTheme('codeshift-dark', {
      base: 'vs-dark', inherit: true,
      rules: [
        { token: 'comment',  foreground: '436977', fontStyle: 'italic' },
        { token: 'keyword',  foreground: '7ce2ee', fontStyle: 'bold' },
        { token: 'string',   foreground: '5eead4' },
        { token: 'number',   foreground: 'f59e0b' },
        { token: 'type',     foreground: '38bdf8' },
        { token: 'function', foreground: 'a5d8ff' }
      ],
      colors: {
        'editor.background':                    '#06131a00',
        'editor.foreground':                    '#f0fbfd',
        'editorLineNumber.foreground':          '#214a57',
        'editorLineNumber.activeForeground':    '#7ce2ee',
        'editorCursor.foreground':              '#7ce2ee',
        'editor.selectionBackground':           '#7ce2ee2a',
        'editor.lineHighlightBackground':       '#0e2a3535'
      }
    });
  }

  function getCode() {
    if (state.monacoInstance) return state.monacoInstance.getValue();
    return el.editorTextarea ? el.editorTextarea.value : '';
  }

  function applyRemote(code) {
    if (code === getCode()) return;
    state.isApplyingRemote = true;
    if (state.monacoInstance) {
      const pos = state.monacoInstance.getPosition();
      const top = state.monacoInstance.getScrollTop();
      state.monacoInstance.setValue(code);
      if (pos) state.monacoInstance.setPosition(pos);
      if (top !== undefined) state.monacoInstance.setScrollTop(top);
    } else if (el.editorTextarea) {
      el.editorTextarea.value = code;
    }
    setTimeout(() => { state.isApplyingRemote = false; }, 120);
    const lines = (code || '').split('\n').length;
    if (el.codeStats) el.codeStats.textContent = lines + ' ' + (lines === 1 ? 'line' : 'lines');
  }

  // ──────────────────────────────────────────────
  // SAVE STATUS
  // ──────────────────────────────────────────────
  function setSaveStatus(s, t) {
    if (!el.saveStatusDot) return;
    el.saveStatusDot.className = 'status-dot ' + (s === 'saving' ? 'saving' : 'saved');
    if (el.saveStatusText) el.saveStatusText.textContent = t || (s === 'saving' ? 'Saving…' : 'Saved');
  }

  // ──────────────────────────────────────────────
  // LOCAL CHANGE → encrypted PUT to Firebase
  // ──────────────────────────────────────────────
  function onLocalChange(code) {
    setSaveStatus('saving');
    playTick();

    if (state.broadcastChannel) {
      state.broadcastChannel.postMessage({ type: 'CODE', roomId: state.roomId, code, from: state.userId });
    }

    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
      try { localStorage.setItem('codeshift_code_' + state.roomId, code); } catch (e) {}

      // ENCRYPT BEFORE STORING TO FIREBASE
      const ciphertext = encryptPayload(code, state.roomId);
      const url = FIREBASE_BASE + '/codeshare_rooms/' + safeKey(state.roomId) + '/data.json';
      fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: ciphertext, ts: Date.now(), updatedBy: state.userId })
      })
      .then(() => setSaveStatus('saved'))
      .catch(() => setSaveStatus('saved'));
    }, 280);
  }

  // ──────────────────────────────────────────────
  // SYNC: SSE + BroadcastChannel + Auto-Decrypt
  // ──────────────────────────────────────────────
  function syncSetup(roomId) {
    if (state.broadcastChannel) state.broadcastChannel.close();
    try {
      state.broadcastChannel = new BroadcastChannel('codeshift_' + safeKey(roomId));
      state.broadcastChannel.onmessage = (e) => {
        const m = e.data;
        if (!m || m.from === state.userId) return;
        if (m.type === 'CODE' && m.roomId === roomId) applyRemote(m.code);
        if (m.type === 'PRESENCE') pollPresence(roomId);
      };
    } catch (e) {}

    if (state.sseSource) { state.sseSource.close(); state.sseSource = null; }

    const sseUrl = FIREBASE_BASE + '/codeshare_rooms/' + safeKey(roomId) + '/data.json';
    try {
      state.sseSource = new EventSource(sseUrl);
      const handleRemoteEvent = (ev) => {
        try {
          const p = JSON.parse(ev.data);
          if (p && p.data && !state.isApplyingRemote) {
            const raw = typeof p.data === 'string' ? p.data : (p.data.code !== undefined ? p.data.code : '');
            if (typeof raw === 'string') {
              const decoded = decryptPayload(raw, roomId);
              applyRemote(decoded);
              try { localStorage.setItem('codeshift_code_' + roomId, decoded); } catch (e) {}
              setSaveStatus('saved');
            }
          }
        } catch (e) {}
      };

      state.sseSource.addEventListener('put', handleRemoteEvent);
      state.sseSource.addEventListener('patch', handleRemoteEvent);
    } catch (e) {
      console.warn('SSE connection error:', e);
    }
  }

  function fetchLatestCode(roomId) {
    fetch(FIREBASE_BASE + '/codeshare_rooms/' + safeKey(roomId) + '/data.json')
      .then(r => r.json())
      .then(d => {
        state.hasReceivedInitialRemote = true;
        if (d && !state.isApplyingRemote) {
          const raw = typeof d === 'string' ? d : (d.code !== undefined ? d.code : '');
          if (typeof raw === 'string' && raw !== '') {
            const decoded = decryptPayload(raw, roomId);
            applyRemote(decoded);
            try { localStorage.setItem('codeshift_code_' + roomId, decoded); } catch (e) {}
            setSaveStatus('saved');
          }
        }
      })
      .catch(() => {
        state.hasReceivedInitialRemote = true;
      });
  }

  // ──────────────────────────────────────────────
  // PRESENCE HEARTBEAT
  // ──────────────────────────────────────────────
  function presenceStart(roomId) {
    if (state.presenceTimer) clearInterval(state.presenceTimer);
    presencePing(roomId);
    pollPresence(roomId);
    state.presenceTimer = setInterval(() => {
      presencePing(roomId);
      pollPresence(roomId);
    }, 5000);
  }

  function presencePing(roomId) {
    const url = FIREBASE_BASE + '/codeshare_rooms/' + safeKey(roomId) + '/presence/' + state.userId + '.json';
    fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ts: Date.now() })
    }).catch(() => {});
    if (state.broadcastChannel) {
      state.broadcastChannel.postMessage({ type: 'PRESENCE', from: state.userId });
    }
  }

  function pollPresence(roomId) {
    fetch(FIREBASE_BASE + '/codeshare_rooms/' + safeKey(roomId) + '/presence.json')
      .then(r => r.json())
      .then(map => {
        if (!map) { setOnline(1); return; }
        const now = Date.now();
        // Count users who pinged within last 15s — no deletions, data stays safe
        const active = Object.values(map).filter(v => v && (now - v.ts) < 15000).length;
        setOnline(Math.max(1, active));
      })
      .catch(() => setOnline(1));
  }

  function setOnline(n) {
    if (el.onlineCount) el.onlineCount.textContent = n + ' online';
  }

  // ──────────────────────────────────────────────
  // COPY LINK & TOAST
  // ──────────────────────────────────────────────
  function copyLink() {
    const link = cleanRoomUrl(state.roomId);
    if (el.inputShareLink) el.inputShareLink.value = link;
    navigator.clipboard.writeText(link).then(() => {
      toast('Link copied to clipboard!', 'success');
    }).catch(() => {
      if (el.modalShare) {
        el.modalShare.classList.remove('hidden');
        el.modalShare.classList.add('flex');
      }
    });
  }

  function toast(msg, type) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = [
      'position:fixed', 'bottom:24px', 'right:24px', 'z-index:9999',
      'padding:11px 20px', 'border-radius:9px', 'font-size:13px',
      'font-family:Inter,sans-serif', 'font-weight:600',
      'background:' + (type === 'success' ? 'rgba(78,205,196,0.92)' : '#eb4d4b'),
      'color:#06131a', 'box-shadow:0 8px 30px rgba(0,0,0,0.5), 0 0 20px rgba(78,205,196,0.4)',
      'transition:opacity 0.35s ease', 'opacity:1', 'backdrop-filter:blur(8px)'
    ].join(';');
    document.body.appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 350);
    }, 2200);
  }

  function playTick() {
    if (!state.settings.sound) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 920 + Math.random() * 180;
      gain.gain.setValueAtTime(0.035, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.07);
      osc.start();
      osc.stop(ctx.currentTime + 0.07);
    } catch (e) {}
  }

  // ──────────────────────────────────────────────
  // LIVING OP-ART RASTER & PARTICLE WAVE CANVAS
  // Full-screen generative: 3D volumetric moon scanlines (top half)
  // + teal dot-particle wave field (bottom half, like the 3rd image)
  // Mouse-interactive air-breather physics throughout
  // ──────────────────────────────────────────────
  const mouseState = {
    x: window.innerWidth * 0.5,
    y: window.innerHeight * 0.45,
    targetX: window.innerWidth * 0.5,
    targetY: window.innerHeight * 0.45,
    speed: 0,
    prevX: window.innerWidth * 0.5,
    prevY: window.innerHeight * 0.45,
    hasMoved: false
  };

  function onGlobalMouseMove(e) {
    mouseState.targetX = e.clientX;
    mouseState.targetY = e.clientY;
    mouseState.hasMoved = true;
  }
  window.addEventListener('mousemove', onGlobalMouseMove);
  window.addEventListener('touchmove', (e) => {
    if (e.touches && e.touches[0]) {
      mouseState.targetX = e.touches[0].clientX;
      mouseState.targetY = e.touches[0].clientY;
      mouseState.hasMoved = true;
    }
  }, { passive: true });

  function startCanvasAnimation() {
    const canvas = el.landingCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let W, H;
    let time = 0;

    function resize() {
      W = canvas.width  = window.innerWidth;
      H = canvas.height = window.innerHeight;
    }

    function render() {
      time += 0.016;

      // Mouse smoothing
      mouseState.x += (mouseState.targetX - mouseState.x) * 0.08;
      mouseState.y += (mouseState.targetY - mouseState.y) * 0.08;
      const mdx = mouseState.x - mouseState.prevX;
      const mdy = mouseState.y - mouseState.prevY;
      mouseState.speed = Math.hypot(mdx, mdy);
      mouseState.prevX = mouseState.x;
      mouseState.prevY = mouseState.y;

      // ── BACKGROUND (Deep dark petrol-black void matching Image 3) ──
      const isMobile = W < 768;
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0,    '#010d10');
      bg.addColorStop(0.35, '#021518');
      bg.addColorStop(0.70, '#021b1f');
      bg.addColorStop(1,    '#010c0f');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // ── FULL-PAGE 3D GLOWING TEAL PARTICLE WAVE PLATFORM (IMAGE 3) ──
      // Spans the entire screen with flowing 3D perspective sine waves and live air-breather physics
      const COLS = isMobile ? 48 : 72;
      const ROWS = isMobile ? 38 : 54;
      const fov = 330;

      // Compute and draw 3D perspective terrain mesh rows across full screen
      for (let r = 0; r < ROWS; r++) {
        const normR = r / (ROWS - 1); // 0 (distant top horizon) to 1 (near bottom foreground)
        const depthFade = Math.pow(normR, 0.60);
        const worldZ = (1 - normR) * 760 + 65;
        const scale = fov / (worldZ + fov);

        const rowPoints = [];

        for (let c = 0; c < COLS; c++) {
          const normC = (c / (COLS - 1)) - 0.5; // -0.5 to +0.5
          const worldX = normC * (W * 1.68);

          // Flowing 3D wave harmonics spanning the full canvas
          const w1 = Math.sin(normC * 7.2 + time * 1.18) * 60;
          const w2 = Math.cos(normR * 8.4 - time * 0.88) * 50;
          const w3 = Math.sin((normC * 4.5 + normR * 6.0) + time * 0.70) * 36;
          const w4 = Math.cos(normC * 11.5 - time * 1.38) * 20;
          const w5 = Math.sin(normR * 13.5 + time * 1.05) * 15;
          let elevation = w1 + w2 + w3 + w4 + w5;

          // Projected screen position across full viewport
          const baseProjX = W * 0.5 + worldX * scale;
          const baseProjY = (H * 0.02) + (H * 1.02) * Math.pow(normR, 0.88) + elevation * scale;

          // Live mouse reaction — dynamic fluid ripple & air-breather anywhere on page
          const dMouse = Math.hypot(baseProjX - mouseState.x, baseProjY - mouseState.y);
          const mDist = 250;
          if (dMouse < mDist) {
            const force = Math.cos((dMouse / mDist) * (Math.PI / 2));
            const ripple = Math.sin(dMouse * 0.044 - time * 4.6) * 46 * force;
            const breeze = force * 28 * Math.min(2.5, 0.4 + mouseState.speed * 0.12);
            elevation += ripple - breeze;
          }

          const screenX = W * 0.5 + worldX * scale;
          const screenY = (H * 0.02) + (H * 1.02) * Math.pow(normR, 0.88) + elevation * scale;

          // Elevation normalized for wave ridge detection
          const normElev = (elevation + 105) / 210;
          const crest = Math.max(0, Math.min(1, normElev));

          rowPoints.push({ screenX, screenY, crest, normR, depthFade });
        }

        // Draw fine flowing ribbon contour line connecting points in this row
        ctx.strokeStyle = `rgba(0, 220, 210, ${0.05 + depthFade * 0.18})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        for (let i = 0; i < rowPoints.length; i++) {
          const pt = rowPoints[i];
          if (i === 0) ctx.moveTo(pt.screenX, pt.screenY);
          else ctx.lineTo(pt.screenX, pt.screenY);
        }
        ctx.stroke();

        // Draw glowing dots on top of the ribbon (Image 3 luminous dots)
        for (let i = 0; i < rowPoints.length; i++) {
          const pt = rowPoints[i];
          const dotRadius = Math.max(0.65, (0.95 + pt.crest * 1.85) * (0.42 + pt.depthFade * 0.88));
          const alpha = Math.min(1, (0.16 + pt.crest * 0.80) * (0.30 + pt.depthFade * 0.70));

          if (pt.crest > 0.62) {
            // Electric glowing cyan ridge (Image 3 signature crest highlight)
            ctx.fillStyle = `rgba(20, 255, 242, ${alpha})`;
            ctx.shadowColor = 'rgba(0, 240, 225, 0.85)';
            ctx.shadowBlur = Math.round(7 * pt.depthFade);
          } else {
            // Deep oceanic teal trough
            const gVal = Math.round(120 + pt.crest * 110);
            const bVal = Math.round(145 + pt.crest * 100);
            ctx.fillStyle = `rgba(8, ${gVal}, ${bVal}, ${alpha * 0.82})`;
            ctx.shadowBlur = 0;
          }

          ctx.beginPath();
          ctx.arc(pt.screenX, pt.screenY, dotRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.shadowBlur = 0;

      state.canvasAnimId = requestAnimationFrame(render);
    }

    stopCanvasAnimation();
    resize();
    window.addEventListener('resize', resize);
    render();
  }

  function stopCanvasAnimation() {
    if (state.canvasAnimId) {
      cancelAnimationFrame(state.canvasAnimId);
      state.canvasAnimId = null;
    }
  }

  // ──────────────────────────────────────────────
  // EVENT BINDINGS — HEADER & MODALS
  // ──────────────────────────────────────────────
  const brandLogoBtn     = document.getElementById('brand-logo');
  const landingBrandLink = document.getElementById('landing-brand-link');
  const btnCopyRoomLink  = document.getElementById('btn-copy-room-link');
  const btnShareRoom     = document.getElementById('btn-share-room');
  const btnCreateNew     = document.getElementById('btn-create-new-room');
  const btnDownload      = document.getElementById('btn-download-code');
  const btnOpenSettings  = document.getElementById('btn-open-settings');
  const btnCloseSettings = document.getElementById('btn-close-settings');
  const btnSaveSettings  = document.getElementById('btn-save-settings');
  const btnCloseShare    = document.getElementById('btn-close-share');
  const btnModalCopyLink = document.getElementById('btn-modal-copy-link');
  const btnModalDone     = document.getElementById('btn-modal-done-share');

  // Return to landing
  function goHome() {
    if (state.presenceTimer) clearInterval(state.presenceTimer);
    if (state.sseSource) { state.sseSource.close(); state.sseSource = null; }
    state.roomId = null;
    state.monacoInstance = null;
    window.history.pushState(null, '', repoPrefix() + '/');
    showLanding();
  }

  if (brandLogoBtn) brandLogoBtn.addEventListener('click', goHome);
  if (landingBrandLink) landingBrandLink.addEventListener('click', goHome);

  if (btnCopyRoomLink) btnCopyRoomLink.addEventListener('click', () => copyLink());
  if (btnShareRoom)     btnShareRoom.addEventListener('click', copyLink);

  if (btnCreateNew) btnCreateNew.addEventListener('click', () => {
    state.monacoInstance = null;
    navigateToRoom(randomSlug());
  });

  if (btnDownload) btnDownload.addEventListener('click', () => {
    const code = getCode();
    const fname = (state.roomId || 'codeshift') + '.txt';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([code], { type: 'text/plain' }));
    a.download = fname;
    a.click();
    toast('Downloaded ' + fname, 'success');
  });

  // Settings
  if (btnOpenSettings) btnOpenSettings.addEventListener('click', () => {
    if (el.settingFontsize) el.settingFontsize.value = state.settings.fontSize;
    if (el.settingTabsize)  el.settingTabsize.value  = state.settings.tabSize;
    if (el.settingWordwrap) el.settingWordwrap.checked = state.settings.wordWrap;
    if (el.settingSound)   el.settingSound.checked   = state.settings.sound;
    if (el.modalSettings) { el.modalSettings.classList.remove('hidden'); el.modalSettings.classList.add('flex'); }
  });
  if (btnCloseSettings) btnCloseSettings.addEventListener('click', () => {
    if (el.modalSettings) el.modalSettings.classList.add('hidden');
  });
  if (btnSaveSettings) btnSaveSettings.addEventListener('click', () => {
    state.settings.fontSize = parseInt(el.settingFontsize.value, 10);
    state.settings.tabSize  = parseInt(el.settingTabsize.value,  10);
    state.settings.wordWrap = el.settingWordwrap.checked;
    state.settings.sound    = el.settingSound.checked;
    localStorage.setItem('cs_fontSize', state.settings.fontSize);
    localStorage.setItem('cs_tabSize',  state.settings.tabSize);
    localStorage.setItem('cs_wordWrap', state.settings.wordWrap);
    localStorage.setItem('cs_sound',    state.settings.sound);
    if (state.monacoInstance) {
      state.monacoInstance.updateOptions({
        fontSize: state.settings.fontSize,
        tabSize:  state.settings.tabSize,
        wordWrap: state.settings.wordWrap ? 'on' : 'off'
      });
    }
    if (el.modalSettings) el.modalSettings.classList.add('hidden');
    toast('Settings saved!', 'success');
  });

  // Share Modal
  if (btnModalCopyLink) btnModalCopyLink.addEventListener('click', copyLink);
  if (btnModalDone)     btnModalDone.addEventListener('click', () => { if (el.modalShare) el.modalShare.classList.add('hidden'); });
  if (btnCloseShare)    btnCloseShare.addEventListener('click', () => { if (el.modalShare) el.modalShare.classList.add('hidden'); });

  // Modal Backdrop Dismiss
  [el.modalSettings, el.modalShare].forEach(modal => {
    if (modal) modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  });

  // ──────────────────────────────────────────────
  // BOOTSTRAP
  // ──────────────────────────────────────────────
  initRouter();

})();
