# ⚡ CodeShift
> *“Think together. Code without limits.”*

An instant, high-velocity real-time collaborative code editor built for developers. One link. Instant room. Zero signup.

---

## 🌟 Why CodeShift?

- **Zero-Friction Live Pairing**: Create or join any room in one second. No signups, no authentication walls.
- **Real-Time Keystroke & Cursor Sync**: Dual-channel peer synchronization engine (WebSockets + BroadcastChannel fallback) that propagates edits, cursor positions, and peer presence instantaneously.
- **In-Browser Execution & Console**: Run JavaScript/TypeScript with console interception, line timings, and return inspections.
- **Live HTML/CSS Sandbox**: Render web pages side-by-side in real-time with an interactive sandboxed DOM preview.
- **Shift Snapshots & Visual Diffs**: Checkpoint your code at any moment, inspect side-by-side color-coded additions/deletions (`+` / `-`), and roll back with one click.
- **Integrated Private Room Chat**: Discuss ideas, share snippets, and coordinate with audio-tactile notifications.
- **Multi-Language Support**: JavaScript, TypeScript, Python, HTML, CSS, Rust, Go, SQL, JSON, Markdown.
- **Developer First UI**: Dark mode with Electric Violet accents, customizable themes (Obsidian, Cyber Neon, Tokyo, Light), tab sizing, font sizing, and bracket auto-completion.

---

## 🏗️ System Architecture: Frontend, Backend & Database

CodeShift is designed with a decoupled, edge-ready architecture:

```
┌────────────────────────────────────────────────────────┐
│               FRONTEND CLIENT (SPA)                    │
│   • GitHub Pages / Cloudflare Pages / Vercel / Local   │
│   • Monaco Editor (VS Code Engine)                     │
│   • Reactive UI & In-Browser Code Runners              │
└────────────────────────┬───────────────────────────────┘
                         │
        WebSocket / wss: │ /ws/room/:roomId
                         ▼
┌────────────────────────────────────────────────────────┐
│                  BACKEND OPTIONS                       │
├────────────────────────────┬───────────────────────────┤
│    Option A: Node.js       │ Option B: Cloudflare Edge │
│        (server.js)         │      (worker/index.js)    │
│  • RFC 6455 WebSocket      │ • Cloudflare Worker       │
│  • Self-contained server   │ • Durable Objects         │
│  • In-memory room manager  │ • Low-latency global edge │
└─────────────┬──────────────┴─────────────┬─────────────┘
              │                            │
              ▼                            ▼
┌────────────────────────────┐┌──────────────────────────┐
│   LOCAL PERSISTENCE STORE  ││ CLOUDFLARE EDGE STORAGE  │
│   • .data/rooms.json       ││ • DO Transactional Store │
│   • Auto-saves snapshots,  ││ • D1 Database (SQLite)   │
│     code & chat states     ││   via schema.sql         │
└────────────────────────────┘└──────────────────────────┘
```

### 1. The Frontend (GitHub Pages)
- **What it is**: GitHub Pages is a **static web host**. It delivers HTML, CSS, JavaScript (`app.js`), icons, and brand graphics.
- **Limitation**: GitHub Pages cannot execute server-side Node.js or maintain open TCP WebSocket servers.
- **How collaboration works**:
  - **Local/Demo Mode**: If opened without a backend server configured, CodeShift uses the browser's native `BroadcastChannel` API to sync across tabs on the same computer.
  - **Global Internet Mode**: CodeShift connects via `wss://` to your deployed WebSocket backend (configured via the Preferences modal or appended to share links via `?server=wss://...`).

### 2. The Backend & Real-Time WebSockets
CodeShift provides two backend implementations:

1. **Node.js Native Server (`server.js`)**:
   - Zero external dependencies using native Node.js HTTP and RFC 6455 WebSocket protocol.
   - Manages active client sockets, broadcasts edits, cursors, chat messages, and snapshots.
   - Can be run locally (`node server.js`) or deployed to any free cloud host (Render, Railway, Fly.io, VPS).

2. **Cloudflare Worker + Durable Objects (`worker/index.js`)**:
   - Serverless edge architecture running on Cloudflare's global CDN.
   - Each room is backed by a stateful **Durable Object** (`CodeShiftRoom`) ensuring instant peer discovery and document synchronization globally.

### 3. How the Backend Links to the Database
- **In Node.js (`server.js`)**: The server persists active rooms, snapshots, code documents, and chat history locally in `.data/rooms.json` with automatic debounced saving.
- **In Cloudflare Worker (`worker/index.js`)**: 
  - Each Durable Object has persistent transactional storage (`this.storage.put(...)`) storing code, snapshots, and permissions directly at the edge.
  - The included [`schema.sql`](./schema.sql) defines Cloudflare D1 (serverless SQLite) tables (`rooms` and `snapshots`) for global room indexing and analytics.

---

## 🎨 Brand Identity

Brand assets and design system:
- **Horizontal Lockup**: [`brand/logo-full.svg`](./brand/logo-full.svg)
- **Standalone App Icon**: [`brand/logo-mark.svg`](./brand/logo-mark.svg)
- **Vector Favicon**: [`brand/favicon.svg`](./brand/favicon.svg)
- **Brand Guide & Palette**: [`brand/brand-guide.md`](./brand/brand-guide.md)

---

## 🚀 Quick Start (Local)

CodeShift is designed with **zero external dependencies** — it runs immediately using native Node.js.

### 1. Launch the Server
```bash
npm start
# or
node server.js
```

### 2. Open in Browser
Open `http://localhost:3000`

---

## 🌐 Deploying to GitHub Pages

### 1-Click Fix for GitHub Pages Workflow:
1. In your GitHub repository, click **Settings** (top navigation).
2. In the left sidebar under *Code and automation*, click **Pages**.
3. Under **Build and deployment** → **Source**:
   - Select **GitHub Actions** (or select **Deploy from a branch** → `gh-pages` / `/root`).
4. Re-run the deployment workflow in the **Actions** tab.

### Linking your GitHub Pages Frontend to a Live Backend:
1. Deploy `worker/index.js` to Cloudflare Workers (`npx wrangler deploy`) or `server.js` to Render.
2. In your CodeShift app on GitHub Pages, click **⚙️ Preferences** (or the connection pill in the header).
3. Paste your backend URL into **Backend WebSocket Server** (e.g. `wss://codeshift-api.onrender.com`).
4. When you copy a room invite link, the server address is automatically included for your collaborators!

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `⌘ + Enter` / `Ctrl + Enter` | **Run Code** (Executes code & switches to Console/Preview) |
| `⌘ + S` / `Ctrl + S` | **Take Shift Snapshot** (Quick version checkpoint) |
| `Tab` | Indent with configured spaces (Default 2) |
| `Shift + Tab` | Unindent line |

---

## 👥 Authors & License
Created by **Kaushal** for developers everywhere.  
Released under the [MIT License](./package.json).
