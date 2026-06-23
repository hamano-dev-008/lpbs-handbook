# LPBS Aktiviti Harian

A Malay-language progressive web app for Lembaga Padi dan Beras Sabah (LPBS). It displays
official activities/events and manages staff attendance, tasks, and meeting minutes for the
organization. There is no build system — this is a static site you can open or deploy as-is.

## Files

- `index.html` — the entire app (~5,100 lines): inline `<style>` block followed by one
  `<script>` block. This is the file to edit for almost any change.
- `update.html` — an older/parallel copy of the app (~2,850 lines). Treat `index.html` as the
  source of truth unless told otherwise.
- `manifest.json` — PWA manifest (app name "LPBS Aktiviti Viewer", blue theme `#1B3A6B`).
- `sw.js` — minimal network-first service worker.
- `icons/` — PWA icons and the animated paddy header video.

No `package.json`, no npm dependencies, no build/test/lint commands. Deployment is just pushing
the static files to any web host.

## Architecture & data flow

The app talks directly to Google APIs from the browser using OAuth2 (Google Sign-In) — there is
no backend server.

- **Google Calendar API v3** — source of truth for activities/events (month/day/range views).
- **Google Sheets API v4** — backs everything else:
  - `Senarai` sheet — staff allowlist + staff directory (name, position).
  - `Kehadiran` sheet — attendance records.
  - `Tugasan` sheet — tasks, staff tagging.
  - `Dibaca` sheet — notification read/unread state.

Config constants (`GOOGLE_CLIENT_ID`, `CALENDAR_ID`, `*_SHEET_ID`, `*_SHEET_RANGE`) live near the
top of the `<script>` block (~line 2284 in `index.html`). These are real, in-use production IDs
hardcoded in the file — don't regenerate or repoint them without confirming with the user, since
doing so changes which live Calendar/Sheets the deployed app reads and writes.

## Access control

There is a Sheet-backed general allowlist (loaded at sign-in via `loadAllowlistFromSheet`) with
hardcoded fallback lists (`FALLBACK_EDITOR_ALLOWLIST`, `FALLBACK_VIEW_ONLY_ALLOWLIST`) used only
if the Sheet fails to load. On top of that, three separate feature-specific editor allowlists
gate write access:

- `KEHADIRAN_EDITOR_ALLOWLIST` — who can edit attendance records.
- `MINIT_EDITOR_ALLOWLIST` — who can generate Minit Mesyuarat (meeting minutes).
- `TASK_EDITOR_ALLOWLIST` — who can manage Tugasan (tasks).

These lists gate write access to real organizational data and document generation for real staff
— treat edits to them as access-control changes, not routine config.

## Code layout inside the `<script>` block (in order)

1. Konfigurasi (OAuth/Calendar/Sheets config)
2. Akses Kawalan (allowlists, staff lookup, permissions)
3. Kehadiran (attendance: CRUD + PDF export)
4. Minit Mesyuarat (meeting minutes → .docx)
5. Tugasan/Tasks (task management, staff tagging, Sheet-backed notifications)
6. Notifications (read/unread tracking)
7. Calendar events (display/edit/delete activities)
8. View rendering (month/day/range views)
9. Authentication (Google Sign-In init, token management)

Section-header comments mark each region — use those to navigate rather than line numbers, since
line numbers shift as the file grows.

## Conventions

- Domain-specific functions use Malay names (`loadKehadiranFromSheet`, `renderKehadiranTable`,
  `generateMinitDocx`); generic helpers use English (`escapeHtml`, `fmtHours`, `fmtKey`).
- Config constants are UPPERCASE; CSS classes are kebab-case; state variables are camelCase.
- Comments are minimal — mostly section headers. Don't add verbose comments to match nonexistent
  conventions; follow the existing sparse style.
- No framework: direct DOM manipulation, template literals for HTML generation, `fetch()` with
  Bearer tokens for all Google API calls.

## External libraries (CDN only, no npm)

- Google Sign-In client (`accounts.google.com/gsi/client`)
- jsPDF + jspdf-autotable — PDF export
- `docx` via esm.sh — Minit Mesyuarat (.docx) generation
- Google Fonts (Inter, Space Grotesk)

## Cautions

- This app is actively used by a real organization (frequent recent commits, real staff emails in
  allowlists). Be conservative with changes to Sheet IDs, Calendar ID, or any allowlist.
- Don't add `.env` files or service-account credentials to the repo — none exist today, keep it
  that way. Client-side OAuth client IDs being visible in `index.html` is expected/intentional,
  not a leak to fix.
