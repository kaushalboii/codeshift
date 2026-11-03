# ⚡ CodeShift
> *“Think together. Code without limits.”*

An instant, high-velocity real-time collaborative code editor built for developers. One link. Instant room. Zero signup.

---

## 🌟 Why CodeShift?

- **Zero-Friction Live Pairing**: Create or join any room in one second. No signups, no authentication walls.
- **Real-Time Keystroke & Cursor Sync**: Dual-channel peer synchronization engine (BroadcastChannel + LocalStorage + WebRTC ready) that propagates edits, cursor positions, and peer presence instantaneously.
- **In-Browser Execution & Console**: Run JavaScript/TypeScript with console interception, line timings, and return inspections.
- **Live HTML/CSS Sandbox**: Render web pages side-by-side in real-time with an interactive sandboxed DOM preview.
- **Shift Snapshots & Visual Diffs**: Checkpoint your code at any moment, inspect side-by-side color-coded additions/deletions (`+` / `-`), and roll back with one click.
- **Integrated Private Room Chat**: Discuss ideas, share snippets, and coordinate with audio-tactile notifications.
- **Multi-Language Support**: JavaScript, TypeScript, Python, HTML, CSS, Rust, Go, SQL, JSON, Markdown.
- **Developer First UI**: Dark mode with Electric Violet accents, customizable themes (Obsidian, Cyber Neon, Tokyo, Light), tab sizing, font sizing, and bracket auto-completion.

---

## 🎨 Brand Identity

The brand assets, logo files, and design system are located in the [`brand/`](./brand/) folder:
- **Horizontal Lockup**: [`brand/logo-full.svg`](./brand/logo-full.svg)
- **Standalone App Icon**: [`brand/logo-mark.svg`](./brand/logo-mark.svg)
- **Vector Favicon**: [`brand/favicon.svg`](./brand/favicon.svg)
- **Brand Guide & Palette**: [`brand/brand-guide.md`](./brand/brand-guide.md)

### Brand Colors:
- **Primary**: Electric Violet (`#8B7CFF`)
- **Accent**: Hyper Cyan (`#38BDF8`) & Neon Lilac (`#C084FC`)
- **Live Status**: Pulse Emerald (`#10B981`)
- **Canvas Base**: Obsidian (`#0D0E15`)
- **Surface**: Cyber Surface (`#13141E`)

---

## 🚀 Quick Start

CodeShift is designed with **zero external dependencies** — it runs immediately using native Node.js.

### 1. Launch the Server
```bash
npm start
# or
node server.js
```

### 2. Open in Browser
Open `http://localhost:3000`

### 3. Or Open Directly
You can also open `index.html` directly in any modern browser (`Chrome`, `Brave`, `Safari`, `Firefox`, `Edge`).

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `⌘ + Enter` / `Ctrl + Enter` | **Run Code** (Executes code & switches to Console/Preview) |
| `⌘ + S` / `Ctrl + S` | **Take Shift Snapshot** (Quick version checkpoint) |
| `Tab` | Indent with configured spaces (Default 2) |
| `Shift + Tab` | Unindent line |

---

## 🌐 Deployment Options

### Cloudflare Pages
1. Push to GitHub:
   ```bash
   git add .
   git commit -m "feat: initial CodeShift release"
   git push origin main
   ```
2. Connect repository to **Cloudflare Pages**.
3. Build command: *(leave empty)*
4. Build output directory: `.` (root)

### Vercel
Deploy with 1 command:
```bash
vercel --prod
```

### Static Hosting (Netlify / GitHub Pages)
Drop the directory contents into Netlify or enable GitHub Pages from `main` branch.

---

## 👥 Authors & License
Created by **Kaushal** for developers everywhere.  
Released under the [MIT License](./package.json).

