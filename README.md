# Assembly Assistant

Personal business assistant for THE ASSEMBLY (Singapore).
A PWA — a web app that installs to your phone's home screen and works offline.

## Modules

| Phase | Module | Status |
|---|---|---|
| 1 | **Accountant** — income/expense log, client tags, monthly P&L, GST, Excel/CSV export | ✅ Built |
| 2 | Admin — tasks, deadlines, recurring reminders, contacts | Planned |
| 3 | Personal Assistant — daily agenda, meeting notes, follow-ups | Planned |
| 4 | Researcher — links/notes by topic, AI summaries | Planned |

## How to try it on this PC

Double-click `index.html` — it opens in Chrome and works immediately.
Your data is saved by Chrome on this computer (offline install only works once it's hosted online).

## How it gets to your phone (when you're happy with it)

1. We publish the folder to GitHub Pages (free) — Claude Code sets this up.
2. Open the link in Chrome on your Samsung.
3. Chrome menu (⋮) → **Add to Home screen** → **Install**.
4. It now opens full-screen like a normal app, works offline, and keeps data on your phone.

## Important: your data

- Everything is stored **only on the device you use it on** — nothing is sent anywhere.
- PC data and phone data are separate. Use **Export → Download backup** on one device and
  **Restore from file** on the other to move data across.
- Back up regularly (the app reminds you after 14 days). Backup files land in Downloads.

## Files

- `index.html`, `styles.css`, `app.js` — the app
- `sw.js`, `manifest.webmanifest`, `icons/` — what makes it installable + offline
- `vendor/xlsx.full.min.js` — Excel export library (SheetJS)
