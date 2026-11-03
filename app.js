/**
 * CodeShare — Real-Time Collaborative Code Sharing Engine
 * "Share Code in Real-Time Seamlessly Without Login"
 *
 * Features:
 * - Instant distraction-free mesh-type code editor
 * - Keystroke auto-save with visual indicator (● Saved / ● Saving...)
 * - Serverless multi-device cloud persistence (Firebase Realtime Database)
 * - Direct WebRTC peer-to-peer sync (PeerJS)
 * - Native Node.js RFC 6455 WebSocket integration (server.js)
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
    firebaseUrl: localStorage.getItem('codeshare_firebase_url') || 'https://codeshift-realtimedb-default-rtdb.firebaseio.com',
    serverUrl: localStorage.getItem('codeshift_ws_server') || (window.CODESHIFT_WS_SERVER || ''),
    language: localStorage.getItem('codeshare_default_lang') || 'javascript',
    isHost: false,
    peers: new Map(), // peerId -> { userId, userName, userColor }
    peerJsInstance: null,
    peerConnections: new Map(),
    firebaseApp: null,
    firebaseDb: null,
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

  const DEFAULT_TEMPLATES = {
    javascript: `// CodeShare • Real-time Collaborative Code Workspace
// Auto-saves on every keystroke. Share the URL to collaborate instantly!

function calculatePrimes(max) {
  const primes = [];
  for (let i = 2; i <= max; i++) {
    let isPrime = true;
    for (let j = 2; j <= Math.sqrt(i); j++) {
      if (i % j === 0) { isPrime = false; break; }
    }
    if (isPrime) primes.push(i);
  }
  return primes;
}

console.log("Primes up to 50:", calculatePrimes(50));
`,
    typescript: `// CodeShare • TypeScript Environment
interface SessionConfig {
  roomId: string;
  collaborators: number;
  autoSave: boolean;
}

const activeSession: SessionConfig = {
  roomId: "${state.roomId || 'demo'}",
  collaborators: 2,
  autoSave: true
};

console.log("TypeScript session loaded:", activeSession);
`,
    python: `# CodeShare • Python Workspace
# Auto-saved and synchronized across all connected devices in real time.

def fibonacci(n):
    sequence = [0, 1]
    while len(sequence) < n:
        sequence.append(sequence[-1] + sequence[-2])
    return sequence

print("Fibonacci sequence:", fibonacci(10))
`,
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>CodeShare Interactive HTML</title>
  <style>
    body { background: #0d0f15; color: #f8fafc; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; }
    .card { background: #161a24; border: 1px solid #eb4d4b; padding: 28px; border-radius: 8px; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <h1>CodeShare Real-Time Editor</h1>
    <p>Live synchronized HTML & CSS rendered across devices.</p>
  </div>
</body>
</html>`,
    css: `/* CodeShare CSS Styling */
:root {
  --coral-accent: #eb4d4b;
  --dark-canvas: #0d0f15;
}

.code-container {
  font-family: 'JetBrains Mono', monospace;
  background: var(--dark-canvas);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 16px;
  border-radius: 6px;
}`,
    json: `{
  "service": "CodeShare",
  "realtime": true,
  "cloudPersistence": "Firebase & WebRTC Ready",
  "autoSave": "Instant Debounced Keystroke"
}`,
    sql: `-- CodeShare SQL Workspace
SELECT 
  room_id,
  code_snippet,
  collaborators_count,
  last_updated
FROM codeshare_sessions
ORDER BY last_updated DESC;`,
    rust: `// CodeShare Rust Environment
fn main() {
    let app = "CodeShare";
    println!("Seamless real-time code sharing with {}!", app);
}`,
    go: `// CodeShare Go Environment
package main
import "fmt"

func main() {
    fmt.Println("CodeShare: Instant code sharing without login.")
}`,
    markdown: `# CodeShare Collaborative Document
Share code in real-time with developers worldwide.
- **Auto-Save**: Keystrokes are immediately saved.
- **Seamless Sync**: Connect multiple computers via WebRTC & Firebase.
- **One Link**: Send this link to anyone to code together.`,
    plaintext: `CodeShare — Simple, instant code sharing.
Type or paste anything here. It auto-saves instantly.`
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
      gain.gain.setValueAtTime(0.02, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      osc.start(now);
      osc.stop(now + 0.04);
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
    btnHeroLaunchRoom: document.getElementById('btn-hero-launch-room'),
    saveStatusContainer: document.getElementById('save-status-container'),
    saveStatusDot: document.getElementById('save-status-dot'),
    saveStatusText: document.getElementById('save-status-text'),
    selectLanguage: document.getElementById('select-language'),
    onlineUsersCount: document.getElementById('online-users-count'),
    userNicknameDisplay: document.getElementById('user-nickname-display'),
    btnChangeNickname: document.getElementById('btn-change-nickname'),
    btnOpenCloudSync: document.getElementById('btn-open-cloud-sync'),
    cloudSyncBadge: document.getElementById('cloud-sync-badge'),
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
    modalCloudSync: document.getElementById('modal-cloud-sync'),
    inputFirebaseUrl: document.getElementById('input-firebase-url'),
    settingServerUrl: document.getElementById('setting-server-url'),
    btnSaveCloudSync: document.getElementById('btn-save-cloud-sync'),
    btnTestServerPing: document.getElementById('btn-test-server-ping'),
    btnCloseCloudSync: document.getElementById('btn-close-cloud-sync'),
    syncDiagnostics: document.getElementById('sync-diagnostics'),
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
    // 1. Check for parameters (e.g. server, fb, lang)
    try {
      const searchParams = new URLSearchParams(window.location.search);
      if (searchParams.get('fb')) {
        state.firebaseUrl = searchParams.get('fb');
        localStorage.setItem('codeshare_firebase_url', state.firebaseUrl);
      }
      if (searchParams.get('server')) {
        state.serverUrl = searchParams.get('server');
        localStorage.setItem('codeshift_ws_server', state.serverUrl);
      }
    } catch (e) {}

    const rawHash = (window.location.hash || '').slice(1);
    const [pathPart, queryPart] = rawHash.split('?');
    if (queryPart) {
      try {
        const hashParams = new URLSearchParams(queryPart);
        if (hashParams.get('fb')) {
          state.firebaseUrl = hashParams.get('fb');
          localStorage.setItem('codeshare_firebase_url', state.firebaseUrl);
        }
        if (hashParams.get('server')) {
          state.serverUrl = hashParams.get('server');
          localStorage.setItem('codeshift_ws_server', state.serverUrl);
        }
      } catch (e) {}
    }

    const cleanPath = (pathPart || '').replace(/^\/+/, '').trim();

    // If root or new, generate instant room slug
    if (!cleanPath || cleanPath === 'new') {
      const newSlug = generateRoomSlug();
      window.location.hash = `/${newSlug}`;
      return;
    }

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

    // Load cached code from localStorage if available
    const cachedCode = localStorage.getItem(`cs_code_${roomId}`);
    const cachedLang = localStorage.getItem(`cs_lang_${roomId}`);
    if (cachedLang) {
      state.language = cachedLang;
      if (el.selectLanguage) el.selectLanguage.value = cachedLang;
    }

    const initialCode = cachedCode !== null ? cachedCode : (DEFAULT_TEMPLATES[state.language] || DEFAULT_TEMPLATES.javascript);

    // Initialize Monaco Editor
    initMonacoEditor(initialCode);

    // Initialize Real-Time Synchronization Engines:
    // 1. Firebase Realtime Database
    initFirebaseSync(roomId);
    // 2. Direct WebRTC Peer Sync (PeerJS)
    initPeerSync(roomId);
    // 3. Native WebSocket Server (if running)
    connectWebSocket(roomId);

    updateSaveIndicator('saved', 'Auto-Save Ready');
    showToast(`Connected to room /${roomId}`, 'info');
  }

  function navigateToRoom(roomId) {
    window.location.hash = `/${encodeURIComponent(roomId)}`;
  }

  function generateRoomSlug() {
    const prefixes = ['knot', 'pair', 'flow', 'dev', 'shift', 'sync', 'hack', 'code'];
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

          state.monacoInstance = monaco.editor.create(container, {
            value: initialCode,
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
    return el.editorTextarea.value;
  }

  function setEditorCode(code) {
    state.isApplyingRemoteChange = true;
    if (state.monacoInstance) {
      const position = state.monacoInstance.getPosition();
      state.monacoInstance.setValue(code);
      if (position) state.monacoInstance.setPosition(position);
    } else {
      el.editorTextarea.value = code;
      updateLineNumbers();
    }
    updateCodeStats();
    setTimeout(() => {
      state.isApplyingRemoteChange = false;
    }, 100);
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
        state.firebaseDb.ref('codeshare_rooms/' + state.roomId).update({
          code: code,
          language: state.language,
          author: state.userName,
          updatedAt: Date.now()
        }).then(() => {
          updateSaveIndicator('saved', 'Saved in Cloud (Firebase)');
        }).catch(() => {
          updateSaveIndicator('saved', 'Saved Locally');
        });
      } else {
        updateSaveIndicator('saved', 'Saved Locally & Peers');
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

    }, 280);
  }

  // --- 1. Firebase Realtime Database Engine ---
  function initFirebaseSync(roomId) {
    const dbUrl = (state.firebaseUrl || localStorage.getItem('codeshare_firebase_url') || 'https://codeshift-realtimedb-default-rtdb.firebaseio.com').trim();
    if (!dbUrl || typeof firebase === 'undefined') {
      if (el.cloudSyncBadge) el.cloudSyncBadge.textContent = 'Cloud Sync (Setup)';
      return;
    }

    try {
      if (!state.firebaseApp) {
        state.firebaseApp = firebase.initializeApp({ databaseURL: dbUrl }, 'cs_app_' + Date.now());
        state.firebaseDb = state.firebaseApp.database();
        if (el.cloudSyncBadge) el.cloudSyncBadge.textContent = 'Firebase Synced 🟢';
      }

      const roomRef = state.firebaseDb.ref('codeshare_rooms/' + roomId);

      // Listen for remote updates
      roomRef.on('value', (snapshot) => {
        const val = snapshot.val();
        if (val && val.code !== undefined && !state.isApplyingRemoteChange) {
          if (val.code !== getEditorCode()) {
            setEditorCode(val.code);
            if (val.language && val.language !== state.language) {
              state.language = val.language;
              el.selectLanguage.value = val.language;
              updateLanguageInMonaco(val.language);
            }
            updateSaveIndicator('saved', 'Synced with Cloud');
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

      peer.on('open', (id) => {
        updatePeerCounter();
        // Try connecting to known room host / peers
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
        // If ID taken, register as guest peer
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

      // Send initial document state to new peer
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
          updateSaveIndicator('saved', `Synced from ${data.userName || 'peer'}`);
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
      el.onlineUsersCount.textContent = `${count} ${count === 1 ? 'user' : 'users'} online`;
    }
    if (el.syncStatus) {
      el.syncStatus.textContent = count > 1 ? `Peer Mesh Connected (${count})` : 'Mesh Ready (Share link to pair)';
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
      state.ws.onopen = () => {
        state.wsConnected = true;
        if (el.syncStatus) el.syncStatus.textContent = 'Live Server WebSocket ⚡';
      };
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
              updateSaveIndicator('saved', 'Synced from Server');
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
        updateSaveIndicator('saved', 'Synced (Local Tab)');
      }
    };
  }

  // --- Share Link Helper ---
  function openShareModal() {
    let url = window.location.href;
    const fbUrl = state.firebaseUrl || localStorage.getItem('codeshare_firebase_url');
    if (fbUrl && !url.includes('fb=')) {
      const sep = url.includes('?') ? '&' : '?';
      url = `${url}${sep}fb=${encodeURIComponent(fbUrl)}`;
    }

    if (el.inputShareLink) el.inputShareLink.value = url;
    if (el.modalShare) {
      el.modalShare.classList.remove('hidden');
      el.modalShare.classList.add('flex');
      if (el.inputShareLink) el.inputShareLink.select();
    }

    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        showToast('Room link copied! Share with collaborators 📋', 'success');
      }).catch(() => {});
    }
  }

  // --- Event Bindings ---
  // 1. Share & Copy
  if (el.btnShareRoom) el.btnShareRoom.addEventListener('click', openShareModal);
  if (el.btnCopyRoomLink) el.btnCopyRoomLink.addEventListener('click', openShareModal);

  if (el.btnModalCopyLink) {
    el.btnModalCopyLink.addEventListener('click', () => {
      if (el.inputShareLink) {
        el.inputShareLink.select();
        navigator.clipboard.writeText(el.inputShareLink.value).then(() => {
          showToast('Link copied to clipboard! 📋', 'success');
          el.btnModalCopyLink.textContent = 'Copied!';
          setTimeout(() => { if (el.btnModalCopyLink) el.btnModalCopyLink.textContent = 'Copy Link'; }, 2000);
        });
      }
    });
  }

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

  // 2. New Room
  if (el.btnHeroLaunchRoom) {
    el.btnHeroLaunchRoom.addEventListener('click', () => {
      navigateToRoom(generateRoomSlug());
    });
  }

  // 3. Language Selector
  if (el.selectLanguage) {
    el.selectLanguage.addEventListener('change', (e) => {
      const lang = e.target.value;
      state.language = lang;
      localStorage.setItem('codeshare_default_lang', lang);
      updateLanguageInMonaco(lang);
      onLocalCodeChange(getEditorCode());
      showToast(`Language set to ${e.target.options[e.target.selectedIndex].text}`);
    });
  }

  // 4. Cloud Sync / Firebase Modal
  if (el.btnOpenCloudSync) {
    el.btnOpenCloudSync.addEventListener('click', () => {
      if (el.inputFirebaseUrl) {
        el.inputFirebaseUrl.value = state.firebaseUrl || localStorage.getItem('codeshare_firebase_url') || '';
      }
      if (el.settingServerUrl) {
        el.settingServerUrl.value = state.serverUrl || localStorage.getItem('codeshift_ws_server') || '';
      }
      if (el.modalCloudSync) {
        el.modalCloudSync.classList.remove('hidden');
        el.modalCloudSync.classList.add('flex');
      }
    });
  }

  if (el.btnCloseCloudSync) {
    el.btnCloseCloudSync.addEventListener('click', () => {
      if (el.modalCloudSync) el.modalCloudSync.classList.add('hidden');
    });
  }

  if (el.btnSaveCloudSync) {
    el.btnSaveCloudSync.addEventListener('click', () => {
      const fbUrl = el.inputFirebaseUrl ? el.inputFirebaseUrl.value.trim() : '';
      const sUrl = el.settingServerUrl ? el.settingServerUrl.value.trim() : '';

      state.firebaseUrl = fbUrl;
      if (fbUrl) localStorage.setItem('codeshare_firebase_url', fbUrl);
      else localStorage.removeItem('codeshare_firebase_url');

      state.serverUrl = sUrl;
      if (sUrl) localStorage.setItem('codeshift_ws_server', sUrl);
      else localStorage.removeItem('codeshift_ws_server');

      if (state.roomId) {
        initFirebaseSync(state.roomId);
        connectWebSocket(state.roomId);
      }

      if (el.modalCloudSync) el.modalCloudSync.classList.add('hidden');
      showToast('Cloud database configuration saved!', 'success');
    });
  }

  if (el.btnTestServerPing) {
    el.btnTestServerPing.addEventListener('click', async () => {
      const fbUrl = (el.inputFirebaseUrl.value || '').trim();
      if (!fbUrl) {
        showToast('Please enter a Firebase Database URL to test', 'error');
        return;
      }
      try {
        el.btnTestServerPing.textContent = 'Testing...';
        const testRes = await fetch(`${fbUrl.replace(/\/$/, '')}/.json?shallow=true`, { method: 'GET' });
        if (testRes.ok) {
          showToast('Firebase Realtime Database reachable! ⚡', 'success');
        } else {
          showToast(`Firebase test responded with HTTP ${testRes.status}`, 'error');
        }
      } catch (e) {
        showToast('Connection failed: ' + e.message, 'error');
      } finally {
        el.btnTestServerPing.textContent = 'Test Connection';
      }
    });
  }

  // 5. Settings / Preferences
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
        showToast(`Display name set to "${newName}"`, 'success');
      }
    });
  }

  // 7. Download Code
  if (el.btnDownloadCode) {
    el.btnDownloadCode.addEventListener('click', () => {
      const extMap = { javascript: 'js', typescript: 'ts', html: 'html', css: 'css', python: 'py', json: 'json', markdown: 'md', rust: 'rs', go: 'go', sql: 'sql' };
      const ext = extMap[state.language] || 'txt';
      const filename = `codeshare-${state.roomId || 'code'}.${ext}`;
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
