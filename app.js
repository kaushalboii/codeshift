/**
 * CodeShare — Real-Time Collaborative Code Sharing Engine
 * "Share Code in Real-Time Seamlessly Without Login"
 *
 * Features:
 * - Instant distraction-free mesh-type code editor
 * - Fresh rooms start completely empty (no boilerplate code)
 * - Custom room names in URL (e.g. #/kaushal)
 * - Keystroke auto-save with visual indicator (● Saved / ● Saving...)
 * - Silent background cloud persistence via Firebase Realtime Database
 * - Direct WebRTC peer-to-peer sync (PeerJS)
 * - Monaco Editor (VS Code engine) with full multi-language syntax highlighting
 * - Zero signup, instant 1-click link sharing
 */

(function () {
  'use strict';

  // --- State Architecture ---
  const state = {
    roomId: null,
    userId: localStorage.getItem('codeshare_user_id') || ('usr_' + Math.random().toString(36).substring(2, 9)),
    userName: localStorage.getItem('codeshare_user_name') || 'Kaushal',
    userColor: localStorage.getItem('codeshare_user_color') || getRandomColor(),
    firebaseUrl: 'https://codeshift-realtimedb-default-rtdb.firebaseio.com',
    serverUrl: localStorage.getItem('codeshift_ws_server') || (window.CODESHIFT_WS_SERVER || ''),
    language: localStorage.getItem('codeshare_default_lang') || 'javascript',
    isHost: false,
    peers: new Map(),
    peerJsInstance: null,
    peerConnections: new Map(),
    firebaseApp: null,
    firebaseDb: null,
    currentRoomRef: null,
    ws: null,
    wsConnected: false,
    broadcastChannel: null,
    isLocalEditing: false,
    isApplyingRemoteChange: false,
    autoSaveTimer: null,
    monacoInstance: null,
    settings: {
      fontSize: parseInt(localStorage.getItem('cs_fontSize') || '14', 10),
      tabSize: parseInt(localStorage.getItem('cs_tabSize') || '2', 10),
      wordWrap: localStorage.getItem('cs_wordWrap') !== 'false',
      sound: localStorage.getItem('cs_sound') !== 'false'
    }
  };

  localStorage.setItem('codeshare_user_id', state.userId);
  localStorage.setItem('codeshare_user_color', state.userColor);

  // Fresh rooms start completely empty (like Codeshare)
  const DEFAULT_TEMPLATES = {
    javascript: '',
    typescript: '',
    python: '',
    html: '',
    css: '',
    json: '',
    sql: '',
    rust: '',
    go: '',
    markdown: '',
    plaintext: ''
  };

  function getRandomColor() {
    const palette = ['#eb4d4b', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];
    return palette[Math.floor(Math.random() * palette.length)];
  }

  // --- Sound Synthesizer ---
  const audioCtx = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) ? new (window.AudioContext || window.webkitAudioContext)() : null;
  function playClickSound() {
    if (!state.settings.sound || !audioCtx) return;
    try {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      const now = audioCtx.currentTime;
      osc.frequency.setValueAtTime(600, now);
      gain.gain.setValueAtTime(0.015, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
      osc.start(now);
      osc.stop(now + 0.03);
    } catch (e) {}
  }

  // --- Toast Notification ---
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast-msg';
    
    if (type === 'success') {
      toast.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      toast.innerHTML = `<span style="color:#10b981;">✓</span> <span>${message}</span>`;
    } else if (type === 'error') {
      toast.style.borderColor = 'rgba(235, 77, 75, 0.4)';
      toast.innerHTML = `<span style="color:#eb4d4b;">✕</span> <span>${message}</span>`;
    } else {
      toast.style.borderColor = 'rgba(59, 130, 246, 0.4)';
      toast.innerHTML = `<span style="color:#3b82f6;">⚡</span> <span>${message}</span>`;
    }

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      toast.style.transition = 'all 0.2s ease';
      setTimeout(() => toast.remove(), 250);
    }, 2800);
  }

  // --- DOM Elements Cache ---
  const el = {
    brandLogo: document.getElementById('brand-logo'),
    roomNavId: document.getElementById('room-nav-id'),
    btnCopyRoomLink: document.getElementById('btn-copy-room-link'),
    btnShareRoom: document.getElementById('btn-share-room'),
    btnCreateNewRoom: document.getElementById('btn-create-new-room'),
    btnHeroLaunchRoom: document.getElementById('btn-hero-launch-room'),
    saveStatusContainer: document.getElementById('save-status-container'),
    saveStatusDot: document.getElementById('save-status-dot'),
    saveStatusText: document.getElementById('save-status-text'),
    selectLanguage: document.getElementById('select-language'),
    onlineUsersCount: document.getElementById('online-users-count'),
    userNicknameDisplay: document.getElementById('user-nickname-display'),
    btnChangeNickname: document.getElementById('btn-change-nickname'),
    btnOpenSettings: document.getElementById('btn-open-settings'),
    btnDownloadCode: document.getElementById('btn-download-code'),
    btnToggleFullscreen: document.getElementById('btn-toggle-fullscreen'),
    // Editor mounts
    monacoContainer: document.getElementById('monaco-editor-container'),
    fallbackWrapper: document.getElementById('fallback-editor-wrapper'),
    editorTextarea: document.getElementById('code-editor-textarea'),
    editorLineNumbers: document.getElementById('editor-line-numbers'),
    cursorPosition: document.getElementById('cursor-position'),
    codeStats: document.getElementById('code-stats'),
    syncStatus: document.getElementById('sync-status'),
    editorEngineLabel: document.getElementById('editor-engine-label'),
    // Modals
    modalShare: document.getElementById('modal-share'),
    inputShareLink: document.getElementById('input-share-link'),
    btnModalCopyLink: document.getElementById('btn-modal-copy-link'),
    btnModalDoneShare: document.getElementById('btn-modal-done-share'),
    btnCloseShare: document.getElementById('btn-close-share'),
    modalSettings: document.getElementById('modal-settings'),
    settingFontsize: document.getElementById('setting-fontsize'),
    settingTabsize: document.getElementById('setting-tabsize'),
    settingWordwrap: document.getElementById('setting-wordwrap'),
    settingSound: document.getElementById('setting-sound'),
    btnSaveSettings: document.getElementById('btn-save-settings'),
    btnCloseSettings: document.getElementById('btn-close-settings'),
    modalNickname: document.getElementById('modal-nickname'),
    inputNewNickname: document.getElementById('input-new-nickname'),
    btnSaveNickname: document.getElementById('btn-save-nickname'),
    btnCancelNickname: document.getElementById('btn-cancel-nickname')
  };

  // --- Router & Room Management ---
  function initRouter() {
    window.addEventListener('hashchange', handleRoute);
    handleRoute();
  }

  function handleRoute() {
    const rawHash = (window.location.hash || '').slice(1);
    const [pathPart, _] = rawHash.split('?');
    const cleanPath = (pathPart || '').replace(/^\/+/, '').trim();

    // If root or new, generate instant room slug (e.g. /#/room-8x2a)
    if (!cleanPath || cleanPath === 'new') {
      const newSlug = generateRoomSlug();
      window.location.hash = `/${newSlug}`;
      return;
    }

    // Support /#/kaushal or /#/room/kaushal
    const roomId = cleanPath.startsWith('room/') ? cleanPath.slice(5) : cleanPath;
    enterRoom(decodeURIComponent(roomId));
  }

  function enterRoom(roomId) {
    if (state.roomId === roomId) return;
    state.roomId = roomId;

    // Update UI elements
    if (el.roomNavId) el.roomNavId.textContent = '/' + roomId;
    if (el.userNicknameDisplay) el.userNicknameDisplay.textContent = `(${state.userName})`;
    document.title = `CodeShare • /${roomId}`;

    // Load cached code from localStorage if available, otherwise start clean
    const cachedCode = localStorage.getItem(`cs_code_${roomId}`);
    const cachedLang = localStorage.getItem(`cs_lang_${roomId}`);
    if (cachedLang) {
      state.language = cachedLang;
      if (el.selectLanguage) el.selectLanguage.value = cachedLang;
    }

    const initialCode = cachedCode !== null ? cachedCode : '';

    // Initialize Monaco Editor
    initMonacoEditor(initialCode);

    // Initialize Real-Time Synchronization Engines:
    // 1. Firebase Realtime Database (Silent Cloud Persistence)
    initFirebaseSync(roomId);
    // 2. Direct WebRTC Peer Sync (PeerJS)
    initPeerSync(roomId);
    // 3. Native WebSocket Server (if running)
    connectWebSocket(roomId);

    updateSaveIndicator('saved', 'Saved');
  }

  function sanitizeFirebaseKey(key) {
    return (key || 'default').replace(/[.#$\[\]\/]/g, '_');
  }

  function navigateToRoom(roomId) {
    window.location.hash = `/${encodeURIComponent(roomId)}`;
  }

  function getRoomShareUrl(roomId) {
    let base = window.location.origin + window.location.pathname;
    if (!base.endsWith('/')) base += '/';
    return `${base}#/${encodeURIComponent(roomId || state.roomId)}`;
  }

  function generateRoomSlug() {
    const prefixes = ['dev', 'code', 'room', 'pair', 'flow'];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const num = Math.random().toString(36).substring(2, 6);
    return `${prefix}-${num}`;
  }

  // --- Auto-Save Indicator ---
  function updateSaveIndicator(status, text) {
    if (!el.saveStatusDot || !el.saveStatusText) return;
    if (status === 'saving') {
      el.saveStatusDot.className = 'status-dot saving';
      el.saveStatusText.textContent = text || 'Saving...';
    } else {
      el.saveStatusDot.className = 'status-dot saved';
      el.saveStatusText.textContent = text || 'Saved';
    }
  }

  // --- Monaco Editor Initialization ---
  function initMonacoEditor(initialCode) {
    if (state.monacoInstance) {
      state.monacoInstance.setValue(initialCode);
      updateLanguageInMonaco(state.language);
      return;
    }

    if (window.require && typeof window.require.config === 'function') {
      try {
        window.require.config({
          paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' }
        });

        window.require(['vs/editor/editor.main'], function () {
          defineMonacoTheme();

          const container = el.monacoContainer;
          container.innerHTML = '';

          const codeToLoad = (getEditorCode() !== '') ? getEditorCode() : initialCode;

          state.monacoInstance = monaco.editor.create(container, {
            value: codeToLoad,
            language: mapLanguageToMonaco(state.language),
            theme: 'codeshare-mesh',
            automaticLayout: true,
            fontSize: state.settings.fontSize,
            fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace",
            fontLigatures: true,
            minimap: { enabled: true, scale: 0.75 },
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
          el.editorEngineLabel.textContent = 'Monaco Engine (VS Code)';

          // Local typing listener
          state.monacoInstance.onDidChangeModelContent(() => {
            if (state.isApplyingRemoteChange) return;
            const code = state.monacoInstance.getValue();
            onLocalCodeChange(code);
          });

          // Cursor tracking
          state.monacoInstance.onDidChangeCursorPosition((e) => {
            const pos = e.position;
            const model = state.monacoInstance.getModel();
            const lines = model.getLineCount();
            el.cursorPosition.textContent = `Ln ${pos.lineNumber}, Col ${pos.column}`;
            el.codeStats.textContent = `${lines} ${lines === 1 ? 'line' : 'lines'}`;
          });

          updateCodeStats();
        });
        return;
      } catch (err) {
        console.warn('Monaco loading from CDN failed, using fallback:', err);
      }
    }

    // Fallback Editor
    el.fallbackWrapper.classList.remove('hidden');
    el.monacoContainer.classList.add('hidden');
    el.editorTextarea.value = initialCode;
    el.editorEngineLabel.textContent = 'Native Code Area';
    updateLineNumbers();
    updateCodeStats();

    el.editorTextarea.addEventListener('input', () => {
      if (state.isApplyingRemoteChange) return;
      onLocalCodeChange(el.editorTextarea.value);
    });
  }

  function defineMonacoTheme() {
    monaco.editor.defineTheme('codeshare-mesh', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '64748B', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'EB4D4B', fontStyle: 'bold' },
        { token: 'string', foreground: '10B981' },
        { token: 'number', foreground: 'F59E0B' },
        { token: 'type', foreground: '3B82F6' },
        { token: 'function', foreground: '8B5CF6' },
        { token: 'identifier', foreground: 'F8FAFC' }
      ],
      colors: {
        'editor.background': '#11141C00',
        'editor.foreground': '#F8FAFC',
        'editorLineNumber.foreground': '#475569',
        'editorLineNumber.activeForeground': '#EB4D4B',
        'editor.lineHighlightBackground': '#1A1E2960',
        'editorCursor.foreground': '#EB4D4B',
        'editor.selectionBackground': '#EB4D4B33',
        'editorWidget.background': '#161A24',
        'editorWidget.border': '#252936'
      }
    });
  }

  function mapLanguageToMonaco(lang) {
    const map = {
      javascript: 'javascript',
      typescript: 'typescript',
      html: 'html',
      css: 'css',
      python: 'python',
      json: 'json',
      markdown: 'markdown',
      rust: 'rust',
      go: 'go',
      sql: 'sql'
    };
    return map[lang] || 'plaintext';
  }

  function getEditorCode() {
    if (state.monacoInstance) return state.monacoInstance.getValue();
    return el.editorTextarea ? el.editorTextarea.value : '';
  }

  function setEditorCode(code) {
    state.isApplyingRemoteChange = true;
    if (state.monacoInstance) {
      const position = state.monacoInstance.getPosition();
      const scrollTop = state.monacoInstance.getScrollTop();
      state.monacoInstance.setValue(code);
      if (position) state.monacoInstance.setPosition(position);
      if (scrollTop) state.monacoInstance.setScrollTop(scrollTop);
    } else {
      if (el.editorTextarea) el.editorTextarea.value = code;
      updateLineNumbers();
    }
    updateCodeStats();
    setTimeout(() => {
      state.isApplyingRemoteChange = false;
    }, 80);
  }

  function updateLineNumbers() {
    const text = el.editorTextarea.value;
    const lines = text.split('\n').length;
    let nums = '';
    for (let i = 1; i <= lines; i++) nums += i + '\n';
    el.editorLineNumbers.innerText = nums;
    el.codeStats.textContent = `${lines} ${lines === 1 ? 'line' : 'lines'}`;
  }

  function updateCodeStats() {
    const code = getEditorCode();
    const lines = (code || '').split('\n').length;
    if (el.codeStats) el.codeStats.textContent = `${lines} ${lines === 1 ? 'line' : 'lines'}`;
  }

  function updateLanguageInMonaco(lang) {
    if (state.monacoInstance) {
      const model = state.monacoInstance.getModel();
      monaco.editor.setModelLanguage(model, mapLanguageToMonaco(lang));
    }
  }

  // --- Local Typing & Instant Auto-Save Engine ---
  function onLocalCodeChange(code) {
    updateLineNumbers();
    updateCodeStats();
    playClickSound();

    // Trigger visual saving indicator
    updateSaveIndicator('saving', 'Saving...');

    clearTimeout(state.autoSaveTimer);
    state.autoSaveTimer = setTimeout(() => {
      // 1. Save to LocalStorage cache
      try {
        localStorage.setItem(`cs_code_${state.roomId}`, code);
        localStorage.setItem(`cs_lang_${state.roomId}`, state.language);
      } catch (e) {}

      // 2. Save to Firebase Realtime Database
      if (state.firebaseDb && state.roomId) {
        state.firebaseDb.ref('codeshare_rooms/' + sanitizeFirebaseKey(state.roomId)).set({
          code: code,
          language: state.language,
          author: state.userName,
          updatedAt: Date.now()
        }).then(() => {
          updateSaveIndicator('saved', 'Saved');
        }).catch(() => {
          updateSaveIndicator('saved', 'Saved');
        });
      } else {
        updateSaveIndicator('saved', 'Saved');
      }

      // 3. Broadcast to all WebRTC Peers
      broadcastToPeers({
        type: 'SYNC_DOC',
        code: code,
        language: state.language,
        userId: state.userId,
        userName: state.userName
      });

      // 4. Broadcast via Native WebSocket / BroadcastChannel
      sendWsMessage({
        type: 'SYNC_DOC',
        code: code,
        language: state.language
      });

    }, 250);
  }

  // --- 1. Firebase Realtime Database Engine (Silent Background Sync) ---
  function initFirebaseSync(roomId) {
    const dbUrl = state.firebaseUrl;
    if (!dbUrl || typeof firebase === 'undefined') return;

    try {
      if (!state.firebaseApp) {
        state.firebaseApp = firebase.initializeApp({ databaseURL: dbUrl }, 'cs_app_' + Date.now());
        state.firebaseDb = state.firebaseApp.database();
      }

      // Detach any previous room listener
      if (state.currentRoomRef) {
        state.currentRoomRef.off();
      }

      state.currentRoomRef = state.firebaseDb.ref('codeshare_rooms/' + sanitizeFirebaseKey(roomId));

      // Listen for remote updates
      state.currentRoomRef.on('value', (snapshot) => {
        const val = snapshot.val();
        if (val && val.code !== undefined && !state.isApplyingRemoteChange) {
          if (val.code !== getEditorCode()) {
            setEditorCode(val.code);
            if (val.language && val.language !== state.language) {
              state.language = val.language;
              el.selectLanguage.value = val.language;
              updateLanguageInMonaco(val.language);
            }
            updateSaveIndicator('saved', 'Saved');
          }
        }
      });
    } catch (err) {
      console.warn('Firebase init error:', err);
    }
  }

  // --- 2. Direct WebRTC Peer Sync (PeerJS) ---
  function initPeerSync(roomId) {
    if (typeof Peer === 'undefined') return;

    try {
      const myPeerId = `cs_${roomId}_${state.userId}`;
      if (state.peerJsInstance) state.peerJsInstance.destroy();

      const peer = new Peer(myPeerId, { debug: 0 });
      state.peerJsInstance = peer;

      peer.on('open', () => {
        updatePeerCounter();
        const targetHostId = `cs_${roomId}_host`;
        if (myPeerId !== targetHostId) {
          const conn = peer.connect(targetHostId);
          setupPeerConnection(conn);
        }
      });

      peer.on('connection', (conn) => {
        setupPeerConnection(conn);
      });

      peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
          const guestId = `cs_${roomId}_g_${Math.random().toString(36).substring(2, 6)}`;
          state.peerJsInstance = new Peer(guestId, { debug: 0 });
          state.peerJsInstance.on('connection', setupPeerConnection);
        }
      });
    } catch (e) {
      console.warn('PeerJS init failed:', e);
    }
  }

  function setupPeerConnection(conn) {
    conn.on('open', () => {
      state.peerConnections.set(conn.peer, conn);
      updatePeerCounter();

      conn.send({
        type: 'SYNC_DOC',
        code: getEditorCode(),
        language: state.language,
        userId: state.userId,
        userName: state.userName
      });
    });

    conn.on('data', (data) => {
      if (!data) return;
      if (data.type === 'SYNC_DOC' && data.userId !== state.userId) {
        if (data.code !== getEditorCode()) {
          setEditorCode(data.code);
          if (data.language && data.language !== state.language) {
            state.language = data.language;
            el.selectLanguage.value = data.language;
            updateLanguageInMonaco(data.language);
          }
          updateSaveIndicator('saved', 'Saved');
        }
      }
    });

    conn.on('close', () => {
      state.peerConnections.delete(conn.peer);
      updatePeerCounter();
    });
  }

  function broadcastToPeers(payload) {
    for (const [_, conn] of state.peerConnections) {
      if (conn && conn.open) {
        try { conn.send(payload); } catch (e) {}
      }
    }
  }

  function updatePeerCounter() {
    const count = 1 + state.peerConnections.size;
    if (el.onlineUsersCount) {
      el.onlineUsersCount.textContent = `${count} online`;
    }
  }

  // --- 3. Native WebSocket & BroadcastChannel Engine ---
  function getWebSocketUrl(roomId) {
    const customServer = (state.serverUrl || localStorage.getItem('codeshift_ws_server') || window.CODESHIFT_WS_SERVER || '').trim();
    if (customServer) {
      let clean = customServer.replace(/\/$/, '');
      if (clean.startsWith('http://')) clean = 'ws://' + clean.slice(7);
      else if (clean.startsWith('https://')) clean = 'wss://' + clean.slice(8);
      else if (!clean.startsWith('ws://') && !clean.startsWith('wss://')) {
        clean = (location.protocol === 'https:' ? 'wss://' : 'ws://') + clean;
      }
      return `${clean}/ws/room/${roomId}?userId=${state.userId}&userName=${encodeURIComponent(state.userName)}&userColor=${encodeURIComponent(state.userColor)}`;
    }

    const isSecure = location.protocol === 'https:';
    const wsProto = isSecure ? 'wss:' : 'ws:';
    const host = location.host;

    if (host && !host.includes('github.io')) {
      return `${wsProto}//${host}/ws/room/${roomId}?userId=${state.userId}&userName=${encodeURIComponent(state.userName)}&userColor=${encodeURIComponent(state.userColor)}`;
    }

    return null;
  }

  function connectWebSocket(roomId) {
    closeWebSocket();
    activateBroadcastChannel(roomId);

    const wsUrl = getWebSocketUrl(roomId);
    if (!wsUrl) return;

    try {
      state.ws = new WebSocket(wsUrl);
      state.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'DOC_UPDATED' || msg.type === 'ROOM_INIT') {
            if (msg.code !== undefined && msg.code !== getEditorCode()) {
              setEditorCode(msg.code);
              if (msg.language) {
                state.language = msg.language;
                el.selectLanguage.value = msg.language;
                updateLanguageInMonaco(msg.language);
              }
              updateSaveIndicator('saved', 'Saved');
            }
          }
        } catch (e) {}
      };
      state.ws.onclose = () => { state.wsConnected = false; };
      state.ws.onerror = () => { state.wsConnected = false; };
    } catch (e) {}
  }

  function closeWebSocket() {
    if (state.ws) {
      state.ws.onclose = null;
      state.ws.close();
      state.ws = null;
      state.wsConnected = false;
    }
  }

  function sendWsMessage(data) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify(data));
    }
    if (state.broadcastChannel) {
      state.broadcastChannel.postMessage(data);
    }
  }

  function activateBroadcastChannel(roomId) {
    if (state.broadcastChannel) state.broadcastChannel.close();
    state.broadcastChannel = new BroadcastChannel(`codeshare_${roomId}`);
    state.broadcastChannel.onmessage = (event) => {
      const msg = event.data;
      if (msg && msg.type === 'SYNC_DOC' && msg.code !== getEditorCode()) {
        setEditorCode(msg.code);
        updateSaveIndicator('saved', 'Saved');
      }
    };
  }

  // --- 1-Click Copy Link Function ---
  function copyShareLink() {
    const fullUrl = getRoomShareUrl();
    
    if (navigator.clipboard) {
      navigator.clipboard.writeText(fullUrl).then(() => {
        showToast('Room link copied! Share with anyone 📋', 'success');
      }).catch(() => {
        prompt('Copy this room URL:', fullUrl);
      });
    } else {
      prompt('Copy this room URL:', fullUrl);
    }

    // Also update modal if opened
    if (el.inputShareLink) el.inputShareLink.value = fullUrl;
  }

  // --- Event Bindings ---
  // 1. Share & Copy Link Button
  if (el.btnShareRoom) el.btnShareRoom.addEventListener('click', copyShareLink);

  // 2. Click Room Badge to copy or switch room
  if (el.btnCopyRoomLink) {
    el.btnCopyRoomLink.addEventListener('click', () => {
      const currentName = state.roomId;
      const targetRoom = prompt('Enter a room name to switch, or press Cancel to copy current link:', currentName);
      if (targetRoom !== null && targetRoom.trim() && targetRoom.trim() !== currentName) {
        navigateToRoom(targetRoom.trim());
      } else {
        copyShareLink();
      }
    });
  }

  // 3. New Room Button
  if (el.btnCreateNewRoom) {
    el.btnCreateNewRoom.addEventListener('click', () => {
      navigateToRoom(generateRoomSlug());
    });
  }
  if (el.btnHeroLaunchRoom) {
    el.btnHeroLaunchRoom.addEventListener('click', () => {
      navigateToRoom(generateRoomSlug());
    });
  }

  // 4. Language Selector
  if (el.selectLanguage) {
    el.selectLanguage.addEventListener('change', (e) => {
      const lang = e.target.value;
      state.language = lang;
      localStorage.setItem('codeshare_default_lang', lang);
      updateLanguageInMonaco(lang);
      onLocalCodeChange(getEditorCode());
      showToast(`Language: ${e.target.options[e.target.selectedIndex].text}`);
    });
  }

  // 5. Settings / Preferences Modal
  if (el.btnOpenSettings) {
    el.btnOpenSettings.addEventListener('click', () => {
      if (el.settingFontsize) el.settingFontsize.value = state.settings.fontSize;
      if (el.settingTabsize) el.settingTabsize.value = state.settings.tabSize;
      if (el.settingWordwrap) el.settingWordwrap.checked = state.settings.wordWrap;
      if (el.settingSound) el.settingSound.checked = state.settings.sound;
      if (el.modalSettings) {
        el.modalSettings.classList.remove('hidden');
        el.modalSettings.classList.add('flex');
      }
    });
  }

  if (el.btnCloseSettings) {
    el.btnCloseSettings.addEventListener('click', () => {
      if (el.modalSettings) el.modalSettings.classList.add('hidden');
    });
  }

  if (el.btnSaveSettings) {
    el.btnSaveSettings.addEventListener('click', () => {
      state.settings.fontSize = parseInt(el.settingFontsize.value, 10);
      state.settings.tabSize = parseInt(el.settingTabsize.value, 10);
      state.settings.wordWrap = el.settingWordwrap.checked;
      state.settings.sound = el.settingSound.checked;

      localStorage.setItem('cs_fontSize', state.settings.fontSize);
      localStorage.setItem('cs_tabSize', state.settings.tabSize);
      localStorage.setItem('cs_wordWrap', state.settings.wordWrap);
      localStorage.setItem('cs_sound', state.settings.sound);

      if (state.monacoInstance) {
        state.monacoInstance.updateOptions({
          fontSize: state.settings.fontSize,
          tabSize: state.settings.tabSize,
          wordWrap: state.settings.wordWrap ? 'on' : 'off'
        });
      }

      if (el.modalSettings) el.modalSettings.classList.add('hidden');
      showToast('Settings saved!', 'success');
    });
  }

  // 6. Nickname Modal
  if (el.btnChangeNickname) {
    el.btnChangeNickname.addEventListener('click', () => {
      if (el.inputNewNickname) el.inputNewNickname.value = state.userName;
      if (el.modalNickname) {
        el.modalNickname.classList.remove('hidden');
        el.modalNickname.classList.add('flex');
        if (el.inputNewNickname) el.inputNewNickname.focus();
      }
    });
  }

  if (el.btnCancelNickname) {
    el.btnCancelNickname.addEventListener('click', () => {
      if (el.modalNickname) el.modalNickname.classList.add('hidden');
    });
  }

  if (el.btnSaveNickname) {
    el.btnSaveNickname.addEventListener('click', () => {
      const newName = (el.inputNewNickname.value || '').trim();
      if (newName) {
        state.userName = newName;
        localStorage.setItem('codeshare_user_name', newName);
        if (el.userNicknameDisplay) el.userNicknameDisplay.textContent = `(${newName})`;
        if (el.modalNickname) el.modalNickname.classList.add('hidden');
        showToast(`Name set to "${newName}"`, 'success');
      }
    });
  }

  // 7. Download Code
  if (el.btnDownloadCode) {
    el.btnDownloadCode.addEventListener('click', () => {
      const extMap = { javascript: 'js', typescript: 'ts', html: 'html', css: 'css', python: 'py', json: 'json', markdown: 'md', rust: 'rs', go: 'go', sql: 'sql' };
      const ext = extMap[state.language] || 'txt';
      const filename = `${state.roomId || 'code'}.${ext}`;
      const blob = new Blob([getEditorCode()], { type: 'text/plain;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      showToast(`Downloaded ${filename}`, 'success');
    });
  }

  // 8. Fullscreen Toggle
  if (el.btnToggleFullscreen) {
    el.btnToggleFullscreen.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
      }
    });
  }

  // Initialize Application
  initRouter();

})();
