# CodeShift — Brand Identity System & Design Guidelines
*“Think together. Code without limits.”*

---

## 1. Brand Narrative & Origin
**CodeShift** was conceived as a high-velocity, frictionless collaborative coding environment for modern developers. 
- **The “Shift” Philosophy**: 
  - Shifting paradigms from static snippet pasting to live, synchronized flow states.
  - The developer’s quintessential modifier key (`⇧ Shift`) — unlocking symbols, brackets, and uppercase power.
  - A subtle, organic tribute to **Kaushal** (K-Shift ➔ CodeShift) without being literal or personal brand-locked.
- **Brand Character**: Fast, minimal, developer-native, electric, and reliable.

---

## 2. Logo Design & Symbolism

### Mark Breakdown:
The CodeShift glyph combines three essential programming motifs into a unified, high-energy icon:
1. **The Code Terminals (`<` and `>`):** Representing code, syntax, and raw development power.
2. **The Shift Chevron (`⇧`):** Rising centrally between the brackets, symbolizing elevation, velocity, and seamless real-time syncing.
3. **The Core Anchor:** A crisp focal node signifying the shared room where developers meet and build together.

### Variations:
- `brand/logo-full.svg`: Primary horizontal lockup (Icon + Wordmark + Live status indicator).
- `brand/logo-mark.svg`: Standalone squircle app icon for mobile, desktop docks, and avatars.
- `brand/favicon.svg`: Ultra-crisp 64x64 vector favicon for tabs and bookmarks.

---

## 3. Color Architecture

| Token | Hex | Name | Application |
|---|---|---|---|
| `--cs-primary` | `#8B7CFF` | **Electric Violet** | Hero accents, primary buttons, active cursor highlight |
| `--cs-accent-cyan`| `#38BDF8` | **Hyper Cyan** | Real-time indicators, selection gradients, secondary actions |
| `--cs-accent-pink`| `#C084FC` | **Neon Lilac** | Gradient midpoints, subtle glow highlights |
| `--cs-live` | `#10B981` | **Pulse Emerald** | Live status badges, peer connection indicators |
| `--cs-bg` | `#0E0F16` | **Obsidian Base** | Global background canvas |
| `--cs-surface` | `#161722` | **Cyber Surface** | Editor chrome, sidebars, modals, floating panels |
| `--cs-surface-hover` | `#1E1F2E` | **Elevated Surface**| Button hovers, active tabs, list selections |
| `--cs-border` | `#252738` | **Steel Border** | Panel dividers, input borders |
| `--cs-border-glow` | `rgba(139, 124, 255, 0.25)` | **Violet Edge** | Focus states, active room border glow |
| `--cs-text-high` | `#F8FAFC` | **Primary Text** | Headings, code foreground, active labels |
| `--cs-text-muted`| `#94A3B8` | **Muted Slate** | Subtitles, line numbers, timestamps |

---

## 4. Typography
- **Brand & UI Font**: `Inter`, `-apple-system`, `BlinkMacSystemFont`, `sans-serif`
  - High legibility at small sizes, neutral geometry.
- **Code & Editor Font**: `JetBrains Mono`, `Fira Code`, `Consolas`, `monospace`
  - Clean ligatures, distinct `0` vs `O` and `1` vs `l`, optimal spacing for long pairing sessions.

---

## 5. Taglines & Positioning
- **Primary Hero**: *“Think together. Code without limits.”*
- **Sub-tagline**: *“A real-time collaborative code space. Zero friction, zero signup required.”*
- **Micro-copy**:
  - *“One link. Instant room. Live sync.”*
  - *“Shift your pairing into overdrive.”*
  - *“Built for developers who value speed.”*

---

## 6. Product Architecture
- **Room URL Pattern**: `https://codeshift.dev/room/[unique-slug]` or `codeshift.pages.dev/#/room/[slug]`
- **Peer Presence**: Color-coded cursor tags (e.g. Violet, Cyan, Amber, Rose) with host badges.
- **Ephemeral & Secure**: Instant live synchronization, local snapshot persistence, client-side execution sandbox.

