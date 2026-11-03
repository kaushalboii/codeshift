/**
 * CodeShift — Cloudflare Worker + Durable Objects Backend
 * "Think together. Code without limits."
 *
 * Provides:
 * - Edge-hosted real-time WebSocket room synchronization
 * - Distributed state with Cloudflare Durable Objects
 * - Cloud persistence with transactional storage
 * - Global low-latency collaboration across all continents
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
      });
    }

    // Health check
    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({ status: 'ok', provider: 'cloudflare-worker' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // WebSocket Room Endpoint: /ws/room/:roomId
    if (url.pathname.startsWith('/ws/room/')) {
      const roomId = url.pathname.split('/')[3];
      if (!roomId) {
        return new Response('Missing room ID', { status: 400 });
      }

      // Route to dedicated Durable Object for this roomId
      const id = env.CODESHIFT_ROOM.idFromName(roomId);
      const roomObject = env.CODESHIFT_ROOM.get(id);
      return roomObject.fetch(request);
    }

    // Room info endpoint
    if (url.pathname.startsWith('/api/room/') && url.pathname.endsWith('/info')) {
      const roomId = url.pathname.split('/')[3];
      const id = env.CODESHIFT_ROOM.idFromName(roomId);
      const roomObject = env.CODESHIFT_ROOM.get(id);
      return roomObject.fetch(request);
    }

    return new Response('CodeShift Cloudflare Worker API. Use /ws/room/:id to connect.', {
      headers: { 'Content-Type': 'text/plain' }
    });
  }
};

/**
 * CodeShiftRoom Durable Object
 * Manages in-memory room state, WebSockets, and Cloudflare storage persistence.
 */
export class CodeShiftRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.storage = ctx.storage;
    this.sessions = new Map(); // ws -> { userId, userName, userColor, isHost, cursor }
    this.roomData = null;
  }

  async initializeRoom(roomId) {
    if (this.roomData) return;

    const stored = await this.storage.get(['code', 'language', 'version', 'isReadOnly', 'password', 'snapshots', 'chat', 'hostUserId']);
    this.roomData = {
      id: roomId,
      code: stored.get('code') || `// CodeShift • Room: #${roomId}\n// Think together. Code without limits.\n\nconsole.log("Connected to Cloudflare Edge Room #${roomId}!");\n`,
      language: stored.get('language') || 'javascript',
      version: stored.get('version') || 1,
      isReadOnly: stored.get('isReadOnly') || false,
      password: stored.get('password') || null,
      hostUserId: stored.get('hostUserId') || null,
      snapshots: stored.get('snapshots') || [],
      chat: stored.get('chat') || []
    };
  }

  async fetch(request) {
    const url = new URL(request.url);
    const roomId = url.pathname.split('/')[3] || 'general';

    await this.initializeRoom(roomId);

    // If HTTP GET info
    if (url.pathname.endsWith('/info')) {
      return new Response(JSON.stringify({
        exists: true,
        isProtected: !!this.roomData.password,
        isReadOnly: this.roomData.isReadOnly,
        participantCount: this.sessions.size,
        language: this.roomData.language
      }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // WebSocket upgrade
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    // Accept WebSocket connection
    server.accept();

    const query = url.searchParams;
    const clientData = {
      userId: query.get('userId') || 'peer_' + Math.random().toString(36).substring(2, 8),
      userName: query.get('userName') || 'Anonymous',
      userColor: query.get('userColor') || '#8B7CFF',
      isHost: false,
      cursor: null
    };

    // Host assignment
    if (!this.roomData.hostUserId || this.sessions.size === 0) {
      this.roomData.hostUserId = clientData.userId;
      clientData.isHost = true;
    } else if (this.roomData.hostUserId === clientData.userId) {
      clientData.isHost = true;
    }

    this.sessions.set(server, clientData);

    // Send ROOM_INIT
    server.send(JSON.stringify({
      type: 'ROOM_INIT',
      roomId: this.roomData.id,
      code: this.roomData.code,
      language: this.roomData.language,
      version: this.roomData.version,
      isReadOnly: this.roomData.isReadOnly,
      isProtected: !!this.roomData.password,
      isHost: clientData.isHost,
      peers: Array.from(this.sessions.values()).map(c => ({
        userId: c.userId,
        userName: c.userName,
        userColor: c.userColor,
        isHost: c.isHost,
        cursor: c.cursor
      })),
      snapshots: this.roomData.snapshots,
      chat: this.roomData.chat
    }));

    // Broadcast PEER_JOIN
    this.broadcast(server, {
      type: 'PEER_JOIN',
      peer: {
        userId: clientData.userId,
        userName: clientData.userName,
        userColor: clientData.userColor,
        isHost: clientData.isHost
      }
    });

    server.addEventListener('message', async (event) => {
      try {
        const msg = JSON.parse(event.data);
        await this.handleMessage(server, clientData, msg);
      } catch (err) {
        console.warn('Error processing message:', err);
      }
    });

    server.addEventListener('close', () => {
      this.sessions.delete(server);
      this.broadcast(null, {
        type: 'PEER_LEAVE',
        userId: clientData.userId,
        userName: clientData.userName
      });
    });

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  broadcast(sender, messageObj) {
    const payload = JSON.stringify(messageObj);
    for (const [ws, _] of this.sessions.entries()) {
      if (ws !== sender) {
        try {
          ws.send(payload);
        } catch (e) {
          this.sessions.delete(ws);
        }
      }
    }
  }

  async handleMessage(ws, client, msg) {
    switch (msg.type) {
      case 'SYNC_DOC': {
        if (this.roomData.isReadOnly && !client.isHost) return;
        this.roomData.code = msg.code || '';
        this.roomData.version++;
        this.broadcast(ws, {
          type: 'DOC_UPDATED',
          code: this.roomData.code,
          version: this.roomData.version,
          userId: client.userId,
          userName: client.userName
        });
        // Debounced persistence to Cloudflare storage
        this.storage.put('code', this.roomData.code);
        this.storage.put('version', this.roomData.version);
        break;
      }

      case 'SET_LANGUAGE': {
        this.roomData.language = msg.language || 'javascript';
        this.broadcast(ws, {
          type: 'LANGUAGE_UPDATED',
          language: this.roomData.language,
          userId: client.userId
        });
        this.storage.put('language', this.roomData.language);
        break;
      }

      case 'CURSOR_MOVE': {
        client.cursor = { line: msg.line, col: msg.col, selection: msg.selection || null };
        this.broadcast(ws, {
          type: 'PEER_CURSOR',
          userId: client.userId,
          userName: client.userName,
          userColor: client.userColor,
          cursor: client.cursor
        });
        break;
      }

      case 'CHAT_MESSAGE': {
        const item = {
          id: 'msg_' + Date.now(),
          userId: client.userId,
          userName: client.userName,
          userColor: client.userColor,
          text: String(msg.text || '').substring(0, 1000),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        this.roomData.chat.push(item);
        if (this.roomData.chat.length > 100) this.roomData.chat.shift();
        this.broadcast(null, { type: 'NEW_CHAT_MESSAGE', message: item });
        this.storage.put('chat', this.roomData.chat);
        break;
      }

      case 'CREATE_SNAPSHOT': {
        const snap = {
          id: 'snap_' + Date.now(),
          title: msg.title || `Snapshot ${this.roomData.snapshots.length + 1}`,
          author: client.userName,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          date: new Date().toLocaleDateString(),
          code: this.roomData.code,
          lines: (this.roomData.code || '').split('\n').length
        };
        this.roomData.snapshots.unshift(snap);
        if (this.roomData.snapshots.length > 50) this.roomData.snapshots.pop();
        this.broadcast(null, { type: 'SNAPSHOT_SAVED', snapshot: snap });
        this.storage.put('snapshots', this.roomData.snapshots);
        break;
      }

      case 'TOGGLE_READ_ONLY': {
        if (client.isHost) {
          this.roomData.isReadOnly = !!msg.isReadOnly;
          this.broadcast(null, { type: 'ROOM_READ_ONLY_CHANGED', isReadOnly: this.roomData.isReadOnly });
          this.storage.put('isReadOnly', this.roomData.isReadOnly);
        }
        break;
      }

      case 'SET_PASSWORD': {
        if (client.isHost) {
          this.roomData.password = msg.password ? String(msg.password).trim() : null;
          this.broadcast(null, { type: 'ROOM_SECURITY_UPDATED', isProtected: !!this.roomData.password });
          this.storage.put('password', this.roomData.password);
        }
        break;
      }
    }
  }
}

