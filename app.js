/**
 * CodeShift — Real-Time Collaborative Code Workspace
 * Zero login · Custom room names · Auto-save · Live sync across devices
 */

(function () {
  'use strict';

  // ──────────────────────────────────────────────
  // STATE
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
    monacoInstance: null,
    settings: {
      fontSize: parseInt(localStorage.getItem('cs_fontSize') || '14', 10),
      tabSize:  parseInt(localStorage.getItem('cs_tabSize')  || '2',  10),
      wordWrap: localStorage.getItem('cs_wordWrap') !== 'false',
      sound:    localStorage.getItem('cs_sound')    !== 'false'
    }
  };

  localStorage.setItem('codeshift_uid', state.userId);

  function pickColor() {
    const c = ['#8B7CFF','#38BDF8','#10B981','#F59E0B','#EC4899','#C084FC'];
    return c[Math.floor(Math.random() * c.length)];
  }

  function safeKey(k) {
    return (k || 'default').replace(/[.#$\[\]\/]/g, '_');
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
    // Priority 1: clean pathname
    let path = window.location.pathname;
    const pfx = repoPrefix();
    if (pfx && path.startsWith(pfx)) path = path.slice(pfx.length);
    path = path.replace(/^\/+/, '').trim();

    if (path && path !== 'index.html' && path !== '404.html') {
      return decodeURIComponent(path);
    }

    // Priority 2: old hash URL migration
    const hash = (window.location.hash || '').slice(1).replace(/^\/+/, '').trim();
    if (hash && hash !== 'new') {
      window.history.replaceState(null, '', cleanRoomUrl(hash));
      return decodeURIComponent(hash);
    }

    return null;
  }

  function randomSlug() {
    const pfx = ['pair','dev','hack','flow','code','sync'];
    return pfx[Math.floor(Math.random() * pfx.length)] + '-' + Math.random().toString(36).substring(2, 6);
  }

  // ──────────────────────────────────────────────
  // VIEWS (Landing ↔ Editor)
  // ──────────────────────────────────────────────
  const landingPage = document.getElementById('landing-page');
  const editorPage  = document.getElementById('editor-page');

  function showLanding() {
    landingPage.classList.remove('hidden');
    editorPage.classList.add('hidden');
    document.title = 'CodeShift — Real-Time Collaborative Code Editor';
  }

  function showEditor() {
    landingPage.classList.add('hidden');
    editorPage.classList.remove('hidden');
  }

  // ──────────────────────────────────────────────
  // ROUTER
  // ──────────────────────────────────────────────
  function initRouter() {
    window.addEventListener('popstate', handleRoute);
    window.addEventListener('hashchange', handleRoute);
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
    window.history.pushState(null, '', cleanRoomUrl(roomId));
    showEditor();
    enterRoom(roomId);
  }

  // ──────────────────────────────────────────────
  // ENTER ROOM
  // ──────────────────────────────────────────────
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
    settingSound:    document.getElementById('setting-sound')
  };

  function enterRoom(roomId) {
    if (state.roomId === roomId && state.monacoInstance) return;
    state.roomId = roomId;

    if (el.roomNavId) el.roomNavId.textContent = '/' + roomId;
    document.title = `CodeShift · /${roomId}`;

    const cached = localStorage.getItem('codeshift_code_' + roomId);
    const initial = cached !== null ? cached : '';

    initMonaco(initial);
    syncSetup(roomId);
    presenceStart(roomId);
    setSaveStatus('saved');
  }

  // ──────────────────────────────────────────────
  // MONACO EDITOR
  // ──────────────────────────────────────────────
  function initMonaco(initial) {
    if (state.monacoInstance) {
      applyRemote(initial);
      return;
    }

    if (window.require && window.require.config) {
      window.require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });
      window.require(['vs/editor/editor.main'], function() {
        defineTheme();
        el.monacoContainer.innerHTML = '';

        state.monacoInstance = monaco.editor.create(el.monacoContainer, {
          value: initial,
          language: 'javascript',
          theme: 'codeshift-dark',
          automaticLayout: true,
          fontSize: state.settings.fontSize,
          fontFamily: "'JetBrains Mono', Menlo, Consolas, monospace",
          fontLigatures: true,
          minimap: { enabled: false },
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

        el.fallbackWrapper.classList.add('hidden');
        el.editorLabel.textContent = 'Monaco (VS Code)';

        state.monacoInstance.onDidChangeModelContent(() => {
          if (state.isApplyingRemote) return;
          onLocalChange(state.monacoInstance.getValue());
        });

        state.monacoInstance.onDidChangeCursorPosition((e) => {
          const p = e.position;
          const lines = state.monacoInstance.getModel().getLineCount();
          el.cursorPos.textContent = `Ln ${p.lineNumber}, Col ${p.column}`;
          el.codeStats.textContent = `${lines} ${lines === 1 ? 'line' : 'lines'}`;
        });

        // After Monaco loads, do an immediate fetch of cloud code
        fetchLatestCode(state.roomId);
      });
      return;
    }

    // Fallback textarea
    el.fallbackWrapper.classList.remove('hidden');
    el.monacoContainer.classList.add('hidden');
    el.editorTextarea.value = initial;
    el.editorLabel.textContent = 'Text Editor';
    el.editorTextarea.addEventListener('input', () => {
      if (state.isApplyingRemote) return;
      onLocalChange(el.editorTextarea.value);
    });
  }

  function defineTheme() {
    monaco.editor.defineTheme('codeshift-dark', {
      base: 'vs-dark', inherit: true,
      rules: [
        { token: 'comment',  foreground: '4b5563', fontStyle: 'italic' },
        { token: 'keyword',  foreground: 'EB4D4B', fontStyle: 'bold' },
        { token: 'string',   foreground: '10B981' },
        { token: 'number',   foreground: 'F59E0B' },
        { token: 'type',     foreground: '38BDF8' },
        { token: 'function', foreground: '8B7CFF' }
      ],
      colors: {
        'editor.background':           '#11141C00',
        'editor.foreground':           '#F8FAFC',
        'editorLineNumber.foreground': '#334155',
        'editorLineNumber.activeForeground': '#8B7CFF',
        'editorCursor.foreground':     '#EB4D4B',
        'editor.selectionBackground':  '#8B7CFF33',
        'editor.lineHighlightBackground': '#1E233340'
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
      if (top) state.monacoInstance.setScrollTop(top);
    } else if (el.editorTextarea) {
      el.editorTextarea.value = code;
    }
    setTimeout(() => { state.isApplyingRemote = false; }, 100);
    const lines = (code || '').split('\n').length;
    if (el.codeStats) el.codeStats.textContent = `${lines} ${lines === 1 ? 'line' : 'lines'}`;
  }

  // ──────────────────────────────────────────────
  // SAVE INDICATOR
  // ──────────────────────────────────────────────
  function setSaveStatus(s, t) {
    if (!el.saveStatusDot) return;
    el.saveStatusDot.className = 'status-dot ' + (s === 'saving' ? 'saving' : 'saved');
    el.saveStatusText.textContent = t || (s === 'saving' ? 'Saving…' : 'Saved');
  }

  // ──────────────────────────────────────────────
  // LOCAL CHANGE → debounced PUT to Firebase
  // ──────────────────────────────────────────────
  function onLocalChange(code) {
    setSaveStatus('saving');
    playTick();

    // Instant broadcast to same-machine tabs
    if (state.broadcastChannel) {
      state.broadcastChannel.postMessage({ type: 'CODE', roomId: state.roomId, code, from: state.userId });
    }

    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
      try { localStorage.setItem('codeshift_code_' + state.roomId, code); } catch(e) {}

      const url = `${FIREBASE_BASE}/codeshare_rooms/${safeKey(state.roomId)}/data.json`;
      fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, ts: Date.now() })
      })
      .then(() => setSaveStatus('saved'))
      .catch(() => setSaveStatus('saved'));
    }, 300);
  }

  // ──────────────────────────────────────────────
  // SYNC SETUP: SSE + BroadcastChannel
  // ──────────────────────────────────────────────
  function syncSetup(roomId) {
    // BroadcastChannel — same machine, same room, different tabs
    if (state.broadcastChannel) state.broadcastChannel.close();
    try {
      state.broadcastChannel = new BroadcastChannel('codeshift_' + safeKey(roomId));
      state.broadcastChannel.onmessage = (e) => {
        const m = e.data;
        if (!m || m.from === state.userId) return;
        if (m.type === 'CODE' && m.roomId === roomId) applyRemote(m.code);
        if (m.type === 'PRESENCE') pollPresence(roomId);
      };
    } catch(e) {}

    // Close old SSE
    if (state.sseSource) { state.sseSource.close(); state.sseSource = null; }

    // SSE stream — cross-device live push from Firebase
    const sseUrl = `${FIREBASE_BASE}/codeshare_rooms/${safeKey(roomId)}/data.json`;
    try {
      state.sseSource = new EventSource(sseUrl);
      state.sseSource.addEventListener('put', (ev) => {
        try {
          const p = JSON.parse(ev.data);
          if (p && p.data && typeof p.data.code === 'string' && !state.isApplyingRemote) {
            applyRemote(p.data.code);
            setSaveStatus('saved');
          }
        } catch(e) {}
      });
      state.sseSource.addEventListener('patch', (ev) => {
        try {
          const p = JSON.parse(ev.data);
          if (p && p.data && typeof p.data.code === 'string' && !state.isApplyingRemote) {
            applyRemote(p.data.code);
            setSaveStatus('saved');
          }
        } catch(e) {}
      });
    } catch(e) { console.warn('SSE error:', e); }
  }

  // Immediate REST fetch — guarantees newly opened tab sees latest code
  function fetchLatestCode(roomId) {
    fetch(`${FIREBASE_BASE}/codeshare_rooms/${safeKey(roomId)}/data.json`)
      .then(r => r.json())
      .then(d => {
        if (d && typeof d.code === 'string') {
          applyRemote(d.code);
          setSaveStatus('saved');
        }
      })
      .catch(() => {});
  }

  // ──────────────────────────────────────────────
  // PRESENCE ENGINE
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
    const url = `${FIREBASE_BASE}/codeshare_rooms/${safeKey(roomId)}/presence/${state.userId}.json`;
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
    fetch(`${FIREBASE_BASE}/codeshare_rooms/${safeKey(roomId)}/presence.json`)
      .then(r => r.json())
      .then(map => {
        if (!map) { setOnline(1); return; }
        const now = Date.now();
        const active = Object.values(map).filter(u => u && u.ts && now - u.ts < 15000).length;
        setOnline(Math.max(1, active));
      })
      .catch(() => setOnline(1));
  }

  function setOnline(n) {
    if (el.onlineCount) el.onlineCount.textContent = `${n} online`;
  }

  // Remove presence on tab close
  window.addEventListener('beforeunload', () => {
    if (!state.roomId) return;
    const url = `${FIREBASE_BASE}/codeshare_rooms/${safeKey(state.roomId)}/presence/${state.userId}.json`;
    navigator.sendBeacon ? navigator.sendBeacon(url, 'null')
                         : fetch(url, { method: 'DELETE', keepalive: true }).catch(() => {});
  });

  // ──────────────────────────────────────────────
  // COPY LINK
  // ──────────────────────────────────────────────
  function copyLink() {
    const url = cleanRoomUrl();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => toast('Room link copied! 📋', 'success')).catch(() => prompt('Copy:', url));
    } else {
      prompt('Copy:', url);
    }
    if (el.inputShareLink) el.inputShareLink.value = url;
  }

  // ──────────────────────────────────────────────
  // TOAST
  // ──────────────────────────────────────────────
  function toast(msg, type) {
    const c = document.getElementById('toast-container');
    if (!c) return;
    const t = document.createElement('div');
    t.className = 'toast-msg';
    const colors = { success: '#10b981', error: '#eb4d4b', info: '#8b7cff' };
    const icons  = { success: '✓', error: '✕', info: '⚡' };
    const col = colors[type] || colors.info;
    t.style.borderColor = col + '55';
    t.innerHTML = `<span style="color:${col}">${icons[type]||'⚡'}</span> <span>${msg}</span>`;
    c.appendChild(t);
    setTimeout(() => { t.style.cssText += 'opacity:0;transform:translateY(8px);transition:all .2s'; setTimeout(() => t.remove(), 250); }, 2800);
  }

  // ──────────────────────────────────────────────
  // CLICK SOUND
  // ──────────────────────────────────────────────
  const _ac = (window.AudioContext || window.webkitAudioContext) ? new (window.AudioContext || window.webkitAudioContext)() : null;
  function playTick() {
    if (!state.settings.sound || !_ac) return;
    try {
      if (_ac.state === 'suspended') _ac.resume();
      const o = _ac.createOscillator(), g = _ac.createGain();
      o.connect(g); g.connect(_ac.destination);
      const t = _ac.currentTime;
      o.frequency.setValueAtTime(700, t);
      g.gain.setValueAtTime(0.01, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
      o.start(t); o.stop(t + 0.025);
    } catch(e) {}
  }

  // ──────────────────────────────────────────────
  // MODAL HELPERS
  // ──────────────────────────────────────────────
  document.querySelectorAll('.modal-close-btn').forEach(b => {
    b.addEventListener('click', () => b.closest('.modal-backdrop')?.classList.add('hidden'));
  });
  document.querySelectorAll('.modal-backdrop').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) m.classList.add('hidden'); });
  });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.add('hidden'));
  });

  // ──────────────────────────────────────────────
  // EVENT BINDINGS — LANDING PAGE
  // ──────────────────────────────────────────────
  const landingOpenBtn   = document.getElementById('landing-open-btn');
  const landingRoomInput = document.getElementById('landing-room-input');
  const landingRandomBtn = document.getElementById('landing-random-btn');
  const landingBrandLink = document.getElementById('landing-brand-link');

  function openFromLanding() {
    const raw = (landingRoomInput ? landingRoomInput.value.trim() : '').replace(/\s+/g, '-');
    const slug = raw || randomSlug();
    navigateToRoom(slug);
  }

  if (landingOpenBtn)   landingOpenBtn.addEventListener('click', openFromLanding);
  if (landingRandomBtn) landingRandomBtn.addEventListener('click', () => { navigateToRoom(randomSlug()); });
  if (landingBrandLink) landingBrandLink.addEventListener('click', () => {
    window.history.pushState(null, '', repoPrefix() + '/');
    showLanding();
  });
  if (landingRoomInput) {
    landingRoomInput.addEventListener('keydown', e => { if (e.key === 'Enter') openFromLanding(); });
  }

  // ──────────────────────────────────────────────
  // EVENT BINDINGS — EDITOR HEADER
  // ──────────────────────────────────────────────
  const brandLogoBtn     = document.getElementById('brand-logo');
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

  // Logo → back to landing
  if (brandLogoBtn) brandLogoBtn.addEventListener('click', () => {
    if (state.presenceTimer) clearInterval(state.presenceTimer);
    if (state.sseSource) { state.sseSource.close(); state.sseSource = null; }
    state.roomId = null;
    state.monacoInstance = null;
    window.history.pushState(null, '', repoPrefix() + '/');
    showLanding();
  });

  // Room pill → copy
  if (btnCopyRoomLink) btnCopyRoomLink.addEventListener('click', () => {
    const cur = state.roomId;
    const target = prompt('Switch room (or Cancel to copy link):', cur);
    if (target !== null && target.trim() && target.trim() !== cur) {
      navigateToRoom(target.trim());
    } else {
      copyLink();
    }
  });

  if (btnShareRoom) btnShareRoom.addEventListener('click', copyLink);

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

  // Settings modal
  if (btnOpenSettings) btnOpenSettings.addEventListener('click', () => {
    if (el.settingFontsize) el.settingFontsize.value = state.settings.fontSize;
    if (el.settingTabsize)  el.settingTabsize.value  = state.settings.tabSize;
    if (el.settingWordwrap) el.settingWordwrap.checked = state.settings.wordWrap;
    if (el.settingSound)   el.settingSound.checked   = state.settings.sound;
    el.modalSettings?.classList.remove('hidden');
    el.modalSettings?.classList.add('flex');
  });
  if (btnCloseSettings) btnCloseSettings.addEventListener('click', () => el.modalSettings?.classList.add('hidden'));
  if (btnSaveSettings)  btnSaveSettings.addEventListener('click',  () => {
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
    el.modalSettings?.classList.add('hidden');
    toast('Settings saved!', 'success');
  });

  // Share modal
  if (btnModalCopyLink) btnModalCopyLink.addEventListener('click', copyLink);
  if (btnModalDone)     btnModalDone.addEventListener('click', () => el.modalShare?.classList.add('hidden'));
  if (btnCloseShare)    btnCloseShare.addEventListener('click', () => el.modalShare?.classList.add('hidden'));

  // ──────────────────────────────────────────────
  // BOOT
  // ──────────────────────────────────────────────
  initRouter();

})();
