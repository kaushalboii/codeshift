# ⚡ CodeShare — Instant Real-Time Code Sharing

> *"Simple, seamless code sharing with live auto-save and multi-device sync — no signup or login required."*

---

## 🌟 Features

- **No Signup, Instant Access**: Create or join any room in one second. Share the URL with anyone to collaborate instantly.
- **Mesh-Type Modern UI**: Dark, distraction-free drafting canvas with subtle ambient mesh gradients and high-contrast JetBrains Mono typography.
- **Automatic Auto-Save**: Keystrokes are automatically debounced and saved in real-time, accompanied by a visual indicator (`● Saved` / `● Saving...`).
- **Seamless Multi-Device Sync**:
  - What User A types, User B sees live on their screen.
  - What User B types, User A sees live on their screen.
  - Opening the link on any other computer, tablet, or phone immediately loads the latest auto-saved code.
- **Monaco Editor Engine (VS Code)**: Full syntax highlighting, line numbers, bracket matching, code folding, and multi-language support (JavaScript, Python, HTML/CSS, TypeScript, C++, Rust, Go, SQL, JSON, Markdown).
- **1-Click Link Sharing**: Click "Share Link" to copy the room URL to your clipboard.

---

## 🏗️ Architecture: Clean Frontend & Backend Separation

CodeShare is cleanly separated into a client-side frontend and flexible backend options:

```
┌──────────────────────────────────────────────────────────────┐
│                    FRONTEND CLIENT (SPA)                     │
│  • index.html, styles.css, app.js                            │
│  • Deployed on GitHub Pages: https://kaushalboii.github.io/codeshift │
│  • Zero-login, instant room URL: /#/room-123                 │
└──────────────────────────────┬───────────────────────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
┌───────────────────────────────┐   ┌───────────────────────────┐
│     OPTION 1: FIREBASE RTDB   │   │  OPTION 2: NODE.JS SERVER │
│   (Serverless Cloud Database) │   │        (server.js)        │
├───────────────────────────────┤   ├───────────────────────────┤
│ • Free client-side cloud sync │   │ • Native RFC 6455 WebSockets│
│ • Runs directly on GitHub Pages│   │ • In-memory room manager  │
│ • Zero backend hosting needed │   │ • Saves to .data/rooms.json│
│ • WebSockets built into SDK   │   │ • Run with 'npm start'    │
└───────────────────────────────┘   └───────────────────────────┘
```

---

## 💾 Which Database Should You Use? (Firebase vs Node Backend)

You asked: *"the db we can use the firebase naa that will be easy or which one can we use for now ??"*

### ✅ Recommended for GitHub Pages: **Firebase Realtime Database**
Because GitHub Pages is a static web host, it **cannot** run Node.js backend servers. **Firebase Realtime Database** is the best and easiest solution:
1. **100% Free**: Firebase's Spark plan provides free real-time database hosting with up to 100 simultaneous active connections.
2. **Zero Backend to Maintain**: The frontend connects directly to Firebase over WebSockets. No need to deploy or pay for cloud servers.
3. **Instant Cross-Device Sync**: Any keystroke auto-saves to Firebase in milliseconds. Opening the room URL on another computer loads the code immediately.

#### 1-Minute Free Firebase Setup:
1. Open [console.firebase.google.com](https://console.firebase.google.com) and click **Create a project**.
2. In the left menu, click **Build** → **Realtime Database** → **Create Database**.
3. Choose a region and select **Start in test mode** (allows open read/write without login).
4. Copy your Database URL:
   `https://<your-project-id>-default-rtdb.firebaseio.com`
5. In CodeShare, click **☁️ Cloud Sync** in the top bar and paste your URL.
   *(You can also share it in the URL: `https://kaushalboii.github.io/codeshift/#/my-room?fb=https://your-project.firebaseio.com`)*.

---

### 🖥️ Alternative: Self-Hosted Node.js Server (`server.js`)
If you want to run your own backend on localhost, a VPS, or Render:

```bash
# Start the local backend server
npm start
# or
node server.js
```
The server will start on port `3000` with native WebSockets and persist rooms locally in `.data/rooms.json`.

---

## 🚀 Quick Start

1. Open `index.html` in your browser or visit [kaushalboii.github.io/codeshift](https://kaushalboii.github.io/codeshift/).
2. A new instant room is created automatically (e.g. `/#/dev-3x8f`).
3. Type or paste your code. Notice the `● Saved` indicator.
4. Click **Share Link** and open it on another device or send it to a friend.
5. Both screens sync in real-time as you type!

---

## 👥 License & Credits
Created by **Kaushal**. Released under the [MIT License](./package.json).
