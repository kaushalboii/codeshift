# ⚡ CodeShift — Real-Time Collaborative Code Sharing

> *"Think together. Code without limits — instant encrypted code sharing with zero friction."*

[![License: MIT](https://img.shields.io/badge/License-MIT-white.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Deploy](https://img.shields.io/badge/Live_Demo-GitHub_Pages-black.svg?style=flat-square&logo=github)](https://kaushalboii.github.io/codeshift/)
[![Monaco Editor](https://img.shields.io/badge/Engine-Monaco_VS_Code-blue.svg?style=flat-square)](https://microsoft.github.io/monaco-editor/)
[![Privacy](https://img.shields.io/badge/Privacy-Zero_Tracking-emerald.svg?style=flat-square)](#-privacy--security-guarantee)

---

## 🌐 Live Application

👉 **Try it Live**: [https://kaushalboii.github.io/codeshift/](https://kaushalboii.github.io/codeshift/)

![CodeShift Preview & Real-Time Sync Simulation](./brand/preview.svg)

---

## 🌟 What is CodeShift?

**CodeShift** is an open-source, high-performance real-time collaborative code editor. Anyone with a room URL can collaborate instantaneously — no accounts, no passwords, no email collection, and no tracking cookies.

All code edits are compressed client-side with LZW and encrypted locally in your browser before synchronization.

---

## ✨ Key Features

- **🚀 Zero Login Friction**: Open a room URL (e.g. `kaushalboii.github.io/codeshift/#/my-room`) and immediately start typing. No sign-up barriers.
- **🔒 Client-Side Payload Encryption**: Payloads are encrypted and compressed on the client before being sent across the wire. Cloud databases store only ciphertext.
- **👥 Live Collaborative Presence**:
  - Remote cursors with active line tinting and name tags (`[ Anonymous 17 ]`).
  - Peer synchronization via Firebase Realtime Database & local `BroadcastChannel`.
- **💻 Monaco Editor (VS Code Power)**:
  - Rich syntax highlighting for JavaScript, TypeScript, Python, HTML, CSS, Rust, Go, C++, SQL, and JSON.
  - Bracket matching, line numbers, word wrap, and customizable tab sizes.
- **🎨 Living 3D Teal Particle Wave Landing Page**: Interactive mathematical wave canvas reacting dynamically to mouse movement.
- **🖤 Minimal Black & White Aesthetics**: Clean monochrome buttons, gamified action controls, and modern dark-mode palettes.
- **🛡️ Built-in Privacy Policy Modal**: Absolute zero-tracking commitment with zero third-party analytics.

---

## 🔄 Live Simulation: How CodeShift Works

```
┌─────────────────────────────────┐               ┌─────────────────────────────────┐
│     User A (Browser Client)     │               │     User B (Browser Client)     │
│  "kaushalboii.github.io/.../#/" │               │  "kaushalboii.github.io/.../#/" │
└───────────────┬─────────────────┘               └─────────────────┬───────────────┘
                │                                                   │
     1. Type / Move Cursor                               3. Decrypt & Render Live
     2. LZW Compress + Encrypt Payload                   4. Update Monaco Editor
                │                                                   │
                ▼                                                   ▼
       [ Local Ciphertext ]                                [ Local Ciphertext ]
                │                                                   ▲
                └───────────────────┐           ┌───────────────────┘
                                    ▼           │
                         ┌───────────────────────────────┐
                         │   Firebase Realtime Database  │
                         │     (Zero-Knowledge Relay)    │
                         │                               │
                         │  • Stores solely ciphertext   │
                         │  • Ephemeral presence pings   │
                         │  • Sub-100ms global sync      │
                         └───────────────────────────────┘
```

1. **User A opens or creates a room**: Navigates to `kaushalboii.github.io/codeshift/#/room-name`.
2. **User A shares link with User B**: User B opens the exact same URL.
3. **Real-time Synchronization**:
   - Every keystroke is debounced, compressed, encrypted, and relayed to Firebase.
   - User B's screen automatically decrypts the payload and updates the Monaco editor document.
   - User B's cursor position is displayed on User A's editor with a live tag (`[ Anonymous 17 ]`) and active line tinting.

---

## 🌐 Custom Domain: How to Change the Domain in GitHub Pages

By default, GitHub Pages serves the site at:
```
https://kaushalboii.github.io/codeshift/
```

If you want a custom domain (like `codeshift.io`, `codeshift.dev`, or your own domain):

### Step 1: Purchase or Prepare Your Domain
Register your chosen domain through any registrar (e.g. Cloudflare, Namecheap, GoDaddy, Porkbun).

### Step 2: Configure DNS Records in Your Registrar
Add the following **DNS A Records** pointing to GitHub's official IP addresses:

| Type | Host / Name | Value / IP |
| :--- | :--- | :--- |
| **A** | `@` (root) | `185.199.108.153` |
| **A** | `@` (root) | `185.199.109.153` |
| **A** | `@` (root) | `185.199.110.153` |
| **A** | `@` (root) | `185.199.111.153` |

*If you prefer a subdomain (e.g., `code.yourdomain.com`), add a **CNAME** record pointing to `kaushalboii.github.io`.*

### Step 3: Enable Custom Domain in GitHub
1. Go to your repository on GitHub: `https://github.com/kaushalboii/codeshift`
2. Click **Settings** ⚙️ → **Pages** (in the left sidebar).
3. Under **Custom domain**, enter your domain name (e.g. `codeshift.io` or `code.yourdomain.com`).
4. Click **Save**. GitHub will automatically verify DNS and generate a free HTTPS certificate (Let's Encrypt).
5. Check **Enforce HTTPS**.

*(CodeShift's URL prefix in the landing page automatically adapts dynamically to whatever domain you use!)*

---

## 🔒 Privacy & Security Guarantee

- **No Cookies & Zero Trackers**: No Google Analytics, Meta Pixels, or third-party tracking scripts.
- **Zero Identification**: No accounts, usernames, passwords, or emails stored.
- **Encrypted Payloads**: Code buffers are encrypted before persistence.
- **100% Free & Open Source**: Full source code available under the MIT License for public auditing.

---

## 📁 Clean Repository Structure

```
codeshift/
├── index.html           # Single-Page Application (Landing + Monaco Editor + Modals)
├── styles.css           # Minimal Black & White typography, themes & animations
├── app.js               # Reactive router, Monaco setup, encryption & Firebase sync
├── 404.html             # GitHub Pages SPA hash routing redirect
├── package.json         # Static metadata and local serve scripts
├── README.md            # Comprehensive documentation & setup guide
├── brand/
│   ├── preview.svg      # Visual architecture & interface simulation banner
│   ├── logo-mark.svg    # Vector brand icon mark
│   ├── logo-full.svg    # Full vector wordmark
│   └── favicon.svg      # Site favicon
└── public/
    ├── preview.svg      # Static asset preview
    ├── logo.svg         # Public logo
    ├── favicon.svg      # Public favicon
    └── moon-poster.jpg  # Background aesthetic asset
```

---

## 💻 Local Development

Run CodeShift locally with any static HTTP server:

```bash
# Clone the repository
git clone https://github.com/kaushalboii/codeshift.git
cd codeshift

# Start a local static web server
npx serve -l 3000 .
```

Open `http://localhost:3000` in your browser.

---

## 📜 License & Attribution

Developed & maintained with 🤍 by **[Kaushal](https://github.com/kaushalboii)**.

Released under the [MIT License](https://opensource.org/licenses/MIT). Free for personal, commercial, and educational use.
