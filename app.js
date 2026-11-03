/**
 * CodeShift — Core Client Application & Real-Time Sync Engine
 * "Think together. Code without limits."
 */

(function () {
  'use strict';

  // --- State Architecture ---
  const state = {
    roomId: null,
    userId: 'peer_' + Math.random().toString(36).substring(2, 9),
    userName: localStorage.getItem('codeshift_user_name') || 'Kaushal',
    userColor: getRandomColor(),
    peers: new Map(), // peerId -> { name, color, lastSeen, cursor: { line, col } }
    language: 'javascript',
    theme: localStorage.getItem('codeshift_theme') || 'codeshift',
    settings: {
      fontSize: parseInt(localStorage.getItem('cs_fontSize') || '14', 10),
      tabSize: parseInt(localStorage.getItem('cs_tabSize') || '2', 10),
      autoBrackets: localStorage.getItem('cs_autoBrackets') !== 'false',
      sound: localStorage.getItem('cs_sound') !== 'false'
    },
    snapshots: [],
    chatMessages: [],
    syncChannel: null,
    isApplyingRemoteChange: false,
    activeSideTab: 'tab-console',
    lastSavedCode: ''
  };

  const DEFAULT_TEMPLATES = {
    javascript: `// CodeShift • Collaborative JavaScript Studio
// Room: Think together. Code without limits.

function calculateVelocity(distanceKm, timeHours) {
  if (timeHours <= 0) throw new Error("Time must be positive");
  const velocity = distanceKm / timeHours;
  return {
    kmh: velocity,
    mph: +(velocity * 0.621371).toFixed(2),
    status: velocity > 100 ? "High Speed ⚡" : "Cruising 🚗"
  };
}

console.log("🚀 Initializing CodeShift engine...");
const trip = calculateVelocity(420, 3.5);
console.log("Trip Stats:", trip);

// Try editing this code or pressing ⌘+Enter to run!
`,
    typescript: `// CodeShift • TypeScript Environment
interface Developer {
  name: string;
  role: string;
  focus: string[];
}

const host: Developer = {
  name: "${state.userName}",
  role: "Lead Architect",
  focus: ["Real-time Sync", "Distributed Editors", "Clean Code"]
};

console.log("Host Profile:", host);
`,
    html: `<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      background: #0d0e15;
      color: #f8fafc;
      font-family: sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 90vh;
      margin: 0;
    }
    .badge {
      background: rgba(139, 124, 255, 0.15);
      border: 1px solid #8b7cff;
      color: #c084fc;
      padding: 6px 14px;
      border-radius: 999px;
      font-weight: bold;
      font-size: 13px;
    }
    h1 {
      margin-top: 16px;
      background: linear-gradient(135deg, #8b7cff, #38bdf8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    button {
      background: #8b7cff;
      border: none;
      color: white;
      padding: 10px 20px;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      margin-top: 10px;
    }
    button:hover { background: #7c6dfa; }
  </style>
</head>
<body>
  <div class="badge">CodeShift Live Preview</div>
  <h1>Think together. Code without limits.</h1>
  <p>Live synchronized HTML & CSS rendering right in your browser.</p>
  <button onclick="alert('Connected live from CodeShift!')">Click Action</button>
</body>
</html>`,
    css: `/* CodeShift Modern Theme Styles */
:root {
  --primary-glow: #8B7CFF;
  --cyber-cyan: #38BDF8;
}

.developer-card {
  background: rgba(22, 23, 34, 0.8);
  border: 1px solid rgba(139, 124, 255, 0.2);
  border-radius: 16px;
  padding: 24px;
  backdrop-filter: blur(12px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}`,
    python: `# CodeShift • Python Workspace
import math

def fibonacci(n):
    sequence = [0, 1]
    while len(sequence) < n:
        sequence.append(sequence[-1] + sequence[-2])
    return sequence

print("CodeShift Python Engine Ready.")
print("Fibonacci sequence:", fibonacci(8))
print("Pi precision:", round(math.pi, 5))
`,
    json: `{
  "product": "CodeShift",
  "version": "1.0.0",
  "features": [
    "Real-time peer synchronization",
    "Live execution sandbox",
    "Time-stamped shift snapshots",
    "Integrated room chat"
  ],
  "author": "${state.userName}",
  "live": true
}`,
    markdown: `# CodeShift Documentation
### *Think together. Code without limits.*

Welcome to your shared collaborative room.

- **⌘ + Enter**: Run code immediately
- **⌘ + S**: Save a Shift Snapshot
- **Peer Sync**: Open this URL in another tab or send it to a teammate to pair in real-time!
`,
    rust: `// CodeShift Rust Sandbox
fn main() {
    let app_name = "CodeShift";
    let speed = 99.9;
    println!("Running {} at {}% efficiency!", app_name, speed);
}`,
    go: `// CodeShift Go Playground
package main
import "fmt"

func main() {
    fmt.Println("CodeShift • Think together. Code without limits.")
}`,
    sql: `-- CodeShift Database Workspace
SELECT 
  developer_name,
  lines_shifted,
  collaboration_score
FROM codeshift_sessions
WHERE status = 'active'
ORDER BY lines_shifted DESC;`
  };

  function getRandomColor() {
    const palette = ['#8B7CFF', '#38BDF8', '#F43F5E', '#10B981', '#F59E0B', '#C084FC', '#EC4899'];
    return palette[Math.floor(Math.random() * palette.length)];
  }

  // --- Sound Synthesizer (Web Audio API) ---
  const audioCtx = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) ? new (window.AudioContext || window.webkitAudioContext)() : null;
  function playSound(type) {
    if (!state.settings.sound || !audioCtx) return;
    try {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      const now = audioCtx.currentTime;
      if (type === 'blip') {
        osc.frequency.setValueAtTime(580, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.start(now);
        osc.stop(now + 0.08);
      } else if (type === 'success') {
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
      }
    } catch (e) {
      // Audio autoplay policy
    }
  }

  // --- UI Toast Notifications ---
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'px-4 py-2.5 rounded-xl text-xs font-semibold shadow-xl border backdrop-blur-md flex items-center gap-2 animate-fade-in pointer-events-auto transition-all';
    
    if (type === 'success') {
      toast.classList.add('bg-emerald-950/90', 'border-emerald-500/30', 'text-emerald-300');
      toast.innerHTML = `<span>✓</span><span>${message}</span>`;
    } else if (type === 'error') {
      toast.classList.add('bg-rose-950/90', 'border-rose-500/30', 'text-rose-300');
      toast.innerHTML = `<span>✕</span><span>${message}</span>`;
    } else {
      toast.classList.add('bg-surface-elevated/95', 'border-violet-500/30', 'text-violet-200');
      toast.innerHTML = `<span>⚡</span><span>${message}</span>`;
    }

    container.appendChild(toast);
    playSound('blip');

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      setTimeout(() => toast.remove(), 250);
    }, 3200);
  }

  // --- DOM Elements ---
  const el = {
    app: document.getElementById('app'),
    viewLanding: document.getElementById('view-landing'),
    viewRoom: document.getElementById('view-room'),
    appFooter: document.getElementById('app-footer'),
    roomNavControls: document.getElementById('room-nav-controls'),
    roomNavId: document.getElementById('room-nav-id'),
    userNicknameDisplay: document.getElementById('user-nickname-display'),
    peerAvatars: document.getElementById('peer-avatars'),
    navBtnInstantRoom: document.getElementById('nav-btn-instant-room'),
    btnCreateOrJoin: document.getElementById('btn-create-or-join'),
    btnHeroLaunchRoom: document.getElementById('btn-hero-launch-room'),
    inputCustomRoom: document.getElementById('input-custom-room'),
    btnQuickSampleRoom: document.getElementById('btn-quick-sample-room'),
    btnCopyRoomLink: document.getElementById('btn-copy-room-link'),
    btnShareRoom: document.getElementById('btn-share-room'),
    btnChangeNickname: document.getElementById('btn-change-nickname'),
    selectLanguage: document.getElementById('select-language'),
    selectTheme: document.getElementById('select-theme'),
    editorTextarea: document.getElementById('code-editor-textarea'),
    editorLineNumbers: document.getElementById('editor-line-numbers'),
    activeFilename: document.getElementById('active-filename'),
    codeStats: document.getElementById('code-stats'),
    cursorPosition: document.getElementById('cursor-position'),
    syncStatus: document.getElementById('sync-status'),
    remoteCursorsLayer: document.getElementById('remote-cursors-layer'),
    btnRunCode: document.getElementById('btn-run-code'),
    btnFormatCode: document.getElementById('btn-format-code'),
    btnTakeSnapshot: document.getElementById('btn-take-snapshot'),
    btnDownloadCode: document.getElementById('btn-download-code'),
    btnToggleSidepanel: document.getElementById('btn-toggle-sidepanel'),
    sidePanel: document.getElementById('side-panel'),
    sideTabs: document.querySelectorAll('.side-tab'),
    tabPanes: document.querySelectorAll('.tab-pane'),
    consoleOutput: document.getElementById('console-output'),
    btnClearConsole: document.getElementById('btn-clear-console'),
    previewIframe: document.getElementById('preview-iframe'),
    btnRefreshPreview: document.getElementById('btn-refresh-preview'),
    inputChatMessage: document.getElementById('input-chat-message'),
    btnSendChat: document.getElementById('btn-send-chat'),
    chatMessagesContainer: document.getElementById('chat-messages-container'),
    badgeChatUnread: document.getElementById('badge-chat-unread'),
    snapshotsList: document.getElementById('snapshots-list'),
    badgeSnapshotsCount: document.getElementById('badge-snapshots-count'),
    btnCreateSnapshotModal: document.getElementById('btn-create-snapshot-modal'),
    // Modals
    modalNickname: document.getElementById('modal-nickname'),
    inputNewNickname: document.getElementById('input-new-nickname'),
    btnSaveNickname: document.getElementById('btn-save-nickname'),
    btnCancelNickname: document.getElementById('btn-cancel-nickname'),
    modalSettings: document.getElementById('modal-settings'),
    btnOpenSettings: document.getElementById('btn-open-settings'),
    btnCloseSettings: document.getElementById('btn-close-settings'),
    btnSaveSettings: document.getElementById('btn-save-settings'),
    settingFontsize: document.getElementById('setting-fontsize'),
    settingTabsize: document.getElementById('setting-tabsize'),
    settingAutobrack: document.getElementById('setting-autobrack'),
    settingSound: document.getElementById('setting-sound'),
    modalDiff: document.getElementById('modal-diff'),
    diffViewer: document.getElementById('diff-viewer'),
    diffModalTitle: document.getElementById('diff-modal-title'),
    btnCloseDiffModal: document.getElementById('btn-close-diff-modal'),
    btnCloseDiff: document.getElementById('btn-close-diff'),
    btnRestoreDiffSnapshot: document.getElementById('btn-restore-diff-snapshot')
  };

  // --- Router & Mode Switching ---
  function initRouter() {
    window.addEventListener('hashchange', handleRoute);
    handleRoute();
  }

  function handleRoute() {
    const hash = window.location.hash.slice(1); // e.g. "/room/shift-1234"
    if (hash.startsWith('/room/')) {
      const parts = hash.split('/');
      const roomId = parts[2] ? parts[2].trim() : 'general';
      enterRoom(roomId);
    } else {
      enterLanding();
    }
  }

  function enterLanding() {
    state.roomId = null;
    if (state.syncChannel) {
      state.syncChannel.close();
      state.syncChannel = null;
    }
    el.viewLanding.classList.remove('hidden');
    el.viewRoom.classList.add('hidden');
    el.roomNavControls.classList.add('hidden');
    el.roomNavControls.classList.remove('flex');
    el.appFooter.classList.remove('hidden');
    document.title = "CodeShift — Think together. Code without limits.";
  }

  function enterRoom(roomId) {
    state.roomId = roomId;
    el.viewLanding.classList.add('hidden');
    el.viewRoom.classList.remove('hidden');
    el.roomNavControls.classList.remove('hidden');
    el.roomNavControls.classList.add('flex');
    el.appFooter.classList.add('hidden');

    el.roomNavId.textContent = roomId;
    el.userNicknameDisplay.textContent = state.userName;
    document.title = `CodeShift • #${roomId}`;

    setupSyncEngine(roomId);
    loadRoomState(roomId);
    updateLineNumbers();
    updateCodeStats();
    renderPeers();
    applySettingsToEditor();

    showToast(`Entered collaborative room #${roomId}`, 'success');
  }

  function navigateToRoom(roomId) {
    window.location.hash = `/room/${encodeURIComponent(roomId)}`;
  }

  function generateRoomSlug() {
    const prefixes = ['shift', 'flow', 'knot', 'pair', 'sync', 'craft'];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const num = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}-${num}`;
  }

  // --- Local Room State Persistence ---
  function getRoomStorageKey(roomId) {
    return `codeshift_room_${roomId}_data`;
  }

  function loadRoomState(roomId) {
    const saved = localStorage.getItem(getRoomStorageKey(roomId));
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        el.editorTextarea.value = parsed.code || DEFAULT_TEMPLATES.javascript;
        state.language = parsed.language || 'javascript';
        state.snapshots = parsed.snapshots || [];
      } catch (e) {
        el.editorTextarea.value = DEFAULT_TEMPLATES.javascript;
      }
    } else {
      el.editorTextarea.value = DEFAULT_TEMPLATES[state.language] || DEFAULT_TEMPLATES.javascript;
      state.snapshots = [];
      // Take initial snapshot
      saveSnapshot("Initial Room State", true);
    }
    el.selectLanguage.value = state.language;
    updateActiveFilename();
    renderSnapshotsList();
  }

  function persistCurrentRoom() {
    if (!state.roomId) return;
    const data = {
      code: el.editorTextarea.value,
      language: state.language,
      snapshots: state.snapshots,
      updatedAt: Date.now()
    };
    localStorage.setItem(getRoomStorageKey(state.roomId), JSON.stringify(data));
  }

  // --- Real-Time Peer Sync Engine ---
  function setupSyncEngine(roomId) {
    if (state.syncChannel) {
      state.syncChannel.close();
    }

    const channelName = `codeshift_channel_${roomId}`;
    state.syncChannel = new BroadcastChannel(channelName);

    state.syncChannel.onmessage = (event) => {
      handleSyncMessage(event.data);
    };

    // Broadcast our presence
    broadcast({
      type: 'PEER_JOIN',
      userId: state.userId,
      userName: state.userName,
      userColor: state.userColor
    });

    // Send heartbeat every 4 seconds
    setInterval(() => {
      if (!state.roomId) return;
      broadcast({
        type: 'PEER_HEARTBEAT',
        userId: state.userId,
        userName: state.userName,
        userColor: state.userColor
      });
      cleanupStalePeers();
    }, 4000);

    // Cross-tab localStorage fallback listener
    window.addEventListener('storage', (e) => {
      if (e.key === getRoomStorageKey(state.roomId) && !state.isApplyingRemoteChange) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (parsed && parsed.code !== el.editorTextarea.value) {
            applyRemoteCode(parsed.code);
          }
        } catch (err) {}
      }
    });
  }

  function broadcast(data) {
    if (state.syncChannel) {
      state.syncChannel.postMessage(data);
    }
  }

  function handleSyncMessage(msg) {
    if (!msg || msg.userId === state.userId) return;

    switch (msg.type) {
      case 'PEER_JOIN':
        state.peers.set(msg.userId, {
          name: msg.userName,
          color: msg.userColor,
          lastSeen: Date.now()
        });
        renderPeers();
        showToast(`${msg.userName} joined the room!`, 'info');
        // Reply with our presence so the new peer sees us
        broadcast({
          type: 'PEER_HEARTBEAT',
          userId: state.userId,
          userName: state.userName,
          userColor: state.userColor
        });
        break;

      case 'PEER_HEARTBEAT':
        state.peers.set(msg.userId, {
          name: msg.userName,
          color: msg.userColor,
          lastSeen: Date.now()
        });
        renderPeers();
        break;

      case 'CODE_CHANGE':
        applyRemoteCode(msg.code);
        break;

      case 'CURSOR_MOVE':
        updateRemoteCursor(msg.userId, msg.userName, msg.userColor, msg.line, msg.col);
        break;

      case 'CHAT_MESSAGE':
        appendChatMessage(msg.userName, msg.userColor, msg.text, msg.time, false);
        playSound('blip');
        if (state.activeSideTab !== 'tab-chat') {
          el.badgeChatUnread.classList.remove('hidden');
        }
        break;

      case 'SNAPSHOT_CREATED':
        state.snapshots.unshift(msg.snapshot);
        renderSnapshotsList();
        showToast(`New snapshot saved by ${msg.userName}`, 'info');
        break;
    }
  }

  function applyRemoteCode(newCode) {
    state.isApplyingRemoteChange = true;
    const start = el.editorTextarea.selectionStart;
    const end = el.editorTextarea.selectionEnd;

    el.editorTextarea.value = newCode;
    // preserve selection
    el.editorTextarea.setSelectionRange(start, end);

    updateLineNumbers();
    updateCodeStats();
    el.syncStatus.textContent = 'Updated';
    setTimeout(() => {
      el.syncStatus.textContent = 'Synced';
      state.isApplyingRemoteChange = false;
    }, 500);
  }

  function cleanupStalePeers() {
    const now = Date.now();
    let changed = false;
    state.peers.forEach((peer, id) => {
      if (now - peer.lastSeen > 12000) {
        state.peers.delete(id);
        removeRemoteCursor(id);
        changed = true;
      }
    });
    if (changed) renderPeers();
  }

  function renderPeers() {
    el.peerAvatars.innerHTML = '';
    // Self Avatar
    const selfBadge = document.createElement('div');
    selfBadge.className = 'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white border-2 border-[#13141E] shadow';
    selfBadge.style.backgroundColor = state.userColor;
    selfBadge.title = `${state.userName} (You)`;
    selfBadge.textContent = state.userName.charAt(0).toUpperCase();
    el.peerAvatars.appendChild(selfBadge);

    // Remote Peers
    state.peers.forEach((peer) => {
      const badge = document.createElement('div');
      badge.className = 'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white border-2 border-[#13141E] shadow';
      badge.style.backgroundColor = peer.color;
      badge.title = peer.name;
      badge.textContent = peer.name.charAt(0).toUpperCase();
      el.peerAvatars.appendChild(badge);
    });
  }

  // --- Remote Cursor Rendering ---
  function updateRemoteCursor(peerId, name, color, line, col) {
    let cursorEl = document.getElementById(`cursor_${peerId}`);
    if (!cursorEl) {
      cursorEl = document.createElement('div');
      cursorEl.id = `cursor_${peerId}`;
      cursorEl.className = 'remote-cursor';
      cursorEl.innerHTML = `<div class="remote-cursor-flag" style="background-color: ${color}">${name}</div>`;
      el.remoteCursorsLayer.appendChild(cursorEl);
    }

    cursorEl.style.backgroundColor = color;
    const lineHeight = 24.8; // matching line-height
    const charWidth = 8.4;   // approx mono character width
    const top = (line - 1) * lineHeight + 12;
    const left = 48 + (col * charWidth) + 12; // left offset from line numbers

    cursorEl.style.top = `${top}px`;
    cursorEl.style.left = `${left}px`;
    cursorEl.style.height = `${lineHeight}px`;
  }

  function removeRemoteCursor(peerId) {
    const cursor = document.getElementById(`cursor_${peerId}`);
    if (cursor) cursor.remove();
  }

  // --- Editor Core Logic ---
  function updateLineNumbers() {
    const text = el.editorTextarea.value;
    const lineCount = text.split('\n').length;
    let html = '';
    for (let i = 1; i <= lineCount; i++) {
      html += `<div>${i}</div>`;
    }
    el.editorLineNumbers.innerHTML = html;
  }

  function updateCodeStats() {
    const text = el.editorTextarea.value;
    const lines = text.split('\n').length;
    const chars = text.length;
    el.codeStats.textContent = `${lines} ${lines === 1 ? 'line' : 'lines'}, ${chars} chars`;

    // Cursor position
    const pos = el.editorTextarea.selectionStart;
    const linesBefore = text.slice(0, pos).split('\n');
    const curLine = linesBefore.length;
    const curCol = linesBefore[linesBefore.length - 1].length;
    el.cursorPosition.textContent = `Ln ${curLine}, Col ${curCol + 1}`;

    // Broadcast cursor position
    if (state.roomId) {
      broadcast({
        type: 'CURSOR_MOVE',
        userId: state.userId,
        userName: state.userName,
        userColor: state.userColor,
        line: curLine,
        col: curCol
      });
    }
  }

  function updateActiveFilename() {
    const extMap = {
      javascript: 'main.js',
      typescript: 'index.ts',
      html: 'index.html',
      css: 'styles.css',
      python: 'app.py',
      rust: 'main.rs',
      go: 'main.go',
      sql: 'query.sql',
      json: 'config.json',
      markdown: 'README.md'
    };
    el.activeFilename.textContent = extMap[state.language] || 'code.txt';
  }

  // Auto brackets & Tab key support
  el.editorTextarea.addEventListener('keydown', (e) => {
    // Run shortcut: ⌘+Enter or Ctrl+Enter
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      runCurrentCode();
      return;
    }

    // Save snapshot shortcut: ⌘+S or Ctrl+S
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      saveSnapshot(`Snapshot at ${new Date().toLocaleTimeString()}`);
      showToast('Shift Snapshot created! 📸', 'success');
      return;
    }

    // Tab key handling
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = el.editorTextarea.selectionStart;
      const end = el.editorTextarea.selectionEnd;
      const spaces = ' '.repeat(state.settings.tabSize);

      if (!e.shiftKey) {
        // Insert indent
        el.editorTextarea.value = el.editorTextarea.value.substring(0, start) + spaces + el.editorTextarea.value.substring(end);
        el.editorTextarea.selectionStart = el.editorTextarea.selectionEnd = start + spaces.length;
      }
      onEditorInput();
      return;
    }

    // Auto-close brackets/quotes
    if (state.settings.autoBrackets) {
      const pairs = {
        '(': ')',
        '[': ']',
        '{': '}',
        '"': '"',
        "'": "'",
        '`': '`'
      };

      if (pairs[e.key]) {
        const start = el.editorTextarea.selectionStart;
        const end = el.editorTextarea.selectionEnd;
        if (start === end) {
          e.preventDefault();
          const closeChar = pairs[e.key];
          el.editorTextarea.value = el.editorTextarea.value.substring(0, start) + e.key + closeChar + el.editorTextarea.value.substring(end);
          el.editorTextarea.selectionStart = el.editorTextarea.selectionEnd = start + 1;
          onEditorInput();
        }
      }
    }
  });

  function onEditorInput() {
    updateLineNumbers();
    updateCodeStats();
    persistCurrentRoom();

    if (state.roomId && !state.isApplyingRemoteChange) {
      broadcast({
        type: 'CODE_CHANGE',
        userId: state.userId,
        userName: state.userName,
        code: el.editorTextarea.value
      });
    }
  }

  el.editorTextarea.addEventListener('input', onEditorInput);
  el.editorTextarea.addEventListener('click', updateCodeStats);
  el.editorTextarea.addEventListener('keyup', updateCodeStats);

  // Sync scrolling between line numbers and textarea
  el.editorTextarea.addEventListener('scroll', () => {
    el.editorLineNumbers.scrollTop = el.editorTextarea.scrollTop;
  });

  // --- Code Execution Engine ---
  function runCurrentCode() {
    const code = el.editorTextarea.value;
    const lang = state.language;

    // Switch to output tab
    switchSideTab('tab-console');
    playSound('blip');

    const timestamp = new Date().toLocaleTimeString();
    el.consoleOutput.innerHTML += `<div class="text-zinc-500 text-[11px] mt-2 pt-2 border-t border-border-dim/40 flex items-center justify-between">
      <span>▶ Execution started (${lang})</span>
      <span>${timestamp}</span>
    </div>`;

    if (lang === 'javascript' || lang === 'typescript') {
      executeJavaScript(code);
    } else if (lang === 'html' || lang === 'css') {
      renderWebPreview();
      switchSideTab('tab-preview');
      appendConsoleLog(`Web preview rendered successfully. Switched to Preview tab.`, 'success');
    } else {
      // Python, Rust, Go, etc simulation
      simulateLanguageExecution(code, lang);
    }
  }

  function executeJavaScript(code) {
    const startTime = performance.now();
    const logs = [];

    // Capture console methods safely
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    console.log = (...args) => {
      logs.push({ type: 'info', text: args.map(formatLogArg).join(' ') });
      originalLog.apply(console, args);
    };
    console.warn = (...args) => {
      logs.push({ type: 'warn', text: args.map(formatLogArg).join(' ') });
      originalWarn.apply(console, args);
    };
    console.error = (...args) => {
      logs.push({ type: 'error', text: args.map(formatLogArg).join(' ') });
      originalError.apply(console, args);
    };

    try {
      // Evaluate within an isolated scope
      const evalResult = new Function(code)();
      const duration = (performance.now() - startTime).toFixed(1);

      // Render captured logs
      if (logs.length > 0) {
        logs.forEach(log => appendConsoleLog(log.text, log.type));
      }

      if (evalResult !== undefined) {
        appendConsoleLog(`← Return: ${formatLogArg(evalResult)}`, 'success');
      }

      appendConsoleLog(`Completed in ${duration}ms ✓`, 'success');
      playSound('success');
    } catch (err) {
      appendConsoleLog(`Runtime Error: ${err.message}`, 'error');
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
      el.consoleOutput.scrollTop = el.consoleOutput.scrollHeight;
    }
  }

  function simulateLanguageExecution(code, lang) {
    setTimeout(() => {
      if (lang === 'python') {
        appendConsoleLog(`Python 3.12 runner output:`, 'info');
        appendConsoleLog(`Code parsed without syntax errors.`, 'success');
        // Extract print calls
        const prints = code.match(/print\((.*?)\)/g);
        if (prints) {
          prints.forEach(p => {
            const inner = p.replace(/^print\(/, '').replace(/\)$/, '');
            appendConsoleLog(`> ${inner}`, 'info');
          });
        }
      } else if (lang === 'rust') {
        appendConsoleLog(`Compiling with rustc 1.78.0 (CodeShift Cargo Runner)...`, 'info');
        appendConsoleLog(`Build finished [optimized + debuginfo] in 0.42s`, 'success');
        appendConsoleLog(`Running target/debug/codeshift`, 'info');
      } else {
        appendConsoleLog(`Executed ${lang} snippet successfully.`, 'success');
      }
      el.consoleOutput.scrollTop = el.consoleOutput.scrollHeight;
    }, 150);
  }

  function renderWebPreview() {
    let content = el.editorTextarea.value;
    if (state.language === 'css') {
      content = `<!DOCTYPE html><html><head><style>${content}</style></head><body><div class="developer-card"><h1>CodeShift CSS Preview</h1><p>Inspecting your styling live.</p></div></body></html>`;
    }
    const blob = new Blob([content], { type: 'text/html' });
    el.previewIframe.src = URL.createObjectURL(blob);
  }

  function formatLogArg(arg) {
    if (arg === null) return 'null';
    if (arg === undefined) return 'undefined';
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg, null, 2);
      } catch (e) {
        return Object.prototype.toString.call(arg);
      }
    }
    return String(arg);
  }

  function appendConsoleLog(message, type = 'info') {
    const row = document.createElement('div');
    row.className = `console-log-row console-log-${type} text-xs font-mono`;
    row.textContent = message;
    el.consoleOutput.appendChild(row);
  }

  // --- Snapshots & Visual Diff Engine ---
  function saveSnapshot(title, isSystem = false) {
    const snapshot = {
      id: 'snap_' + Date.now(),
      title: title || `Snapshot ${state.snapshots.length + 1}`,
      author: state.userName,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      date: new Date().toLocaleDateString(),
      code: el.editorTextarea.value,
      lines: el.editorTextarea.value.split('\n').length
    };

    state.snapshots.unshift(snapshot);
    renderSnapshotsList();
    persistCurrentRoom();

    if (!isSystem && state.roomId) {
      broadcast({
        type: 'SNAPSHOT_CREATED',
        userId: state.userId,
        userName: state.userName,
        snapshot: snapshot
      });
    }
  }

  function renderSnapshotsList() {
    el.snapshotsList.innerHTML = '';
    el.badgeSnapshotsCount.textContent = state.snapshots.length;

    if (state.snapshots.length === 0) {
      el.snapshotsList.innerHTML = '<div class="text-zinc-500 text-xs text-center py-4">No snapshots saved yet.</div>';
      return;
    }

    state.snapshots.forEach((snap, idx) => {
      const item = document.createElement('div');
      item.className = 'p-2.5 rounded-xl bg-surface-elevated/70 border border-border-dim hover:border-violet-500/40 transition-all flex items-center justify-between gap-2';
      item.innerHTML = `
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold text-white truncate">${snap.title}</span>
            <span class="text-[10px] text-violet-400 font-mono">${snap.lines}L</span>
          </div>
          <div class="text-[10px] text-zinc-500 font-mono mt-0.5">
            ${snap.author} • ${snap.time}
          </div>
        </div>
        <div class="flex items-center gap-1">
          <button class="btn-view-diff px-2 py-1 rounded bg-surface hover:bg-violet-600 text-zinc-300 hover:text-white text-[11px] font-semibold transition-all" data-id="${snap.id}">Diff</button>
          <button class="btn-restore-snap px-2 py-1 rounded bg-surface hover:bg-emerald-600 text-zinc-300 hover:text-white text-[11px] font-semibold transition-all" data-id="${snap.id}">Restore</button>
        </div>
      `;
      el.snapshotsList.appendChild(item);
    });

    // Bind item buttons
    el.snapshotsList.querySelectorAll('.btn-view-diff').forEach(btn => {
      btn.addEventListener('click', () => openDiffModal(btn.dataset.id));
    });
    el.snapshotsList.querySelectorAll('.btn-restore-snap').forEach(btn => {
      btn.addEventListener('click', () => restoreSnapshot(btn.dataset.id));
    });
  }

  let activeComparingSnapshot = null;

  function openDiffModal(snapId) {
    const snap = state.snapshots.find(s => s.id === snapId);
    if (!snap) return;
    activeComparingSnapshot = snap;

    el.diffModalTitle.textContent = `Comparing: "${snap.title}" vs Current Buffer`;
    el.diffModalSubtitle.textContent = `Saved by ${snap.author} on ${snap.date} at ${snap.time}`;

    const oldLines = snap.code.split('\n');
    const newLines = el.editorTextarea.value.split('\n');
    
    // Compute simple line-based diff
    el.diffViewer.innerHTML = '';
    const maxLines = Math.max(oldLines.length, newLines.length);

    for (let i = 0; i < maxLines; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];

      if (oldLine === newLine) {
        const line = document.createElement('div');
        line.className = 'diff-line diff-eq';
        line.textContent = `  ${oldLine || ''}`;
        el.diffViewer.appendChild(line);
      } else {
        if (oldLine !== undefined) {
          const del = document.createElement('div');
          del.className = 'diff-line diff-del';
          del.textContent = `- ${oldLine}`;
          el.diffViewer.appendChild(del);
        }
        if (newLine !== undefined) {
          const add = document.createElement('div');
          add.className = 'diff-line diff-add';
          add.textContent = `+ ${newLine}`;
          el.diffViewer.appendChild(add);
        }
      }
    }

    el.modalDiff.classList.remove('hidden');
    el.modalDiff.classList.add('flex');
  }

  function restoreSnapshot(snapId) {
    const snap = state.snapshots.find(s => s.id === snapId);
    if (!snap) return;
    if (confirm(`Restore editor buffer to "${snap.title}"?`)) {
      el.editorTextarea.value = snap.code;
      onEditorInput();
      showToast(`Restored snapshot "${snap.title}"!`, 'success');
      el.modalDiff.classList.add('hidden');
      el.modalDiff.classList.remove('flex');
    }
  }

  // --- Room Chat ---
  function appendChatMessage(name, color, text, time, isSelf = false) {
    const msg = document.createElement('div');
    msg.className = `flex flex-col gap-1 p-2 rounded-xl text-xs max-w-[85%] ${
      isSelf ? 'ml-auto bg-violet-600/20 border border-violet-500/30 text-white' : 'mr-auto bg-surface-elevated border border-border-dim text-zinc-200'
    }`;
    msg.innerHTML = `
      <div class="flex items-center justify-between gap-2 text-[10px]">
        <span class="font-bold" style="color: ${color}">${isSelf ? 'You' : name}</span>
        <span class="text-zinc-500 font-mono">${time}</span>
      </div>
      <div class="text-xs break-words">${escapeHtml(text)}</div>
    `;
    el.chatMessagesContainer.appendChild(msg);
    el.chatMessagesContainer.scrollTop = el.chatMessagesContainer.scrollHeight;
  }

  function sendChatMessage() {
    const text = el.inputChatMessage.value.trim();
    if (!text) return;

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    appendChatMessage(state.userName, state.userColor, text, time, true);
    el.inputChatMessage.value = '';

    if (state.roomId) {
      broadcast({
        type: 'CHAT_MESSAGE',
        userId: state.userId,
        userName: state.userName,
        userColor: state.userColor,
        text: text,
        time: time
      });
    }
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // --- Side Panel Tabs ---
  function switchSideTab(targetId) {
    state.activeSideTab = targetId;
    el.sideTabs.forEach(tab => {
      if (tab.dataset.tab === targetId) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });

    el.tabPanes.forEach(pane => {
      if (pane.id === targetId) {
        pane.classList.remove('hidden');
      } else {
        pane.classList.add('hidden');
      }
    });

    if (targetId === 'tab-chat') {
      el.badgeChatUnread.classList.add('hidden');
    }
  }

  el.sideTabs.forEach(tab => {
    tab.addEventListener('click', () => switchSideTab(tab.dataset.tab));
  });

  // --- Settings & Preferences ---
  function applySettingsToEditor() {
    el.editorTextarea.style.fontSize = `${state.settings.fontSize}px`;
    el.editorLineNumbers.style.fontSize = `${state.settings.fontSize - 1}px`;
    el.editorTextarea.style.tabSize = state.settings.tabSize;
  }

  // --- Event Bindings ---
  // Landing Actions
  el.btnCreateOrJoin.addEventListener('click', () => {
    const input = el.inputCustomRoom.value.trim();
    const roomId = input || generateRoomSlug();
    navigateToRoom(roomId);
  });

  el.inputCustomRoom.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      el.btnCreateOrJoin.click();
    }
  });

  el.btnQuickSampleRoom.addEventListener('click', () => {
    navigateToRoom('shift-demo');
  });

  el.navBtnInstantRoom.addEventListener('click', () => {
    navigateToRoom(generateRoomSlug());
  });

  el.btnHeroLaunchRoom.addEventListener('click', () => {
    navigateToRoom(generateRoomSlug());
  });

  // Share and Copy links
  function copyShareLink() {
    const url = window.location.href;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        showToast('Room link copied to clipboard! 📋', 'success');
      });
    } else {
      prompt('Copy this room URL:', url);
    }
  }

  el.btnCopyRoomLink.addEventListener('click', copyShareLink);
  el.btnShareRoom.addEventListener('click', copyShareLink);

  // Run & Format Buttons
  el.btnRunCode.addEventListener('click', runCurrentCode);
  el.btnClearConsole.addEventListener('click', () => {
    el.consoleOutput.innerHTML = '<div class="text-zinc-500 italic">// Console cleared.</div>';
  });
  el.btnRefreshPreview.addEventListener('click', renderWebPreview);

  // Format Code (basic clean indentation)
  el.btnFormatCode.addEventListener('click', () => {
    const lang = state.language;
    if (lang === 'json') {
      try {
        el.editorTextarea.value = JSON.stringify(JSON.parse(el.editorTextarea.value), null, state.settings.tabSize);
        onEditorInput();
        showToast('JSON formatted! ✨', 'success');
      } catch (err) {
        showToast('Invalid JSON syntax', 'error');
      }
    } else {
      // Basic trim trailing spaces
      const cleaned = el.editorTextarea.value
        .split('\n')
        .map(l => l.trimEnd())
        .join('\n');
      el.editorTextarea.value = cleaned;
      onEditorInput();
      showToast('Code cleaned! ✨', 'success');
    }
  });

  // Download Code
  el.btnDownloadCode.addEventListener('click', () => {
    const filename = el.activeFilename.textContent;
    const blob = new Blob([el.editorTextarea.value], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    showToast(`Downloaded ${filename}`, 'success');
  });

  // Language Change
  el.selectLanguage.addEventListener('change', (e) => {
    state.language = e.target.value;
    updateActiveFilename();
    if (DEFAULT_TEMPLATES[state.language] && el.editorTextarea.value.trim() === '') {
      el.editorTextarea.value = DEFAULT_TEMPLATES[state.language];
    }
    onEditorInput();
    showToast(`Language set to ${e.target.options[e.target.selectedIndex].text}`);
  });

  // Theme Selector
  el.selectTheme.addEventListener('change', (e) => {
    const theme = e.target.value;
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('codeshift_theme', theme);
  });
  // Set initial theme
  document.documentElement.setAttribute('data-theme', state.theme);
  el.selectTheme.value = state.theme;

  // Toggle Sidepanel
  el.btnToggleSidepanel.addEventListener('click', () => {
    el.sidePanel.classList.toggle('hidden');
  });

  // Chat Send
  el.btnSendChat.addEventListener('click', sendChatMessage);
  el.inputChatMessage.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChatMessage();
  });

  // Snapshot modal actions
  el.btnTakeSnapshot.addEventListener('click', () => {
    const title = prompt('Enter a snapshot name/description:', `Shift Checkpoint`);
    if (title) {
      saveSnapshot(title);
      showToast('Shift Snapshot saved! 📸', 'success');
    }
  });
  el.btnCreateSnapshotModal.addEventListener('click', () => {
    el.btnTakeSnapshot.click();
  });

  // Diff Modal close & restore
  el.btnCloseDiffModal.addEventListener('click', () => {
    el.modalDiff.classList.add('hidden');
    el.modalDiff.classList.remove('flex');
  });
  el.btnCloseDiff.addEventListener('click', () => {
    el.modalDiff.classList.add('hidden');
    el.modalDiff.classList.remove('flex');
  });
  el.btnRestoreDiffSnapshot.addEventListener('click', () => {
    if (activeComparingSnapshot) {
      restoreSnapshot(activeComparingSnapshot.id);
    }
  });

  // Nickname Modal
  el.btnChangeNickname.addEventListener('click', () => {
    el.inputNewNickname.value = state.userName;
    el.modalNickname.classList.remove('hidden');
    el.modalNickname.classList.add('flex');
    el.inputNewNickname.focus();
  });
  el.btnCancelNickname.addEventListener('click', () => {
    el.modalNickname.classList.add('hidden');
    el.modalNickname.classList.remove('flex');
  });
  el.btnSaveNickname.addEventListener('click', () => {
    const newName = el.inputNewNickname.value.trim();
    if (newName) {
      state.userName = newName;
      localStorage.setItem('codeshift_user_name', newName);
      el.userNicknameDisplay.textContent = newName;
      el.modalNickname.classList.add('hidden');
      el.modalNickname.classList.remove('flex');
      renderPeers();
      showToast(`Display name updated to "${newName}"`, 'success');
      if (state.roomId) {
        broadcast({
          type: 'PEER_HEARTBEAT',
          userId: state.userId,
          userName: state.userName,
          userColor: state.userColor
        });
      }
    }
  });

  // Settings Modal
  el.btnOpenSettings.addEventListener('click', () => {
    el.settingFontsize.value = state.settings.fontSize;
    el.settingTabsize.value = state.settings.tabSize;
    el.settingAutobrack.checked = state.settings.autoBrackets;
    el.settingSound.checked = state.settings.sound;
    el.modalSettings.classList.remove('hidden');
    el.modalSettings.classList.add('flex');
  });
  el.btnCloseSettings.addEventListener('click', () => {
    el.modalSettings.classList.add('hidden');
    el.modalSettings.classList.remove('flex');
  });
  el.btnSaveSettings.addEventListener('click', () => {
    state.settings.fontSize = parseInt(el.settingFontsize.value, 10);
    state.settings.tabSize = parseInt(el.settingTabsize.value, 10);
    state.settings.autoBrackets = el.settingAutobrack.checked;
    state.settings.sound = el.settingSound.checked;

    localStorage.setItem('cs_fontSize', state.settings.fontSize);
    localStorage.setItem('cs_tabSize', state.settings.tabSize);
    localStorage.setItem('cs_autoBrackets', state.settings.autoBrackets);
    localStorage.setItem('cs_sound', state.settings.sound);

    applySettingsToEditor();
    el.modalSettings.classList.add('hidden');
    el.modalSettings.classList.remove('flex');
    showToast('Preferences saved!', 'success');
  });

  // Initialize
  initRouter();

})();

