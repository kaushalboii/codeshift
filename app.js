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
    // Priority 1: clean pathname (restored by 404.html + SPA restorer in index.html)
    let path = window.location.pathname;
    const pfx = repoPrefix();
    if (pfx && path.startsWith(pfx)) path = path.slice(pfx.length);
    path = path.replace(/^\/+/, '').trim();

    if (path && path !== 'index.html' && path !== '404.html') {
      return decodeURIComponent(path);
    }

    // Priority 2: old hash URL migration (backward compat)
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
    // strip full URLs down to just the slug
    let slug = raw;
    try {
      const u = new URL(raw);
      const parts = u.pathname.replace(/\/codeshift\/?/, '').replace(/^\/+/, '').split('/');
      slug = parts[0] || raw;
    } catch(e) { /* not a URL, use as-is */ }
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
    // Cleanup old room if switching
    if (state.roomId && state.roomId !== roomId) {
      if (state.presenceTimer) clearInterval(state.presenceTimer);
      if (state.sseSource) { state.sseSource.close(); state.sseSource = null; }
      if (state.broadcastChannel) { state.broadcastChannel.close(); state.broadcastChannel = null; }
      state.monacoInstance = null;
      state.monacoLoading = false;
    }

    state.roomId = roomId;

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
  // MONACO — lazy-load to avoid AMD conflict with Firebase
  // ──────────────────────────────────────────────
  function loadMonacoThenInit(initialCode) {
    // If Monaco AMD loader is already present, go straight to init
    if (window.require && window.require.config) {
      initMonacoEditor(initialCode);
      return;
    }

    // Prevent double-injecting the script
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
      // Already exists, just apply the initial code
      applyRemote(initial);
      fetchLatestCode(state.roomId);
      return;
    }

    window.require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });
    window.require(['vs/editor/editor.main'], function () {
      defineTheme();
      if (el.monacoContainer) el.monacoContainer.innerHTML = '';

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

      // Fetch latest code from Firebase after Monaco loads
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
        { token: 'comment',  foreground: '4b5563', fontStyle: 'italic' },
        { token: 'keyword',  foreground: 'EB4D4B', fontStyle: 'bold' },
        { token: 'string',   foreground: '10B981' },
        { token: 'number',   foreground: 'F59E0B' },
        { token: 'type',     foreground: '38BDF8' },
        { token: 'function', foreground: '8B7CFF' }
      ],
      colors: {
        'editor.background':                    '#11141C00',
        'editor.foreground':                    '#F8FAFC',
        'editorLineNumber.foreground':          '#334155',
        'editorLineNumber.activeForeground':    '#8B7CFF',
        'editorCursor.foreground':              '#EB4D4B',
        'editor.selectionBackground':           '#8B7CFF33',
        'editor.lineHighlightBackground':       '#1E233340'
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
    setTimeout(() => { state.isApplyingRemote = false; }, 100);
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
  // LOCAL CHANGE → debounced PUT to Firebase
  // ──────────────────────────────────────────────
  function onLocalChange(code) {
    setSaveStatus('saving');
    playTick();

    if (state.broadcastChannel) {
      state.broadcastChannel.postMessage({ type: 'CODE', roomId: state.roomId, code, from: state.userId });
    }

    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
      try { localStorage.setItem('codeshift_code_' + state.roomId, code); } catch(e) {}

      const url = FIREBASE_BASE + '/codeshare_rooms/' + safeKey(state.roomId) + '/data.json';
      fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code, ts: Date.now() })
      })
      .then(() => setSaveStatus('saved'))
      .catch(() => setSaveStatus('saved'));
    }, 300);
  }

  // ──────────────────────────────────────────────
  // SYNC: SSE + BroadcastChannel
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
    } catch(e) {}

    if (state.sseSource) { state.sseSource.close(); state.sseSource = null; }

    const sseUrl = FIREBASE_BASE + '/codeshare_rooms/' + safeKey(roomId) + '/data.json';
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

  function fetchLatestCode(roomId) {
    fetch(FIREBASE_BASE + '/codeshare_rooms/' + safeKey(roomId) + '/data.json')
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
  // PRESENCE
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
        const active = Object.values(map).filter(v => v && (now - v.ts) < 15000).length;
        setOnline(Math.max(1, active));
      })
      .catch(() => setOnline(1));
  }

  function setOnline(n) {
    if (el.onlineCount) el.onlineCount.textContent = n + (n === 1 ? ' online' : ' online');
  }

  // ──────────────────────────────────────────────
  // COPY LINK
  // ──────────────────────────────────────────────
  function copyLink() {
    const link = cleanRoomUrl(state.roomId);
    if (el.inputShareLink) el.inputShareLink.value = link;
    navigator.clipboard.writeText(link).then(() => {
      toast('Link copied!', 'success');
    }).catch(() => {
      if (el.modalShare) {
        el.modalShare.classList.remove('hidden');
        el.modalShare.classList.add('flex');
      }
    });
  }

  // ──────────────────────────────────────────────
  // TOAST
  // ──────────────────────────────────────────────
  function toast(msg, type) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = [
      'position:fixed', 'bottom:24px', 'right:24px', 'z-index:9999',
      'padding:10px 18px', 'border-radius:8px', 'font-size:13px',
      'font-family:Inter,sans-serif', 'font-weight:500',
      'background:' + (type === 'success' ? '#10B981' : '#EB4D4B'),
      'color:#fff', 'box-shadow:0 4px 20px rgba(0,0,0,0.3)',
      'transition:opacity 0.4s', 'opacity:1'
    ].join(';');
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 2000);
  }

  // ──────────────────────────────────────────────
  // TYPING SOUND
  // ──────────────────────────────────────────────
  function playTick() {
    if (!state.settings.sound) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880 + Math.random() * 220;
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.start(); osc.stop(ctx.currentTime + 0.08);
    } catch(e) {}
  }

  // ──────────────────────────────────────────────
  // CANVAS ANIMATION — misty moon landscape
  // ──────────────────────────────────────────────
  function startCanvasAnimation() {
    const canvas = el.landingCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let W, H, particles, fogLayers, moonX, moonY, moonR;
    let t = 0;

    function resize() {
      W = canvas.width  = canvas.offsetWidth;
      H = canvas.height = canvas.offsetHeight;
      moonX = W * 0.52;
      moonY = H * 0.32;
      moonR = Math.min(W, H) * 0.10;
      buildScene();
    }

    function buildScene() {
      // Stars / code-particles
      particles = Array.from({ length: 90 }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 1.4 + 0.3,
        speed: Math.random() * 0.15 + 0.05,
        alpha: Math.random() * 0.6 + 0.2,
        twinkleOffset: Math.random() * Math.PI * 2
      }));

      // Fog layers (horizontal drifting bands)
      fogLayers = Array.from({ length: 5 }, (_, i) => ({
        y: H * (0.55 + i * 0.11),
        width: W * (1.8 + Math.random()),
        speed: (i % 2 === 0 ? 1 : -1) * (0.12 + Math.random() * 0.18),
        alpha: 0.06 + i * 0.025,
        height: H * 0.08 + Math.random() * H * 0.06,
        offsetX: Math.random() * W
      }));
    }

    function draw() {
      t += 0.008;

      // Background gradient — deep blue-slate night
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0,   '#060d1a');
      bg.addColorStop(0.4, '#0a1628');
      bg.addColorStop(0.7, '#0d1e35');
      bg.addColorStop(1,   '#0e2438');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Moon glow halo
      const haloR = moonR * 3.5;
      const halo = ctx.createRadialGradient(moonX, moonY, moonR * 0.8, moonX, moonY, haloR);
      halo.addColorStop(0,   'rgba(180,210,240,0.18)');
      halo.addColorStop(0.5, 'rgba(100,160,210,0.07)');
      halo.addColorStop(1,   'rgba(60,120,180,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(moonX, moonY, haloR, 0, Math.PI * 2);
      ctx.fill();

      // Moon body
      const moonGrad = ctx.createRadialGradient(
        moonX - moonR * 0.25, moonY - moonR * 0.25, moonR * 0.1,
        moonX, moonY, moonR
      );
      moonGrad.addColorStop(0,   '#e8f4fd');
      moonGrad.addColorStop(0.5, '#c8dff0');
      moonGrad.addColorStop(1,   '#a0bfd8');
      ctx.fillStyle = moonGrad;
      ctx.beginPath();
      ctx.arc(moonX, moonY + Math.sin(t * 0.3) * 2, moonR, 0, Math.PI * 2);
      ctx.fill();

      // Moon craters (subtle)
      [[0.28, 0.2, 0.09], [-0.22, 0.35, 0.07], [0.1, -0.3, 0.05]].forEach(([dx, dy, sr]) => {
        ctx.fillStyle = 'rgba(120,160,200,0.22)';
        ctx.beginPath();
        ctx.arc(moonX + dx * moonR, moonY + dy * moonR, sr * moonR, 0, Math.PI * 2);
        ctx.fill();
      });

      // Stars
      particles.forEach(p => {
        const twinkle = 0.5 + 0.5 * Math.sin(t * 2.5 + p.twinkleOffset);
        ctx.fillStyle = 'rgba(200,220,255,' + (p.alpha * twinkle) + ')';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      });

      // Horizon glow
      const hzGrad = ctx.createLinearGradient(0, H * 0.6, 0, H * 0.75);
      hzGrad.addColorStop(0, 'rgba(56, 189, 248, 0.07)');
      hzGrad.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.fillStyle = hzGrad;
      ctx.fillRect(0, H * 0.6, W, H * 0.15);

      // Silhouette hills
      ctx.fillStyle = 'rgba(6,12,24,0.85)';
      ctx.beginPath();
      ctx.moveTo(0, H * 0.72);
      for (let x = 0; x <= W; x += 5) {
        const y = H * 0.72 + Math.sin(x * 0.006 + t * 0.2) * H * 0.035 + Math.sin(x * 0.015 - t * 0.1) * H * 0.02;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H); ctx.lineTo(0, H);
      ctx.closePath(); ctx.fill();

      // Silhouette trees (left side)
      [[0.08, 0.72], [0.12, 0.70], [0.16, 0.73], [0.06, 0.74]].forEach(([rx, ry]) => {
        const tx = rx * W, ty = ry * H;
        ctx.fillStyle = 'rgba(6,12,24,0.9)';
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - 6, ty + 20);
        ctx.lineTo(tx - 10, ty + 30);
        ctx.lineTo(tx + 10, ty + 30);
        ctx.lineTo(tx + 6, ty + 20);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(tx - 2, ty + 28, 4, 12);
      });

      // Silhouette trees (right side)
      [[0.82, 0.73], [0.87, 0.71], [0.91, 0.74], [0.95, 0.72]].forEach(([rx, ry]) => {
        const tx = rx * W, ty = ry * H;
        ctx.fillStyle = 'rgba(6,12,24,0.9)';
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - 6, ty + 20);
        ctx.lineTo(tx - 10, ty + 30);
        ctx.lineTo(tx + 10, ty + 30);
        ctx.lineTo(tx + 6, ty + 20);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(tx - 2, ty + 28, 4, 12);
      });

      // Ground
      const gndGrad = ctx.createLinearGradient(0, H * 0.73, 0, H);
      gndGrad.addColorStop(0, '#060d1a');
      gndGrad.addColorStop(1, '#040b14');
      ctx.fillStyle = gndGrad;
      ctx.fillRect(0, H * 0.73, W, H);

      // Fog layers — drifting mist
      fogLayers.forEach(f => {
        f.offsetX += f.speed;
        if (f.offsetX > W) f.offsetX -= f.width;
        if (f.offsetX < -f.width) f.offsetX += f.width;

        const fg = ctx.createLinearGradient(0, f.y - f.height * 0.5, 0, f.y + f.height * 0.5);
        fg.addColorStop(0, 'rgba(100,160,200,0)');
        fg.addColorStop(0.5, 'rgba(100,160,200,' + f.alpha + ')');
        fg.addColorStop(1, 'rgba(100,160,200,0)');

        ctx.save();
        ctx.globalAlpha = 0.85 + 0.15 * Math.sin(t + f.offsetX * 0.001);
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.ellipse(f.offsetX + f.width / 2, f.y, f.width / 2, f.height * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        // Second copy for seamless tiling
        ctx.beginPath();
        ctx.ellipse(f.offsetX + f.width * 1.5, f.y, f.width / 2, f.height * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      // Moon reflection on ground
      const reflectGrad = ctx.createLinearGradient(0, H * 0.73, 0, H);
      reflectGrad.addColorStop(0, 'rgba(160,195,225,0.07)');
      reflectGrad.addColorStop(1, 'rgba(160,195,225,0)');
      ctx.fillStyle = reflectGrad;
      ctx.fillRect(moonX - 60, H * 0.73, 120, H * 0.3);

      state.canvasAnimId = requestAnimationFrame(draw);
    }

    // Stop any running animation before starting a new one
    stopCanvasAnimation();
    resize();
    window.addEventListener('resize', resize);
    draw();
  }

  function stopCanvasAnimation() {
    if (state.canvasAnimId) {
      cancelAnimationFrame(state.canvasAnimId);
      state.canvasAnimId = null;
    }
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
  if (btnCopyRoomLink) btnCopyRoomLink.addEventListener('click', () => copyLink());

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

  // Share modal
  if (btnModalCopyLink) btnModalCopyLink.addEventListener('click', copyLink);
  if (btnModalDone)     btnModalDone.addEventListener('click', () => { if (el.modalShare) el.modalShare.classList.add('hidden'); });
  if (btnCloseShare)    btnCloseShare.addEventListener('click', () => { if (el.modalShare) el.modalShare.classList.add('hidden'); });

  // Backdrop click closes modals
  [el.modalSettings, el.modalShare].forEach(modal => {
    if (modal) modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  });

  // ──────────────────────────────────────────────
  // BOOT
  // ──────────────────────────────────────────────
  initRouter();

})();
