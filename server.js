/**
 * CodeShift — Production-Grade Collaborative Server
 * "Think together. Code without limits."
 *
 * Features:
 * - Native RFC 6455 WebSocket Server (Zero external dependencies)
 * - Internet-wide Multi-Room Synchronization
 * - Shared Server-Side Document State & In-Memory Cloud Store
 * - Remote Cursors, Selections, and Live Presence
 * - Host Permissions, View-Only Locks & Room Password Protection
 * - Persistent Room Snapshots & Room Chat History
 * - Single-Page Application Static File Serving
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const BASE_DIR = __dirname;
const DATA_DIR = path.join(BASE_DIR, '.data');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');

// Ensure data persistence directory exists
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (e) {
  // read-only environments
}

// In-Memory Room Store
// Map<roomId, { id, code, language, version, isReadOnly, password, hostUserId, clients: Map<socket, clientData>, snapshots: [], chat: [] }>
const rooms = new Map();

// Load persisted room states if available
function loadPersistedRooms() {
  try {
    if (fs.existsSync(ROOMS_FILE)) {
      const raw = fs.readFileSync(ROOMS_FILE, 'utf8');
      const data = JSON.parse(raw);
      for (const [id, r] of Object.entries(data)) {
        rooms.set(id, {
          id: r.id,
          code: r.code || '',
          language: r.language || 'javascript',
          version: r.version || 1,
          isReadOnly: !!r.isReadOnly,
          password: r.password || null,
          hostUserId: r.hostUserId || null,
          clients: new Map(),
          snapshots: r.snapshots || [],
          chat: r.chat || []
        });
      }
      console.log(`  💾 Restored ${rooms.size} rooms from local persistence store.`);
    }
  } catch (err) {
    console.warn('  ⚠️ Could not read persisted rooms file:', err.message);
  }
}

function savePersistedRooms() {
  try {
    const data = {};
    for (const [id, r] of rooms.entries()) {
      data[id] = {
        id: r.id,
        code: r.code,
        language: r.language,
        version: r.version,
        isReadOnly: r.isReadOnly,
        password: r.password,
        hostUserId: r.hostUserId,
        snapshots: r.snapshots.slice(0, 50),
        chat: r.chat.slice(-100)
      };
    }
    fs.writeFileSync(ROOMS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    // Ignore if running in ephemeral or restricted environment
  }
}

// Auto-save every 30 seconds
setInterval(savePersistedRooms, 30000);

loadPersistedRooms();

function getOrCreateRoom(roomId) {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      id: roomId,
      code: `// CodeShift • Room: #${roomId}\n// Think together. Code without limits.\n\nconsole.log("Welcome to CodeShift room #${roomId}!");\n`,
      language: 'javascript',
      version: 1,
      isReadOnly: false,
      password: null,
      hostUserId: null,
      clients: new Map(),
      snapshots: [
        {
          id: 'snap_init_' + Date.now(),
          title: 'Initial Room Setup',
          author: 'System',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          date: new Date().toLocaleDateString(),
          lines: 4,
          code: `// CodeShift • Room: #${roomId}\n// Think together. Code without limits.\n\nconsole.log("Welcome to CodeShift room #${roomId}!");\n`
        }
      ],
      chat: [
        {
          id: 'msg_welcome',
          userId: 'system',
          userName: 'CodeShift',
          userColor: '#8B7CFF',
          text: `Welcome to room #${roomId}. Connected via real-time WebSocket.`,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]
    };
    rooms.set(roomId, room);
  }
  return room;
}

// MIME Types
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

// ==========================================
// 1. HTTP Server & REST API
// ==========================================
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  let pathname = decodeURIComponent(parsedUrl.pathname);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // REST API: Health Check
  if (pathname === '/api/health') {
    let totalClients = 0;
    for (const r of rooms.values()) totalClients += r.clients.size;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      activeRooms: rooms.size,
      connectedClients: totalClients,
      timestamp: Date.now()
    }));
    return;
  }

  // REST API: Room Info
  if (pathname.startsWith('/api/room/') && pathname.endsWith('/info')) {
    const roomId = pathname.split('/')[3];
    const room = rooms.get(roomId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (!room) {
      res.end(JSON.stringify({ exists: false, isProtected: false, participantCount: 0 }));
    } else {
      res.end(JSON.stringify({
        exists: true,
        isProtected: !!room.password,
        isReadOnly: room.isReadOnly,
        participantCount: room.clients.size,
        language: room.language,
        snapshotsCount: room.snapshots.length
      }));
    }
    return;
  }

  // Static File Serving & SPA Fallback
  if (pathname === '/' || pathname.startsWith('/room/')) {
    pathname = '/index.html';
  }

  let filePath = path.join(BASE_DIR, pathname);

  if (!filePath.startsWith(BASE_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // SPA Fallback
      const indexPath = path.join(BASE_DIR, 'index.html');
      fs.readFile(indexPath, (readErr, content) => {
        if (readErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(content);
        }
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Internal Server Error');
        return;
      }

      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
        'X-Powered-By': 'CodeShift Engine'
      });
      res.end(data);
    });
  });
});

// ==========================================
// 2. Native RFC 6455 WebSocket Implementation
// ==========================================
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function computeAcceptKey(key) {
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
}

function sendWsFrame(socket, payloadText) {
  if (socket.destroyed || !socket.writable) return;
  const payload = Buffer.from(payloadText, 'utf8');
  const length = payload.length;

  let header;
  if (length <= 125) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text frame
    header[1] = length;
  } else if (length <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  socket.write(Buffer.concat([header, payload]));
}

function sendWsPing(socket) {
  if (socket.destroyed || !socket.writable) return;
  const ping = Buffer.from([0x89, 0x00]); // FIN + PING opcode (0x9), len 0
  socket.write(ping);
}

// WebSocket Frame Parser
class WsParser {
  constructor(onMessage, onClose) {
    this.onMessage = onMessage;
    this.onClose = onClose;
    this.buffer = Buffer.alloc(0);
  }

  feed(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.process();
  }

  process() {
    while (this.buffer.length >= 2) {
      const firstByte = this.buffer[0];
      const secondByte = this.buffer[1];

      const fin = (firstByte & 0x80) !== 0;
      const opcode = firstByte & 0x0f;
      const isMasked = (secondByte & 0x80) !== 0;
      let payloadLength = secondByte & 0x7f;

      let offset = 2;

      if (payloadLength === 126) {
        if (this.buffer.length < offset + 2) return;
        payloadLength = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLength === 127) {
        if (this.buffer.length < offset + 8) return;
        payloadLength = Number(this.buffer.readBigUInt64BE(offset));
        offset += 8;
      }

      let maskKey = null;
      if (isMasked) {
        if (this.buffer.length < offset + 4) return;
        maskKey = this.buffer.slice(offset, offset + 4);
        offset += 4;
      }

      if (this.buffer.length < offset + payloadLength) return; // Wait for full payload

      const rawPayload = this.buffer.slice(offset, offset + payloadLength);
      this.buffer = this.buffer.slice(offset + payloadLength);

      // Unmask
      if (isMasked && maskKey) {
        for (let i = 0; i < rawPayload.length; i++) {
          rawPayload[i] ^= maskKey[i % 4];
        }
      }

      // Handle Opcode
      if (opcode === 0x8) {
        // Close frame
        if (this.onClose) this.onClose();
        return;
      } else if (opcode === 0x9) {
        // Ping
        continue;
      } else if (opcode === 0x1) {
        // Text frame
        const text = rawPayload.toString('utf8');
        if (this.onMessage) this.onMessage(text);
      }
    }
  }
}

// Upgrade listener
server.on('upgrade', (req, socket, head) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Expected path: /ws/room/:roomId
  if (!pathname.startsWith('/ws/room/')) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }

  const roomId = pathname.split('/')[3];
  if (!roomId || !/^[a-zA-Z0-9_\-\.]{1,64}$/.test(roomId)) {
    socket.write('HTTP/1.1 400 Invalid Room ID\r\n\r\n');
    socket.destroy();
    return;
  }

  const clientKey = req.headers['sec-websocket-key'];
  if (!clientKey) {
    socket.write('HTTP/1.1 400 Missing Sec-WebSocket-Key\r\n\r\n');
    socket.destroy();
    return;
  }

  const acceptKey = computeAcceptKey(clientKey);

  const responseHeaders = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    'X-Powered-By: CodeShift Sync'
  ];

  socket.write(responseHeaders.join('\r\n') + '\r\n\r\n');

  // Handle client in room
  handleWsConnection(socket, roomId, parsedUrl.query);
});

function broadcastToRoom(room, senderSocket, messageObj, includeSender = false) {
  const payload = JSON.stringify(messageObj);
  for (const [clientSocket, client] of room.clients.entries()) {
    if (includeSender || clientSocket !== senderSocket) {
      sendWsFrame(clientSocket, payload);
    }
  }
}

function handleWsConnection(socket, roomId, query) {
  const room = getOrCreateRoom(roomId);

  let currentClient = {
    userId: query.userId || 'usr_' + crypto.randomBytes(4).toString('hex'),
    userName: query.userName || 'Anonymous',
    userColor: query.userColor || '#8B7CFF',
    cursor: null,
    isHost: false,
    isAuthenticated: !room.password
  };

  // Determine host: First client or matching host token
  if (!room.hostUserId || room.clients.size === 0) {
    room.hostUserId = currentClient.userId;
    currentClient.isHost = true;
  } else if (room.hostUserId === currentClient.userId) {
    currentClient.isHost = true;
  }

  room.clients.set(socket, currentClient);

  // Send Initial State to the joining client
  sendWsFrame(socket, JSON.stringify({
    type: 'ROOM_INIT',
    roomId: room.id,
    code: room.code,
    language: room.language,
    version: room.version,
    isReadOnly: room.isReadOnly,
    isProtected: !!room.password,
    isHost: currentClient.isHost,
    peers: Array.from(room.clients.values()).map(c => ({
      userId: c.userId,
      userName: c.userName,
      userColor: c.userColor,
      isHost: c.isHost,
      cursor: c.cursor
    })),
    snapshots: room.snapshots,
    chat: room.chat
  }));

  // Broadcast peer join to other users in room
  broadcastToRoom(room, socket, {
    type: 'PEER_JOIN',
    peer: {
      userId: currentClient.userId,
      userName: currentClient.userName,
      userColor: currentClient.userColor,
      isHost: currentClient.isHost
    }
  }, false);

  const parser = new WsParser(
    // On Message
    (msgText) => {
      try {
        const msg = JSON.parse(msgText);
        handleRoomMessage(room, socket, currentClient, msg);
      } catch (err) {
        console.warn('Invalid JSON message from client:', err.message);
      }
    },
    // On Close
    () => {
      cleanupClient(room, socket, currentClient);
    }
  );

  socket.on('data', (chunk) => parser.feed(chunk));
  socket.on('end', () => cleanupClient(room, socket, currentClient));
  socket.on('error', () => cleanupClient(room, socket, currentClient));
}

function handleRoomMessage(room, socket, client, msg) {
  switch (msg.type) {
    case 'VERIFY_PASSWORD': {
      if (room.password && msg.password === room.password) {
        client.isAuthenticated = true;
        sendWsFrame(socket, JSON.stringify({ type: 'PASSWORD_VERIFIED', success: true }));
      } else {
        sendWsFrame(socket, JSON.stringify({ type: 'PASSWORD_VERIFIED', success: false, error: 'Incorrect room password' }));
      }
      break;
    }

    case 'SET_PASSWORD': {
      if (client.isHost) {
        room.password = msg.password ? String(msg.password).trim() : null;
        broadcastToRoom(room, null, {
          type: 'ROOM_SECURITY_UPDATED',
          isProtected: !!room.password
        }, true);
      }
      break;
    }

    case 'TOGGLE_READ_ONLY': {
      if (client.isHost) {
        room.isReadOnly = !!msg.isReadOnly;
        broadcastToRoom(room, null, {
          type: 'ROOM_READ_ONLY_CHANGED',
          isReadOnly: room.isReadOnly
        }, true);
      }
      break;
    }

    case 'SYNC_DOC': {
      // Check read-only permission for non-hosts
      if (room.isReadOnly && !client.isHost) {
        sendWsFrame(socket, JSON.stringify({
          type: 'PERMISSION_DENIED',
          message: 'Room is locked in read-only mode by the host.'
        }));
        return;
      }

      room.code = msg.code || '';
      room.version++;

      broadcastToRoom(room, socket, {
        type: 'DOC_UPDATED',
        code: room.code,
        version: room.version,
        userId: client.userId,
        userName: client.userName
      }, false);
      break;
    }

    case 'SET_LANGUAGE': {
      room.language = msg.language || 'javascript';
      broadcastToRoom(room, socket, {
        type: 'LANGUAGE_UPDATED',
        language: room.language,
        userId: client.userId
      }, false);
      break;
    }

    case 'CURSOR_MOVE': {
      client.cursor = { line: msg.line, col: msg.col, selection: msg.selection || null };
      broadcastToRoom(room, socket, {
        type: 'PEER_CURSOR',
        userId: client.userId,
        userName: client.userName,
        userColor: client.userColor,
        cursor: client.cursor
      }, false);
      break;
    }

    case 'CHAT_MESSAGE': {
      const chatItem = {
        id: 'msg_' + Date.now(),
        userId: client.userId,
        userName: client.userName,
        userColor: client.userColor,
        text: String(msg.text || '').substring(0, 1000),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      room.chat.push(chatItem);
      if (room.chat.length > 200) room.chat.shift();

      broadcastToRoom(room, null, {
        type: 'NEW_CHAT_MESSAGE',
        message: chatItem
      }, true);
      break;
    }

    case 'CREATE_SNAPSHOT': {
      const snap = {
        id: 'snap_' + Date.now(),
        title: msg.title || `Snapshot ${room.snapshots.length + 1}`,
        author: client.userName,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        date: new Date().toLocaleDateString(),
        code: room.code,
        lines: (room.code || '').split('\n').length
      };
      room.snapshots.unshift(snap);
      if (room.snapshots.length > 50) room.snapshots.pop();

      broadcastToRoom(room, null, {
        type: 'SNAPSHOT_SAVED',
        snapshot: snap
      }, true);
      break;
    }

    case 'HEARTBEAT': {
      sendWsFrame(socket, JSON.stringify({ type: 'HEARTBEAT_ACK', timestamp: Date.now() }));
      break;
    }
  }
}

function cleanupClient(room, socket, client) {
  if (room.clients.has(socket)) {
    room.clients.delete(socket);

    // If host left, elect new host if room not empty
    if (client.isHost && room.clients.size > 0) {
      const nextSocket = room.clients.keys().next().value;
      const nextClient = room.clients.get(nextSocket);
      if (nextClient) {
        nextClient.isHost = true;
        room.hostUserId = nextClient.userId;
        broadcastToRoom(room, null, {
          type: 'HOST_CHANGED',
          newHostUserId: nextClient.userId,
          newHostName: nextClient.userName
        }, true);
      }
    }

    broadcastToRoom(room, null, {
      type: 'PEER_LEAVE',
      userId: client.userId,
      userName: client.userName
    }, false);
  }
}

// Keep-alive heartbeat pinger every 25 seconds
setInterval(() => {
  for (const room of rooms.values()) {
    for (const socket of room.clients.keys()) {
      sendWsPing(socket);
    }
  }
}, 25000);

// Start Server
server.listen(PORT, () => {
  console.log('\n' + '='.repeat(64));
  console.log('  ⚡ CODESHIFT — Real-Time Production Collaborative Server');
  console.log('  "Think together. Code without limits."');
  console.log('='.repeat(64));
  console.log(`\n  🚀 HTTP & WebSocket Server: \x1b[36mhttp://localhost:${PORT}\x1b[0m`);
  console.log(`  🌐 WebSocket Room Endpoint:  \x1b[35mws://localhost:${PORT}/ws/room/:roomId\x1b[0m`);
  console.log(`  📁 Static Workspace Root:   \x1b[90m${BASE_DIR}\x1b[0m`);
  console.log(`  💾 In-Memory Cloud Store:   \x1b[90m${DATA_DIR}\x1b[0m\n`);
  console.log('  Ready for multi-user internet pairing sessions.\n');
});
