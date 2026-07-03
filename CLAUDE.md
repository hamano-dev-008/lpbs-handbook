# LPBS Aktiviti Harian

A Malay-language progressive web app for Lembaga Padi dan Beras Sabah (LPBS), a Sabah state
government agency. It displays official activities/events and manages staff attendance, tasks,
and meeting minutes for the organization. There is no build system — this is a static site you
can open or deploy as-is.

- **Live URL:** https://hamano-dev-008.github.io/lpbs-handbook/
- **Repo:** hamano-dev-008/lpbs-handbook (GitHub Pages auto-redeploys from `main` root within
  about a minute of a push — `git add . && git commit && git push` is the entire deploy step).

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

**Google Cloud Console project:** "LPBS Aktiviti Viewer". The OAuth consent screen is in
**Testing** mode (not published/verified) — only emails explicitly added as "Test users" there
can sign in at all, *before* the app's own allowlist check even runs. Onboarding a new staff
member therefore takes **two steps**: (1) Google Cloud Console → OAuth consent screen → Audience
→ Test users, AND (2) the relevant allowlist (Sheet or hardcoded).

## Access control

There is a Sheet-backed general allowlist (loaded fresh at every sign-in via
`loadAllowlistFromSheet`) with hardcoded fallback lists (`FALLBACK_EDITOR_ALLOWLIST`,
`FALLBACK_VIEW_ONLY_ALLOWLIST`) used only if the Sheet fails to load — the fallback exists so a
Sheet outage doesn't lock everyone out; keep it roughly in sync with the real Sheet when asked.
Editor implies viewer (`isAllowedViewer`/`isAllowedEditor`). On top of that, three separate
feature-specific editor allowlists gate write access:

- `KEHADIRAN_EDITOR_ALLOWLIST` — who can edit attendance records (all staff can self check-in;
  these editors additionally get the admin view).
- `MINIT_EDITOR_ALLOWLIST` — who can generate Minit Mesyuarat (meeting minutes).
- `TASK_EDITOR_ALLOWLIST` — who can manage Tugasan (tasks).

These lists gate write access to real organizational data and document generation for real staff
— treat edits to them as access-control changes, not routine config. The Sheet-driven general
allowlist and the hardcoded feature allowlists are genuinely independent systems; don't assume
one config governs the other.

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

## Calendar event data model

Google Calendar events are parsed into an internal shape via `googleEventToInternal()`:

- **Category** comes from a `[TAG]` prefix in the event **title**, e.g. `[MESYUARAT] Mesyuarat
  Pengurusan...`. Recognized tags: MESYUARAT, PROGRAM, MAJLIS, TAKLIMAT, SESI LIBAT URUS
  (normalized internally to "SESI"), KURSUS, PERJALANAN. Untagged titles default to "MESYUARAT"
  with no visual warning — a known minor gap (some staff add events without tags).
- **VIP/Urus Setia/Kehadiran/Pakaian** are parsed from `Label: value` lines in the event
  **description** (`parseDescriptionFields()`); `buildEventDescription()` writes the same format
  back so create/edit round-trips correctly.
- **Protocol level** (`vvip` / `vip` / null) drives a colored left-border on event cards
  (red/amber/none) — the most important at-a-glance signal for the General Manager who uses
  this app.

## Kehadiran specifics

- Sheet columns are `Tarikh, Nama, Masa Masuk, Masa Keluar` (date first — deliberately changed
  from an earlier `Nama, Tarikh, ...` order; read/write code uses `[tarikh, nama, masuk, keluar]`
  array order to match).
- One entry per staff member per day is enforced client-side only (UI guard, not a real
  constraint against direct Sheet edits).
- `calcHours()` handles overnight shifts (if keluar < masuk, adds 24h).
- Deleting a row calls Sheets API `:clear` on that row's range — not a true row delete; keeps
  row indices stable, leaves a blank row.
- Has its own PDF export (`generateKehadiranPDF()`), separate from the Aktiviti Cetak export.

## Known fragile spots

1. **`fmtKey()` must use local date components, not `toISOString()`.** `toISOString()` converts
   to UTC; for Malaysia (UTC+8) local midnight shifts to the previous day, showing the wrong
   day's events. This was a real bug — don't "simplify" it back.
2. **Click propagation inside cards.** Event/card containers have an `onclick` to toggle
   expand/collapse; any interactive element added inside one needs `stopPropagation()` (the
   inline edit form's `.edit-form` container carries `onclick="event.stopPropagation()"` for
   this reason — clicking a `<select>` once collapsed the card).
3. **OAuth scope changes need Cloud Console updates too.** The scope was already upgraded once
   (`spreadsheets.readonly` → `spreadsheets`). A new scope must also be registered in Google
   Cloud Console → OAuth consent screen → Data Access, or real users get tokens silently missing
   the permission (manifests as confusing 401s, not an obvious error).
4. **Delete-event uses a 10-second Undo toast**: the card hides optimistically and the real
   `events.delete` call only fires if the countdown completes without Undo.
5. **No automated test suite.** Verification during development used throwaway Node.js `jsdom`
   scripts mocking `fetch()`/`window.google` — nothing is checked in to run.
6. **`wkhtmltoimage`** (used for dev screenshots) does not render CSS Grid or some flexbox
   correctly — verify apparent layout bugs in a real browser before trusting its output.

## Conventions

- Domain-specific functions use Malay names (`loadKehadiranFromSheet`, `renderKehadiranTable`,
  `generateMinitDocx`); generic helpers use English (`escapeHtml`, `fmtHours`, `fmtKey`).
- Config constants are UPPERCASE; CSS classes are kebab-case; state variables are camelCase.
- Comments are minimal — mostly section headers. Don't add verbose comments to match nonexistent
  conventions; follow the existing sparse style.
- No framework: direct DOM manipulation, template literals for HTML generation, `fetch()` with
  Bearer tokens for all Google API calls.
- Icons are inlined raw `<svg>` markup (Solar icon set + Material Symbols), not an icon font or
  CDN script — deliberate, to avoid extra network dependencies.
- Mobile-first design: bottom tab bar navigation (`switchSection(name)` toggles `<div>` sections
  inside one `#mainApp` container via inline display, not routes). Check the current
  `index.html` for what's actually live rather than assuming past experiments survived.

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
- The Calendar/Sheet IDs point at a real government agency's live data — don't paste them into
  public places, don't remove access-control logic around them, and don't widen access without
  being asked.

## Ideas considered and rejected (don't re-propose without new information)

- **Native app rewrite (React Native/Expo):** rejected — the PWA covers real needs; revisit only
  if push notifications become a real user ask.
- **Capacitor-wrapped native build (.apk/.ipa):** discussed as a middle path if a downloadable
  installer is ever wanted, not started.
- **GPS-based location-restricted check-in for Kehadiran:** rejected — GPS is imprecise indoors
  and easily spoofed; not worth it for a trust-based internal tool.
