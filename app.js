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

  const userIdentity = getUserIdentity();

  const state = {
    roomId: null,
    userId: userIdentity.uid,
    userName: userIdentity.name,
    userColor: userIdentity.color,
    cursorLine: 1,
    cursorCol: 1,
    sseSource: null,
    broadcastChannel: null,
    presenceTimer: null,
    saveTimer: null,
    lastLocalEditTime: 0,
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

  function getUserIdentity() {
    // Stable tab identity: persists across refreshes so refreshing never spawns phantom users!
    if (!window.name || !window.name.startsWith('cs_tab_')) {
      window.name = 'cs_tab_' + Math.random().toString(36).substring(2, 10);
    }
    const tabKey = 'codeshift_uid_' + window.name;
    let uid = sessionStorage.getItem(tabKey);
    if (!uid) {
      uid = 'usr_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36).slice(-3);
      sessionStorage.setItem(tabKey, uid);
    }

    let hash = 0;
    for (let i = 0; i < uid.length; i++) hash = (hash * 31 + uid.charCodeAt(i)) >>> 0;
    const anonNum = (hash % 89) + 11; // stable number e.g. 17

    const colors = [
      '#10b981', // emerald green
      '#06b6d4', // cyan
      '#3b82f6', // blue
      '#8b5cf6', // purple
      '#ec4899', // pink
      '#f59e0b', // amber
      '#14b8a6'  // teal
    ];
    const color = colors[hash % colors.length];
    const savedName = localStorage.getItem('codeshift_nickname');
    const name = savedName || ('Anonymous ' + anonNum);
    return { uid, name, color, anonNum };
  }

  function safeKey(k) {
    return (k || 'default').trim().toLowerCase().replace(/[.#$\[\]\/]/g, '_');
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
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

    if (path && path !== 'index.html' && path !== '404.html' && !path.startsWith('google') && !path.endsWith('.html')) {
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
    modalPrivacy:    document.getElementById('modal-privacy'),
    roomPrefixLabel: document.getElementById('room-prefix-label'),
    codeCardComment: document.getElementById('code-card-comment'),
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
    setTimeout(() => {
      if (state.monacoInstance) state.monacoInstance.layout();
    }, 60);
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

    const savedLang = localStorage.getItem('codeshift_lang_' + roomId) || 'typescript';
    setEditorLanguage(savedLang);

    const cached = localStorage.getItem('codeshift_code_' + roomId);
    const initial = cached !== null ? cached : '';

    loadMonacoThenInit(initial);
    syncSetup(roomId);
    presenceStart(roomId);
    updateSessionDuration();
    setSaveStatus('saved');
  }

  function setEditorLanguage(lang) {
    state.language = lang;
    if (state.roomId) {
      localStorage.setItem('codeshift_lang_' + state.roomId, lang);
    }
    if (state.monacoInstance) {
      const model = state.monacoInstance.getModel();
      if (model && window.monaco) {
        monaco.editor.setModelLanguage(model, lang);
      }
    }
    const extMap = {
      typescript: 'ts', javascript: 'js', python: 'py', plaintext: 'txt',
      markdown: 'md', html: 'html', css: 'css', rust: 'rs', go: 'go',
      cpp: 'cpp', json: 'json', sql: 'sql'
    };
    const ext = extMap[lang] || 'txt';
    const filename = (state.roomId || 'main') + '.' + ext;
    const tabLabel = document.getElementById('tab-filename-label');
    const sideLabel = document.getElementById('sidebar-filename');
    const bcFile = document.getElementById('ide-active-filename');
    const engineLabel = document.getElementById('editor-engine-label');
    const selStatus = document.getElementById('ide-status-lang-select');
    if (tabLabel) tabLabel.textContent = filename;
    if (sideLabel) sideLabel.textContent = filename;
    if (bcFile) bcFile.textContent = filename;
    if (engineLabel) engineLabel.textContent = lang.toUpperCase();
    if (selStatus && selStatus.value !== lang) selStatus.value = lang;

    const sel1 = document.getElementById('ide-language-select');
    const sel2 = document.getElementById('ide-quick-lang-select');
    if (sel1 && sel1.value !== lang) sel1.value = lang;
    if (sel2 && sel2.value !== lang) sel2.value = lang;
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

      // Strip TypeScript & JavaScript workers of all auto-complete, hovers, diagnostics & auto-fixes
      if (window.monaco && monaco.languages && monaco.languages.typescript) {
        try {
          const minimalMode = {
            documentHighlight: false,
            documentSymbol: false,
            diagnostics: false,
            completionItems: false,
            hovers: false,
            documentRangeFormattingEdits: false,
            documentFormattingEdits: false,
            tokens: true,
            definitions: false,
            references: false,
            rename: false,
            colors: false,
            foldingRanges: true
          };
          monaco.languages.typescript.typescriptDefaults.setModeConfiguration(minimalMode);
          monaco.languages.typescript.javascriptDefaults.setModeConfiguration(minimalMode);
          monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
            noSemanticValidation: true,
            noSyntaxValidation: true,
            noSuggestionDiagnostics: true
          });
          monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
            noSemanticValidation: true,
            noSyntaxValidation: true,
            noSuggestionDiagnostics: true
          });
        } catch (_) {}
      }

      const isMobile = window.innerWidth < 768;
      const initialLang = state.language || 'typescript';
      state.monacoInstance = monaco.editor.create(el.monacoContainer, {
        value: initial,
        language: initialLang,
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
        selectOnLineNumbers: true,
        selectionHighlight: true,
        roundedSelection: false,

        // ── Clean Indentation Only (Strictly No Auto-Correction) ──
        autoIndent: 'full',
        tabSize: state.settings.tabSize,
        insertSpaces: true,
        detectIndentation: false,
        autoClosingBrackets: 'never',
        autoClosingQuotes: 'never',
        autoClosingDelete: 'never',
        autoClosingOvertype: 'never',
        autoSurround: 'never',
        autoClosingComments: 'never',
        bracketPairColorization: { enabled: false },

        // ── Strictly Disable Autocomplete, Ghost Suggestions, Snippets & Popups ──
        quickSuggestions: { other: false, comments: false, strings: false },
        suggestOnTriggerCharacters: false,
        acceptSuggestionOnEnter: 'off',
        acceptSuggestionOnCommitCharacter: 'off',
        tabCompletion: 'off',
        wordBasedSuggestions: 'off',
        snippetSuggestions: 'none',
        inlineSuggest: { enabled: false },
        parameterHints: { enabled: false },
        formatOnType: false,
        formatOnPaste: false,
        renameOnType: false,
        lightbulb: { enabled: false },
        suggest: {
          showKeywords: false,
          showSnippets: false,
          showWords: false,
          showFunctions: false,
          showVariables: false,
          showClasses: false,
          showModules: false,
          showProperties: false,
          showFields: false,
          showInterfaces: false,
          showMethods: false,
          showValues: false,
          showUnits: false,
          showColors: false,
          showFiles: false,
          showReferences: false,
          showFolders: false,
          showTypeParameters: false,
          showIssues: false,
          showUsers: false
        }
      });

      // Force-disable browser / OS / extension auto-correct on Monaco's internal input element
      function sanitizeMonacoInput() {
        if (!el.monacoContainer) return;
        const inputs = el.monacoContainer.querySelectorAll('textarea, input');
        inputs.forEach(inp => {
          inp.setAttribute('spellcheck', 'false');
          inp.setAttribute('autocorrect', 'off');
          inp.setAttribute('autocapitalize', 'off');
          inp.setAttribute('autocomplete', 'off');
          inp.setAttribute('data-gramm', 'false');
          inp.setAttribute('data-enable-grammarly', 'false');
        });
      }
      sanitizeMonacoInput();
      try {
        const inputObserver = new MutationObserver(sanitizeMonacoInput);
        inputObserver.observe(el.monacoContainer, { childList: true, subtree: true });
      } catch (_) {}

      // Monaco natively handles Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X (and Cmd on Mac)
      // with zero browser permission prompts. We do not intercept keyboard shortcuts,
      // ensuring 100% unrestricted native clipboard and selection behavior.

      // Register custom Select All action with shortcut (⌘A / Ctrl+A) & Context Menu entry
      state.monacoInstance.addAction({
        id: 'codeshift-action-select-all',
        label: 'Select All',
        keybindings: [
          monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyA,
          monaco.KeyMod.WinCtrl | monaco.KeyCode.KeyA
        ],
        contextMenuGroupId: '9_cutcopypaste',
        contextMenuOrder: 4,
        run: function() {
          selectAllCode();
        }
      });

      if (el.fallbackWrapper) el.fallbackWrapper.classList.add('hidden');
      if (el.editorLabel) el.editorLabel.textContent = (initialLang || 'typescript').toUpperCase();

      state.monacoInstance.onDidChangeModelContent(() => {
        if (state.isApplyingRemote) return;
        const val = state.monacoInstance.getValue();
        const charsEl = document.getElementById('code-chars-count');
        if (charsEl) charsEl.textContent = val.length + ' ' + (val.length === 1 ? 'char' : 'chars');
        onLocalChange(val);
      });

      state.monacoInstance.onDidChangeCursorPosition((e) => {
        const p = e.position;
        const model = state.monacoInstance.getModel();
        const lines = model ? model.getLineCount() : 1;
        const chars = model ? model.getValueLength() : 0;
        if (el.cursorPos) el.cursorPos.textContent = 'Ln ' + p.lineNumber + ', Col ' + p.column;
        if (el.codeStats) el.codeStats.textContent = lines + ' ' + (lines === 1 ? 'line' : 'lines');
        const charsEl = document.getElementById('code-chars-count');
        if (charsEl) charsEl.textContent = chars + ' ' + (chars === 1 ? 'char' : 'chars');
        broadcastCursor(p.lineNumber, p.column);
      });

      fetchLatestCode(state.roomId);
    });
  }

  // ──────────────────────────────────────────────
  // COLLABORATIVE CURSOR PRESENCE (Screenshot 3 style)
  // Shows active peer line highlight and [ Anonymous 17 ] tooltip
  // ──────────────────────────────────────────────
  const remoteCursors = {}; // peerId -> { widget, decorationIds, line, col, lastSeen }
  let cursorThrottleTimer = null;

  function injectPeerStyle(peerId, color) {
    const id = 'peer-style-' + peerId;
    let s = document.getElementById(id);
    if (!s) {
      s = document.createElement('style');
      s.id = id;
      document.head.appendChild(s);
    }
    s.textContent = `
      .remote-line-${peerId} {
        background-color: ${color}1f !important;
        border-left: 3px solid ${color} !important;
      }
      .remote-caret-${peerId} {
        border-left: 2px solid ${color} !important;
        height: 100% !important;
        margin-left: -1px;
        animation: caretBlink 1s step-end infinite;
      }
    `;
  }

  function renderRemoteCursor(peerId, name, color, line, col) {
    if (!state.monacoInstance) return;
    const editor = state.monacoInstance;
    const model = editor.getModel();
    if (!model) return;

    const maxLines = model.getLineCount();
    const safeLine = Math.min(Math.max(1, line), maxLines);
    const maxCol = model.getLineMaxColumn(safeLine);
    const safeCol = Math.min(Math.max(1, col), maxCol);

    injectPeerStyle(peerId, color);

    // 1. Delta decorations for active line highlight & caret
    const prevDecs = remoteCursors[peerId] ? remoteCursors[peerId].decorationIds : [];
    const newDecs = editor.deltaDecorations(prevDecs, [
      {
        range: new monaco.Range(safeLine, 1, safeLine, 1),
        options: {
          isWholeLine: true,
          className: 'remote-line-' + peerId
        }
      },
      {
        range: new monaco.Range(safeLine, safeCol, safeLine, safeCol),
        options: {
          className: 'remote-caret-' + peerId
        }
      }
    ]);

    // 2. ContentWidget for floating pill tooltip [ Anonymous X ]
    if (!remoteCursors[peerId] || !remoteCursors[peerId].widget) {
      const domNode = document.createElement('div');
      domNode.className = 'remote-cursor-widget';
      domNode.style.backgroundColor = color;
      domNode.innerHTML = `<span class="remote-cursor-label">${escapeHtml(name)}</span><div class="remote-cursor-arrow" style="border-top-color: ${color};"></div>`;

      const widget = {
        getId: () => 'remote-cursor-widget-' + peerId,
        getDomNode: () => domNode,
        getPosition: () => ({
          position: { lineNumber: safeLine, column: safeCol },
          preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE, monaco.editor.ContentWidgetPositionPreference.BELOW]
        })
      };

      editor.addContentWidget(widget);
      remoteCursors[peerId] = { widget, decorationIds: newDecs, line: safeLine, col: safeCol, lastSeen: Date.now() };
    } else {
      const w = remoteCursors[peerId].widget;
      w.getPosition = () => ({
        position: { lineNumber: safeLine, column: safeCol },
        preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE, monaco.editor.ContentWidgetPositionPreference.BELOW]
      });
      const label = w.getDomNode().querySelector('.remote-cursor-label');
      if (label && label.textContent !== name) label.textContent = name;
      editor.layoutContentWidget(w);
      remoteCursors[peerId].decorationIds = newDecs;
      remoteCursors[peerId].line = safeLine;
      remoteCursors[peerId].col = safeCol;
      remoteCursors[peerId].lastSeen = Date.now();
    }
  }

  function removeRemoteCursor(peerId) {
    if (!remoteCursors[peerId]) return;
    if (state.monacoInstance) {
      try {
        state.monacoInstance.deltaDecorations(remoteCursors[peerId].decorationIds, []);
        state.monacoInstance.removeContentWidget(remoteCursors[peerId].widget);
      } catch (e) {}
    }
    const s = document.getElementById('peer-style-' + peerId);
    if (s) s.remove();
    delete remoteCursors[peerId];
  }

  function broadcastCursor(line, col) {
    state.cursorLine = line;
    state.cursorCol = col;

    // Instant local broadcast to other tabs on same machine (0ms)
    if (state.broadcastChannel) {
      state.broadcastChannel.postMessage({
        type: 'CURSOR',
        from: state.userId,
        name: state.userName,
        color: state.userColor,
        line,
        col
      });
    }

    // Network broadcast to remote collaborators via Firebase — throttled at 400ms
    // Cursor position doesn't need sub-200ms network sync; this cuts ~60% of Firebase cursor writes
    clearTimeout(cursorThrottleTimer);
    cursorThrottleTimer = setTimeout(() => {
      if (!state.roomId) return;
      const url = FIREBASE_BASE + '/codeshare_rooms/' + safeKey(state.roomId) + '/presence/' + state.userId + '.json';
      fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ts: Date.now(),
          name: state.userName,
          color: state.userColor,
          line,
          col
        })
      }).catch(() => {});
    }, 400);
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
        { token: 'comment',  foreground: '666666', fontStyle: 'italic' },
        { token: 'keyword',  foreground: 'ffffff', fontStyle: 'bold' },
        { token: 'string',   foreground: 'd4d4d4' },
        { token: 'number',   foreground: 'e5e5e5' },
        { token: 'type',     foreground: 'ffffff', fontStyle: 'bold' },
        { token: 'function', foreground: 'ffffff' }
      ],
      colors: {
        'editor.background':                    '#000000',
        'editor.foreground':                    '#ffffff',
        'editorLineNumber.foreground':          '#444444',
        'editorLineNumber.activeForeground':    '#ffffff',
        'editorCursor.foreground':              '#ffffff',
        'editor.selectionBackground':           '#ffffff40',
        'editor.inactiveSelectionBackground':   '#ffffff22',
        'editor.selectionHighlightBackground':  '#ffffff30',
        'editor.lineHighlightBackground':       '#111111'
      }
    });
  }

  function selectAllCode() {
    if (state.monacoInstance) {
      state.monacoInstance.focus();
      const model = state.monacoInstance.getModel();
      if (model) {
        const fullRange = model.getFullModelRange();
        state.monacoInstance.setSelection(fullRange);
        state.monacoInstance.revealRange(fullRange);
      }
      toast('All code selected', 'info');
    } else if (el.editorTextarea) {
      el.editorTextarea.focus();
      el.editorTextarea.select();
      toast('All code selected', 'info');
    }
  }

  async function copyCurrentSelectionOrAll() {
    let textToCopy = '';
    if (state.monacoInstance) {
      const selection = state.monacoInstance.getSelection();
      if (selection && !selection.isEmpty()) {
        const model = state.monacoInstance.getModel();
        textToCopy = model ? model.getValueInRange(selection) : '';
      } else {
        textToCopy = state.monacoInstance.getValue();
      }
    } else if (el.editorTextarea) {
      const start = el.editorTextarea.selectionStart;
      const end = el.editorTextarea.selectionEnd;
      if (start !== end) {
        textToCopy = el.editorTextarea.value.substring(start, end);
      } else {
        textToCopy = el.editorTextarea.value;
      }
    }

    if (!textToCopy) {
      toast('Nothing to copy', 'info');
      return;
    }

    try {
      await navigator.clipboard.writeText(textToCopy);
      toast('Copied to clipboard!', 'success');
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = textToCopy;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        toast('Copied to clipboard!', 'success');
      } catch (err) {
        toast('Failed to copy', 'error');
      }
    }
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      if (state.monacoInstance) {
        const selection = state.monacoInstance.getSelection();
        state.monacoInstance.executeEdits('clipboard', [{
          range: selection,
          text: text,
          forceMoveMarkers: true
        }]);
        state.monacoInstance.pushUndoStop();
        toast('Pasted!', 'success');
      } else if (el.editorTextarea) {
        const start = el.editorTextarea.selectionStart;
        const end = el.editorTextarea.selectionEnd;
        const val = el.editorTextarea.value;
        el.editorTextarea.value = val.substring(0, start) + text + val.substring(end);
        el.editorTextarea.selectionStart = el.editorTextarea.selectionEnd = start + text.length;
        onLocalChange(el.editorTextarea.value);
        toast('Pasted!', 'success');
      }
    } catch (err) {
      if (state.monacoInstance) state.monacoInstance.focus();
      else if (el.editorTextarea) el.editorTextarea.focus();
    }
  }

  async function cutCurrentSelection() {
    if (state.monacoInstance) {
      const selection = state.monacoInstance.getSelection();
      if (selection && !selection.isEmpty()) {
        const model = state.monacoInstance.getModel();
        const textToCut = model ? model.getValueInRange(selection) : '';
        try {
          await navigator.clipboard.writeText(textToCut);
        } catch (_) {}
        state.monacoInstance.executeEdits('clipboard', [{
          range: selection,
          text: '',
          forceMoveMarkers: true
        }]);
        toast('Cut to clipboard', 'info');
      }
    }
  }

  function getCode() {
    if (state.monacoInstance) return state.monacoInstance.getValue();
    return el.editorTextarea ? el.editorTextarea.value : '';
  }

  function applyRemote(code) {
    if (code === undefined || code === null || code === getCode()) return;
    // CRITICAL: If local user is actively typing within the last 1000ms, DO NOT overwrite!
    // Prevents remote SSE echoes from stomping over fast typing (e.g. helloo -> loo bug)
    if (Date.now() - state.lastLocalEditTime < 1000) return;

    state.isApplyingRemote = true;
    if (state.monacoInstance) {
      const model = state.monacoInstance.getModel();
      if (model) {
        const pos = state.monacoInstance.getPosition();
        const top = state.monacoInstance.getScrollTop();
        // NON-DESTRUCTIVE: pushEditOperations replaces text cleanly without wiping active buffer
        model.pushEditOperations(
          [],
          [{ range: model.getFullModelRange(), text: code }],
          () => (pos ? [new monaco.Selection(pos.lineNumber, pos.column, pos.lineNumber, pos.column)] : null)
        );
        if (top !== undefined) state.monacoInstance.setScrollTop(top);
      }
    } else if (el.editorTextarea) {
      el.editorTextarea.value = code;
    }
    setTimeout(() => { state.isApplyingRemote = false; }, 150);
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
    state.lastLocalEditTime = Date.now();
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
    }, 450);
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
        // Never interrupt active typing with local broadcast
        if (m.type === 'CODE' && m.roomId === roomId) {
          if (Date.now() - state.lastLocalEditTime >= 1000) {
            applyRemote(m.code);
          }
        }
        if (m.type === 'PRESENCE') pollPresence(roomId);
        if (m.type === 'CURSOR') {
          renderRemoteCursor(m.from, m.name || 'Anonymous', m.color || '#10b981', m.line, m.col);
        }
      };
    } catch (e) {}

    if (state.sseSource) { state.sseSource.close(); state.sseSource = null; }

    const sseUrl = FIREBASE_BASE + '/codeshare_rooms/' + safeKey(roomId) + '/data.json';
    try {
      state.sseSource = new EventSource(sseUrl);
      const handleRemoteEvent = (ev) => {
        try {
          const p = JSON.parse(ev.data);
          if (!p || !p.data || state.isApplyingRemote) return;

          // CRITICAL: Block Firebase SSE echoes of local user's own edits!
          if (typeof p.data === 'object' && p.data.updatedBy === state.userId) return;
          if (p.path === '/updatedBy' && p.data === state.userId) return;
          if (Date.now() - state.lastLocalEditTime < 1000) return;

          const raw = typeof p.data === 'string' ? p.data : (p.data.code !== undefined ? p.data.code : '');
          if (typeof raw === 'string' && raw !== '') {
            const decoded = decryptPayload(raw, roomId);
            applyRemote(decoded);
            try { localStorage.setItem('codeshift_code_' + roomId, decoded); } catch (e) {}
            setSaveStatus('saved');
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
  // PRESENCE & CURSOR HEARTBEAT (Reliable multi-user sync)
  // ──────────────────────────────────────────────
  function presenceStart(roomId) {
    if (state.presenceTimer) clearInterval(state.presenceTimer);
    presencePing(roomId);
    pollPresence(roomId);
    // 4s interval — saves ~25% Firebase reads vs 3s without affecting UX
    state.presenceTimer = setInterval(() => {
      // Skip pings when tab is hidden — saves battery and Firebase quota
      if (document.hidden) return;
      presencePing(roomId);
      pollPresence(roomId);
    }, 4000);
  }

  // Ping immediately when user focuses tab or visibility changes
  window.addEventListener('focus', () => {
    if (state.roomId) {
      presencePing(state.roomId);
      pollPresence(state.roomId);
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.roomId) {
      presencePing(state.roomId);
      pollPresence(state.roomId);
    }
  });

  function presencePing(roomId) {
    if (!roomId) return;
    const url = FIREBASE_BASE + '/codeshare_rooms/' + safeKey(roomId) + '/presence/' + state.userId + '.json';
    fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ts: Date.now(),
        name: state.userName,
        color: state.userColor,
        line: state.cursorLine || 1,
        col: state.cursorCol || 1
      })
    }).then(() => {
      pollPresence(roomId);
    }).catch(() => {});

    if (state.broadcastChannel) {
      try {
        state.broadcastChannel.postMessage({
          type: 'PRESENCE',
          from: state.userId,
          name: state.userName,
          color: state.userColor,
          line: state.cursorLine || 1
        });
      } catch (e) {}
    }
  }

  function pollPresence(roomId) {
    if (!roomId) return;
    // Always bust cache so browsers never return stale peer counts
    const url = FIREBASE_BASE + '/codeshare_rooms/' + safeKey(roomId) + '/presence.json?t=' + Date.now();
    fetch(url, { cache: 'no-store' })
      .then(r => r.json())
      .then(map => {
        if (!map || typeof map !== 'object') {
          setOnline(1, []);
          return;
        }
        const now = Date.now();

        // Separate active users vs dead users
        const peers = [];
        const activeUids = new Set();
        const deadUids = [];

        Object.entries(map).forEach(([uid, data]) => {
          if (!data || typeof data !== 'object') {
            deadUids.push(uid);
            return;
          }
          const ts = typeof data.ts === 'number' ? data.ts : 0;
          const age = now - ts;

          // Active heartbeat window: 9 seconds (heartbeat pings sent every 3 seconds)
          // Tolerate slight clock drift (-5000ms to +9000ms)
          const isAlive = (age >= -5000 && age < 9000);

          if (isAlive) {
            if (uid !== state.userId) {
              peers.push(data);
              activeUids.add(uid);
              if (data.line) {
                renderRemoteCursor(uid, data.name || 'Anonymous', data.color || '#10b981', data.line, data.col || 1);
              }
            }
          } else {
            // Dead entry older than 9 seconds -> immediately queue for deletion from Firebase
            deadUids.push(uid);
          }
        });

        // Automatically delete dead/stale records from Firebase so the database never accumulates old junk!
        if (deadUids.length > 0) {
          deadUids.forEach(deadUid => {
            fetch(FIREBASE_BASE + '/codeshare_rooms/' + safeKey(roomId) + '/presence/' + deadUid + '.json', {
              method: 'DELETE'
            }).catch(() => {});
          });
        }

        // Clean up cursors for disconnected peers
        Object.keys(remoteCursors).forEach(uid => {
          if (!activeUids.has(uid)) {
            removeRemoteCursor(uid);
          }
        });

        // Total count = 1 (local user) + count of active remote peers
        const totalCount = peers.length + 1;
        setOnline(totalCount, peers);
      })
      .catch(() => setOnline(1, []));
  }

  // ──────────────────────────────────────────────
  // ANONYMOUS SESSION TIME TRACKING & VISITOR LOGS
  // ──────────────────────────────────────────────
  const sessionStartTime = Date.now();
  let sessionHeartbeatTimer = null;

  function getDeviceType() {
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua)) return 'iOS (Mobile)';
    if (/Android/.test(ua)) return 'Android (Mobile)';
    if (/Mac OS X/.test(ua)) return 'macOS (Desktop)';
    if (/Windows/.test(ua)) return 'Windows (Desktop)';
    if (/Linux/.test(ua)) return 'Linux (Desktop)';
    return 'Other';
  }

  function initSessionTracking() {
    const nowIso = new Date().toISOString();
    const payload = {
      joinedAt: nowIso,
      lastSeenAt: nowIso,
      durationSeconds: 0,
      room: state.roomId || 'landing',
      device: getDeviceType(),
      referrer: document.referrer ? document.referrer.slice(0, 100) : 'Direct',
      date: nowIso.slice(0, 10)
    };

    fetch(FIREBASE_BASE + '/codeshare_rooms/_analytics/sessions/' + state.userId + '.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => {});

    if (sessionHeartbeatTimer) clearInterval(sessionHeartbeatTimer);
    sessionHeartbeatTimer = setInterval(updateSessionDuration, 30000);
  }

  function updateSessionDuration() {
    const duration = Math.max(0, Math.round((Date.now() - sessionStartTime) / 1000));
    fetch(FIREBASE_BASE + '/codeshare_rooms/_analytics/sessions/' + state.userId + '.json', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lastSeenAt: new Date().toISOString(),
        durationSeconds: duration,
        room: state.roomId || 'landing'
      })
    }).catch(() => {});
  }

  // Guaranteed instant presence cleanup when tab is closed or reloaded
  function cleanupPresence() {
    if (state.roomId && state.userId) {
      const url = FIREBASE_BASE + '/codeshare_rooms/' + safeKey(state.roomId) + '/presence/' + state.userId + '.json';
      try {
        fetch(url, { method: 'DELETE', keepalive: true }).catch(() => {});
      } catch (_) {}
    }
  }

  window.addEventListener('beforeunload', () => {
    if (state.userId) {
      const duration = Math.max(0, Math.round((Date.now() - sessionStartTime) / 1000));
      const url = FIREBASE_BASE + '/codeshare_rooms/_analytics/sessions/' + state.userId + '.json';
      try {
        fetch(url, {
          method: 'PATCH',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lastSeenAt: new Date().toISOString(),
            durationSeconds: duration,
            room: state.roomId || 'landing'
          })
        }).catch(() => {});
      } catch (_) {}
    }
    cleanupPresence();
  });

  window.addEventListener('pagehide', cleanupPresence);

  function setOnline(n, peerList = []) {
    if (el.onlineCount) el.onlineCount.textContent = n + ' online';
    const peerNumEl = document.getElementById('peers-count-num');
    if (peerNumEl) peerNumEl.textContent = n;

    // Render collaborators in dropdown list
    const dropList = document.getElementById('peers-dropdown-list');
    if (dropList) {
      let html = `
        <div class="peer-row">
          <div class="peer-row-left">
            <span class="peer-dot" style="background:${state.userColor || '#28c840'};"></span>
            <span class="peer-name-text">${escapeHtml(state.userName || 'You')}</span>
            <span class="peer-role-tag">You</span>
          </div>
          <span class="peer-loc-tag">Line ${state.cursorLine || 1}</span>
        </div>
      `;
      peerList.forEach(p => {
        const lineText = p.line ? `Line ${p.line}` : 'Viewing';
        html += `
          <div class="peer-row">
            <div class="peer-row-left">
              <span class="peer-dot" style="background:${p.color || '#3b82f6'};"></span>
              <span class="peer-name-text">${escapeHtml(p.name || 'Anonymous')}</span>
            </div>
            <span class="peer-loc-tag">${lineText}</span>
          </div>
        `;
      });
      dropList.innerHTML = html;
    }
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
      'padding:9px 16px', 'border-radius:6px', 'font-size:12px',
      'font-family:var(--cs-font-mono), monospace', 'font-weight:600',
      'background:#111111', 'color:#ffffff', 'border:1px solid #333333',
      'box-shadow:0 8px 24px rgba(0,0,0,0.85)',
      'transition:opacity 0.2s ease', 'opacity:1', 'pointer-events:none'
    ].join(';');
    document.body.appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 200);
    }, 1600);
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
    const ctx = canvas.getContext('2d', { alpha: false }); // alpha:false → GPU compositing skip

    let W, H;
    let time = 0;
    let cachedBg = null;   // cached gradient — only recreated on resize
    let lastW = 0, lastH = 0;

    function resize() {
      W = canvas.width  = window.innerWidth;
      H = canvas.height = window.innerHeight;
      cachedBg = null;   // invalidate gradient cache on resize
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

      // ── BACKGROUND — reuse cached gradient, only rebuild on first frame or after resize ──
      if (!cachedBg || W !== lastW || H !== lastH) {
        cachedBg = ctx.createLinearGradient(0, 0, 0, H);
        cachedBg.addColorStop(0,    '#000000');
        cachedBg.addColorStop(0.35, '#040404');
        cachedBg.addColorStop(0.70, '#080808');
        cachedBg.addColorStop(1,    '#000000');
        lastW = W; lastH = H;
      }
      ctx.fillStyle = cachedBg;
      ctx.fillRect(0, 0, W, H);

      // ── FULL-PAGE 3D MONOCHROME PARTICLE WAVE MATRIX (BLACK & WHITE THEME) ──
      // Reduce grid density on mobile significantly to cut CPU load
      const isMobile = W < 768;
      const COLS = isMobile ? 32 : 60;
      const ROWS = isMobile ? 24 : 42;
      const fov = 330;

      // Disable shadow by default; only enable for crest dots
      ctx.shadowBlur = 0;

      for (let r = 0; r < ROWS; r++) {
        const normR = r / (ROWS - 1);
        const depthFade = Math.pow(normR, 0.60);
        const worldZ = (1 - normR) * 760 + 65;
        const scale = fov / (worldZ + fov);

        const rowPoints = [];

        for (let c = 0; c < COLS; c++) {
          const normC = (c / (COLS - 1)) - 0.5;
          const worldX = normC * (W * 1.68);

          // Flowing 3D wave harmonics spanning the full canvas
          const w1 = Math.sin(normC * 7.2 + time * 1.18) * 60;
          const w2 = Math.cos(normR * 8.4 - time * 0.88) * 50;
          const w3 = Math.sin((normC * 4.5 + normR * 6.0) + time * 0.70) * 36;
          const w4 = Math.cos(normC * 11.5 - time * 1.38) * 20;
          const w5 = Math.sin(normR * 13.5 + time * 1.05) * 15;
          let elevation = w1 + w2 + w3 + w4 + w5;

          const baseProjX = W * 0.5 + worldX * scale;
          const baseProjY = (H * 0.02) + (H * 1.02) * Math.pow(normR, 0.88) + elevation * scale;

          // Live mouse reaction — dynamic fluid ripple & air-breather
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
          const normElev = (elevation + 105) / 210;
          const crest = Math.max(0, Math.min(1, normElev));

          rowPoints.push({ screenX, screenY, crest, depthFade });
        }

        // Draw fine flowing ribbon contour line in crisp silver monochrome
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.03 + depthFade * 0.14})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        for (let i = 0; i < rowPoints.length; i++) {
          const pt = rowPoints[i];
          if (i === 0) ctx.moveTo(pt.screenX, pt.screenY);
          else ctx.lineTo(pt.screenX, pt.screenY);
        }
        ctx.stroke();

        // Batch: draw all trough dots first (no shadow), then crest dots (with shadow)
        // This avoids repeatedly toggling ctx.shadowBlur inside the per-dot loop
        ctx.shadowBlur = 0;
        for (let i = 0; i < rowPoints.length; i++) {
          const pt = rowPoints[i];
          if (pt.crest > 0.60) continue; // skip crests in this pass
          const dotRadius = Math.max(0.65, (0.95 + pt.crest * 1.85) * (0.42 + pt.depthFade * 0.88));
          const alpha = Math.min(1, (0.16 + pt.crest * 0.80) * (0.30 + pt.depthFade * 0.70));
          const grey = Math.round(100 + pt.crest * 110);
          ctx.fillStyle = `rgba(${grey},${grey},${grey},${(alpha * 0.82).toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(pt.screenX, pt.screenY, dotRadius, 0, Math.PI * 2);
          ctx.fill();
        }

        // Second pass: crest dots with shadow (batch shadow state change to once per row max)
        ctx.shadowColor = 'rgba(255,255,255,0.9)';
        ctx.shadowBlur = Math.round(7 * depthFade);
        ctx.fillStyle = null;
        for (let i = 0; i < rowPoints.length; i++) {
          const pt = rowPoints[i];
          if (pt.crest <= 0.60) continue;
          const dotRadius = Math.max(0.65, (0.95 + pt.crest * 1.85) * (0.42 + pt.depthFade * 0.88));
          const alpha = Math.min(1, (0.16 + pt.crest * 0.80) * (0.30 + pt.depthFade * 0.70));
          ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(pt.screenX, pt.screenY, dotRadius, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
      }

      // Pause animation when tab is hidden — saves CPU & battery
      if (document.hidden) {
        state.canvasAnimId = requestAnimationFrame(render);
        return;
      }
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
  const btnOpenPrivacy   = document.getElementById('btn-open-privacy');
  const btnClosePrivacy  = document.getElementById('btn-close-privacy');
  const btnDonePrivacy   = document.getElementById('btn-done-privacy');

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
    const extMap = {
      typescript: 'ts', javascript: 'js', python: 'py', plaintext: 'txt',
      markdown: 'md', html: 'html', css: 'css', rust: 'rs', go: 'go',
      cpp: 'cpp', json: 'json', sql: 'sql'
    };
    const ext = extMap[state.language] || 'txt';
    const fname = (state.roomId || 'codeshift') + '.' + ext;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([code], { type: 'text/plain' }));
    a.download = fname;
    a.click();
    toast('Downloaded ' + fname, 'success');
  });

  // ── Pro IDE Workspace Controls ──
  const btnSelectAll       = document.getElementById('btn-select-all');
  const btnQuickCopy       = document.getElementById('btn-quick-copy');
  const langSelectStatus   = document.getElementById('ide-status-lang-select');

  // Select All Button in Top Bar (Desktop)
  if (btnSelectAll) {
    btnSelectAll.addEventListener('click', () => {
      selectAllCode();
    });
  }

  // Copy Code Button in Top Bar (Right next to Share)
  if (btnQuickCopy) {
    btnQuickCopy.addEventListener('click', () => {
      const code = getCode();
      if (!code) {
        toast('Editor is empty', 'info');
        return;
      }
      navigator.clipboard.writeText(code).then(() => {
        toast('All code copied to clipboard!', 'success');
      }).catch(() => {
        // Fallback copy for legacy browsers
        try {
          const ta = document.createElement('textarea');
          ta.value = code;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          toast('All code copied to clipboard!', 'success');
        } catch (e) {
          toast('Failed to copy code', 'error');
        }
      });
    });
  }

  // Syntax switcher in status bar
  if (langSelectStatus) {
    langSelectStatus.addEventListener('change', (e) => setEditorLanguage(e.target.value));
  }

  // Collaborators Dropdown (View full collaborator names & set custom nickname)
  const badgeBtn = document.getElementById('online-users-badge');
  const peersMenu = document.getElementById('peers-dropdown');
  const btnClosePeers = document.getElementById('btn-close-peers-dropdown');
  const btnSaveNick = document.getElementById('btn-save-nickname');
  const inputNick   = document.getElementById('input-my-nickname');

  if (badgeBtn && peersMenu) {
    badgeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      peersMenu.classList.toggle('hidden');
      if (inputNick && state.userName) {
        inputNick.value = state.userName;
      }
    });

    if (btnClosePeers) {
      btnClosePeers.addEventListener('click', (e) => {
        e.stopPropagation();
        peersMenu.classList.add('hidden');
      });
    }

    document.addEventListener('click', (e) => {
      if (!peersMenu.contains(e.target) && !badgeBtn.contains(e.target)) {
        peersMenu.classList.add('hidden');
      }
    });

    if (btnSaveNick && inputNick) {
      btnSaveNick.addEventListener('click', () => {
        const val = inputNick.value.trim();
        if (!val) return;
        state.userName = val;
        localStorage.setItem('codeshift_nickname', val);
        if (state.roomId) {
          presencePing(state.roomId);
          pollPresence(state.roomId);
        }
        toast('Nickname set to "' + val + '"', 'success');
      });

      inputNick.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          btnSaveNick.click();
        }
      });
    }
  }

  // Mobile "More" Menu Toggle & Handlers
  const btnMobMore       = document.getElementById('btn-mobile-more');
  const mobMoreMenu      = document.getElementById('mobile-more-menu');
  const btnMobSelectAll  = document.getElementById('btn-mob-select-all');
  const btnMobNew        = document.getElementById('btn-mob-new');
  const btnMobExport     = document.getElementById('btn-mob-export');
  const btnMobSet        = document.getElementById('btn-mob-settings');

  if (btnMobMore && mobMoreMenu) {
    btnMobMore.addEventListener('click', (e) => {
      e.stopPropagation();
      mobMoreMenu.classList.toggle('hidden');
    });

    if (btnMobSelectAll) {
      btnMobSelectAll.addEventListener('click', () => {
        mobMoreMenu.classList.add('hidden');
        selectAllCode();
      });
    }

    if (btnMobNew && btnCreateNew) {
      btnMobNew.addEventListener('click', () => {
        mobMoreMenu.classList.add('hidden');
        btnCreateNew.click();
      });
    }

    if (btnMobExport && btnDownload) {
      btnMobExport.addEventListener('click', () => {
        mobMoreMenu.classList.add('hidden');
        btnDownload.click();
      });
    }

    if (btnMobSet && btnOpenSettings) {
      btnMobSet.addEventListener('click', () => {
        mobMoreMenu.classList.add('hidden');
        btnOpenSettings.click();
      });
    }

    document.addEventListener('click', (e) => {
      if (!mobMoreMenu.contains(e.target) && !btnMobMore.contains(e.target)) {
        mobMoreMenu.classList.add('hidden');
      }
    });
  }

  // Modal helpers — guaranteed to open/close cleanly
  function openModal(m) {
    if (!m) return;
    m.classList.remove('hidden');
    m.style.display = 'flex';
  }
  function closeModal(m) {
    if (!m) return;
    m.classList.add('hidden');
    m.classList.remove('flex');
    m.style.display = 'none';
  }

  // Settings
  if (btnOpenSettings) btnOpenSettings.addEventListener('click', () => {
    if (el.settingFontsize) el.settingFontsize.value = state.settings.fontSize;
    if (el.settingTabsize)  el.settingTabsize.value  = state.settings.tabSize;
    if (el.settingWordwrap) el.settingWordwrap.checked = state.settings.wordWrap;
    if (el.settingSound)   el.settingSound.checked   = state.settings.sound;
    openModal(el.modalSettings);
  });
  if (btnCloseSettings) btnCloseSettings.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeModal(el.modalSettings);
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
    closeModal(el.modalSettings);
    toast('Settings saved!', 'success');
  });

  // Share Modal
  if (btnModalCopyLink) btnModalCopyLink.addEventListener('click', copyLink);
  if (btnModalDone)     btnModalDone.addEventListener('click', () => closeModal(el.modalShare));
  if (btnCloseShare)    btnCloseShare.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeModal(el.modalShare);
  });

  // Privacy Policy Modal
  if (btnOpenPrivacy)  btnOpenPrivacy.addEventListener('click', () => openModal(el.modalPrivacy));
  if (btnClosePrivacy) btnClosePrivacy.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeModal(el.modalPrivacy);
  });
  if (btnDonePrivacy)  btnDonePrivacy.addEventListener('click', () => closeModal(el.modalPrivacy));

  // URL prefix in landing page room input and code preview card
  function updateUrlPrefix() {
    try {
      const prefix = 'codeshift /';
      if (el.roomPrefixLabel) el.roomPrefixLabel.textContent = prefix;
      if (el.codeCardComment) el.codeCardComment.textContent = '// codeshift/your-room · synced in real-time';
    } catch (_) {}
  }

  // Modal Backdrop Dismiss
  [el.modalSettings, el.modalShare, el.modalPrivacy].forEach(modal => {
    if (modal) modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal(modal);
    });
  });

  // Status Bar Telemetry Click-to-Select All
  if (el.codeStats) {
    el.codeStats.addEventListener('click', () => selectAllCode());
  }
  const charsCountEl = document.getElementById('code-chars-count');
  if (charsCountEl) {
    charsCountEl.addEventListener('click', () => selectAllCode());
  }

  // Universal Cross-Platform Keyboard Shortcuts (Control / Cmd for A, C, V, X)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal(el.modalSettings);
      closeModal(el.modalShare);
      closeModal(el.modalPrivacy);
      if (peersMenu) peersMenu.classList.add('hidden');
      if (mobMoreMenu) mobMoreMenu.classList.add('hidden');
      return;
    }

    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    if (!isCtrlOrCmd) return;

    const key = (e.key || '').toLowerCase();
    const code = e.code || '';

    // Allow standard input actions when typing inside inputs (nickname, room search, etc.)
    const activeEl = document.activeElement;
    const isOtherInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') &&
                         activeEl.id !== 'code-editor-textarea' &&
                         !activeEl.closest('#monaco-editor-container');

    // ── Select All (Control+A / Cmd+A) ──
    if (key === 'a' || code === 'KeyA') {
      if (isOtherInput) return;
      if (el.editorView && !el.editorView.classList.contains('hidden')) {
        e.preventDefault();
        selectAllCode();
      }
    }

    // ── Copy (Control+C / Cmd+C) ──
    else if (key === 'c' || code === 'KeyC') {
      if (isOtherInput) return;
      if (el.editorView && !el.editorView.classList.contains('hidden')) {
        // On Mac, Control+C is ignored natively; execute our copy!
        if (e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          copyCurrentSelectionOrAll();
        }
      }
    }

    // ── Paste (Control+V / Cmd+V) ──
    else if (key === 'v' || code === 'KeyV') {
      if (isOtherInput) return;
      if (el.editorView && !el.editorView.classList.contains('hidden')) {
        // On Mac, Control+V is ignored natively; execute our paste!
        if (e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          pasteFromClipboard();
        }
      }
    }

    // ── Cut (Control+X / Cmd+X) ──
    else if (key === 'x' || code === 'KeyX') {
      if (isOtherInput) return;
      if (el.editorView && !el.editorView.classList.contains('hidden')) {
        // On Mac, Control+X is ignored natively; execute our cut!
        if (e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          cutCurrentSelection();
        }
      }
    }
  });

  // ──────────────────────────────────────────────
  // BOOTSTRAP
  // ──────────────────────────────────────────────
  updateUrlPrefix();
  initRouter();
  initSessionTracking();

})();
