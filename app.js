/**
 * CodeShift — Real-Time Collaborative Code Workspace
 * Instant code sharing with zero login, auto-save, clean URLs and real-time multi-device sync.
 */

(function () {
  'use strict';

  // --- State Architecture ---
  const state = {
    roomId: null,
    userId: localStorage.getItem('codeshift_user_id') || ('anon_' + Math.random().toString(36).substring(2, 9)),
    userName: 'Anonymous',
    userColor: getRandomColor(),
    firebaseBaseUrl: 'https://codeshift-realtimedb-default-rtdb.firebaseio.com',
    language: 'javascript',
    peers: new Map(),
    broadcastChannel: null,
    sseSource: null,
    presenceInterval: null,
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

  localStorage.setItem('codeshift_user_id', state.userId);

  function getRandomColor() {
    const palette = ['#8B7CFF', '#38BDF8', '#10B981', '#F59E0B', '#EC4899', '#C084FC'];
    return palette[Math.floor(Math.random() * palette.length)];
  }

  function sanitizeFirebaseKey(key) {
    return (key || 'default').replace(/[.#$\[\]\/]/g, '_');
  }

  // --- Clean URL Routing (NO '#' HASH) ---
  function getRepoPrefix() {
    return window.location.pathname.startsWith('/codeshift') ? '/codeshift' : '';
  }

  function getCleanRoomUrl(roomId) {
    const id = roomId || state.roomId || 'code';
    const prefix = getRepoPrefix();
    return window.location.origin + prefix + '/' + encodeURIComponent(id);
  }

  function extractRoomSlug() {
    // 1. First check pathname: e.g. /codeshift/hack-llyb or /hack-llyb
    let path = window.location.pathname;
    const prefix = getRepoPrefix();
    if (prefix && path.startsWith(prefix)) {
      path = path.slice(prefix.length);
    }
    path = path.replace(/^\/+/, '').trim();
    if (path && path !== 'index.html' && path !== '404.html' && path !== 'new') {
      return decodeURIComponent(path);
    }

    // 2. Check hash fallback (if someone loaded an old link with #)
    let hash = (window.location.hash || '').slice(1).replace(/^\/+/, '').trim();
    if (hash && hash !== 'new') {
      const cleanSlug = decodeURIComponent(hash);
      // Clean up URL to remove the hash
      window.history.replaceState(null, '', getCleanRoomUrl(cleanSlug));
      return cleanSlug;
    }

    return null;
  }

  function generateRoomSlug() {
    const prefixes = ['pair', 'dev', 'hack', 'flow', 'code', 'sync'];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const num = Math.random().toString(36).substring(2, 6);
    return `${prefix}-${num}`;
  }

  function navigateToRoom(roomId) {
    const cleanUrl = getCleanRoomUrl(roomId);
    window.history.pushState(null, '', cleanUrl);
    enterRoom(roomId);
  }

  // --- Sound Synthesizer ---
  const audioCtx = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext))
    ? new (window.AudioContext || window.webkitAudioContext)()
    : null;

  function playClickSound() {
    if (!state.settings.sound || !audioCtx) return;
    try {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      const now = audioCtx.currentTime;
      osc.frequency.setValueAtTime(650, now);
      gain.gain.setValueAtTime(0.012, now);
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
      toast.style.borderColor = 'rgba(139, 124, 255, 0.4)';
      toast.innerHTML = `<span style="color:#8b7cff;">⚡</span> <span>${message}</span>`;
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
    saveStatusContainer: document.getElementById('save-status-container'),
    saveStatusDot: document.getElementById('save-status-dot'),
    saveStatusText: document.getElementById('save-status-text'),
    onlineUsersBadge: document.getElementById('online-users-badge'),
    onlineUsersCount: document.getElementById('online-users-count'),
    btnOpenSettings: document.getElementById('btn-open-settings'),
    btnDownloadCode: document.getElementById('btn-download-code'),
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
    btnCloseSettings: document.getElementById('btn-close-settings')
  };

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

  // --- Router Engine ---
  function initRouter() {
    window.addEventListener('popstate', handleRoute);
    window.addEventListener('hashchange', handleRoute);
    handleRoute();
  }

  function handleRoute() {
    const slug = extractRoomSlug();
    if (!slug) {
      const newSlug = generateRoomSlug();
      const cleanUrl = getCleanRoomUrl(newSlug);
      window.history.replaceState(null, '', cleanUrl);
      enterRoom(newSlug);
    } else {
      enterRoom(slug);
    }
  }

  function enterRoom(roomId) {
    if (state.roomId === roomId && state.monacoInstance) return;
    state.roomId = roomId;

    // Update UI elements
    if (el.roomNavId) el.roomNavId.textContent = '/' + roomId;
    document.title = `CodeShift • /${roomId}`;

    // Load cached code if present, otherwise clean empty string
    const cachedCode = localStorage.getItem(`codeshift_code_${roomId}`);
    const initialCode = cachedCode !== null ? cachedCode : '';

    // Initialize Monaco Editor
    initMonacoEditor(initialCode);

    // Initialize Real-Time Sync Engines
    initRealtimeSync(roomId);

    // Start Online Presence Heartbeat
    startPresenceEngine(roomId);

    updateSaveIndicator('saved', 'Saved');
  }

  // --- Monaco Editor Engine ---
  function initMonacoEditor(initialCode) {
    if (state.monacoInstance) {
      state.monacoInstance.setValue(initialCode);
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

          const pendingCode = getEditorCode();
          const codeToLoad = pendingCode !== '' ? pendingCode : initialCode;

          state.monacoInstance = monaco.editor.create(container, {
            value: codeToLoad,
            language: 'javascript',
            theme: 'codeshift-mesh',
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

    // Lightweight Native Fallback
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
    monaco.editor.defineTheme('codeshift-mesh', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '64748B', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'EB4D4B', fontStyle: 'bold' },
        { token: 'string', foreground: '10B981' },
        { token: 'number', foreground: 'F59E0B' },
        { token: 'type', foreground: '38BDF8' },
        { token: 'function', foreground: '8B7CFF' },
        { token: 'identifier', foreground: 'F8FAFC' }
      ],
      colors: {
        'editor.background': '#11141C00',
        'editor.foreground': '#F8FAFC',
        'editorLineNumber.foreground': '#334155',
        'editorLineNumber.activeForeground': '#8B7CFF',
        'editorCursor.foreground': '#EB4D4B',
        'editor.selectionBackground': '#8B7CFF33',
        'editor.lineHighlightBackground': '#1E233340',
        'editorIndentGuide.background1': '#1E2333',
        'editorIndentGuide.activeBackground1': '#8B7CFF40'
      }
    });
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
    if (!el.editorTextarea || !el.editorLineNumbers) return;
    const text = el.editorTextarea.value;
    const lines = text.split('\n').length;
    let nums = '';
    for (let i = 1; i <= lines; i++) nums += i + '\n';
    el.editorLineNumbers.innerText = nums;
    if (el.codeStats) el.codeStats.textContent = `${lines} ${lines === 1 ? 'line' : 'lines'}`;
  }

  function updateCodeStats() {
    const code = getEditorCode();
    const lines = (code || '').split('\n').length;
    if (el.codeStats) el.codeStats.textContent = `${lines} ${lines === 1 ? 'line' : 'lines'}`;
  }

  // --- Local Typing & Instant Auto-Save Engine ---
  function onLocalCodeChange(code) {
    updateLineNumbers();
    updateCodeStats();
    playClickSound();

    // Visual indicator
    updateSaveIndicator('saving', 'Saving...');

    // 1. Broadcast immediately to other tabs on same machine (0ms)
    if (state.broadcastChannel) {
      state.broadcastChannel.postMessage({
        type: 'DOC_UPDATE',
        roomId: state.roomId,
        code: code,
        senderId: state.userId
      });
    }

    clearTimeout(state.autoSaveTimer);
    state.autoSaveTimer = setTimeout(() => {
      // 2. Cache in localStorage
      try {
        localStorage.setItem(`codeshift_code_${state.roomId}`, code);
      } catch (e) {}

      // 3. Write directly to Firebase Realtime Database REST API
      const safeKey = sanitizeFirebaseKey(state.roomId);
      const url = `${state.firebaseBaseUrl}/codeshare_rooms/${safeKey}/data.json`;

      fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code,
          updatedAt: Date.now()
        })
      })
      .then(res => res.json())
      .then(() => {
        updateSaveIndicator('saved', 'Saved');
      })
      .catch(() => {
        updateSaveIndicator('saved', 'Saved');
      });

    }, 250);
  }

  // --- Real-Time Sync Engine (Firebase REST + SSE + BroadcastChannel) ---
  function initRealtimeSync(roomId) {
    const safeKey = sanitizeFirebaseKey(roomId);

    // 1. Immediate REST Fetch: Ensures newly opened tabs get existing code instantly
    fetch(`${state.firebaseBaseUrl}/codeshare_rooms/${safeKey}/data.json`)
      .then(res => res.json())
      .then(data => {
        if (data && typeof data.code === 'string') {
          if (data.code !== getEditorCode()) {
            setEditorCode(data.code);
            updateSaveIndicator('saved', 'Saved');
          }
        }
      })
      .catch(() => {});

    // 2. Server-Sent Events (SSE) Stream: Live real-time push from Firebase across devices
    if (state.sseSource) {
      state.sseSource.close();
      state.sseSource = null;
    }

    try {
      const sseUrl = `${state.firebaseBaseUrl}/codeshare_rooms/${safeKey}/data.json`;
      state.sseSource = new EventSource(sseUrl);

      state.sseSource.addEventListener('put', (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload && payload.data && typeof payload.data.code === 'string') {
            if (payload.data.code !== getEditorCode() && !state.isApplyingRemoteChange) {
              setEditorCode(payload.data.code);
              updateSaveIndicator('saved', 'Saved');
            }
          }
        } catch (e) {}
      });

      state.sseSource.addEventListener('patch', (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload && payload.data && typeof payload.data.code === 'string') {
            if (payload.data.code !== getEditorCode() && !state.isApplyingRemoteChange) {
              setEditorCode(payload.data.code);
              updateSaveIndicator('saved', 'Saved');
            }
          }
        } catch (e) {}
      });
    } catch (err) {
      console.warn('SSE stream error:', err);
    }

    // 3. BroadcastChannel: Instant synchronization between tabs on the same computer
    if (state.broadcastChannel) {
      state.broadcastChannel.close();
    }

    try {
      state.broadcastChannel = new BroadcastChannel(`codeshift_${safeKey}`);
      state.broadcastChannel.onmessage = (event) => {
        const msg = event.data;
        if (!msg) return;
        if (msg.type === 'DOC_UPDATE' && msg.senderId !== state.userId) {
          if (msg.code !== getEditorCode() && !state.isApplyingRemoteChange) {
            setEditorCode(msg.code);
            updateSaveIndicator('saved', 'Saved');
          }
        } else if (msg.type === 'PRESENCE_PING') {
          pollPresence(roomId);
        }
      };
    } catch (e) {}
  }

  // --- Multi-User Presence & Online Count Engine ---
  function startPresenceEngine(roomId) {
    if (state.presenceInterval) {
      clearInterval(state.presenceInterval);
    }

    sendPresenceHeartbeat(roomId);
    pollPresence(roomId);

    state.presenceInterval = setInterval(() => {
      sendPresenceHeartbeat(roomId);
      pollPresence(roomId);
    }, 4000);
  }

  function sendPresenceHeartbeat(roomId) {
    const safeKey = sanitizeFirebaseKey(roomId);
    const url = `${state.firebaseBaseUrl}/codeshare_rooms/${safeKey}/presence/${state.userId}.json`;

    fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lastSeen: Date.now(),
        id: state.userId
      })
    }).catch(() => {});

    // Notify local tabs
    if (state.broadcastChannel) {
      state.broadcastChannel.postMessage({ type: 'PRESENCE_PING', senderId: state.userId });
    }
  }

  function pollPresence(roomId) {
    const safeKey = sanitizeFirebaseKey(roomId);
    const url = `${state.firebaseBaseUrl}/codeshare_rooms/${safeKey}/presence.json`;

    fetch(url)
      .then(res => res.json())
      .then(presenceMap => {
        if (!presenceMap) {
          updateOnlineCountUI(1);
          return;
        }

        const now = Date.now();
        let activeCount = 0;

        for (const [uid, user] of Object.entries(presenceMap)) {
          if (user && user.lastSeen && (now - user.lastSeen < 12000)) {
            activeCount++;
          }
        }

        updateOnlineCountUI(Math.max(1, activeCount));
      })
      .catch(() => {
        updateOnlineCountUI(1);
      });
  }

  function updateOnlineCountUI(count) {
    if (!el.onlineUsersCount) return;
    el.onlineUsersCount.textContent = `${count} online`;
  }

  // Clean presence on tab close
  window.addEventListener('beforeunload', () => {
    if (state.roomId) {
      const safeKey = sanitizeFirebaseKey(state.roomId);
      const url = `${state.firebaseBaseUrl}/codeshare_rooms/${safeKey}/presence/${state.userId}.json`;
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, 'null');
      } else {
        fetch(url, { method: 'DELETE', keepalive: true }).catch(() => {});
      }
    }
  });

  // --- Copy Share Link Function ---
  function copyShareLink() {
    const fullUrl = getCleanRoomUrl();

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(fullUrl).then(() => {
        showToast('Clean room link copied! Share with anyone 📋', 'success');
      }).catch(() => {
        prompt('Copy this room link:', fullUrl);
      });
    } else {
      prompt('Copy this room link:', fullUrl);
    }

    if (el.inputShareLink) el.inputShareLink.value = fullUrl;
  }

  // --- Universal Modal Handler (Fixes '✕ is not working') ---
  document.querySelectorAll('.modal-close-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.modal-backdrop');
      if (modal) modal.classList.add('hidden');
    });
  });

  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.classList.add('hidden');
    });
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-backdrop').forEach(modal => modal.classList.add('hidden'));
    }
  });

  // --- Event Bindings ---
  // 1. Brand Logo: creates clean new room
  if (el.brandLogo) {
    el.brandLogo.addEventListener('click', () => {
      navigateToRoom(generateRoomSlug());
    });
  }

  // 2. Share & Copy Link Button
  if (el.btnShareRoom) el.btnShareRoom.addEventListener('click', copyShareLink);

  // 3. Room Pill: click to copy or switch
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

  // 4. New Room Button
  if (el.btnCreateNewRoom) {
    el.btnCreateNewRoom.addEventListener('click', () => {
      navigateToRoom(generateRoomSlug());
    });
  }

  // 5. Download Code Button
  if (el.btnDownloadCode) {
    el.btnDownloadCode.addEventListener('click', () => {
      const filename = `${state.roomId || 'codeshift'}.txt`;
      const blob = new Blob([getEditorCode()], { type: 'text/plain;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      showToast(`Exported ${filename}`, 'success');
    });
  }

  // 6. Settings Modal
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

  // 7. Share Modal Buttons
  if (el.btnModalCopyLink) el.btnModalCopyLink.addEventListener('click', copyShareLink);
  if (el.btnModalDoneShare) {
    el.btnModalDoneShare.addEventListener('click', () => {
      if (el.modalShare) el.modalShare.classList.add('hidden');
    });
  }
  if (el.btnCloseShare) {
    el.btnCloseShare.addEventListener('click', () => {
      if (el.modalShare) el.modalShare.classList.add('hidden');
    });
  }

  // --- Bootstrap App ---
  initRouter();

})();
