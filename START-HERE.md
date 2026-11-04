# MAS WALL — start here

A shared wall of assignments and presentations. Each poster shows its deadline, how many
days are left, the assignment brief, and a tickable requirement checklist.

**Viewing is open to anyone with the link. Editing is locked behind the class password
(`MAS200`).** Tap a poster to read it, press **Edit**, enter the password once per browser
session, and everything unlocks — add, drag, tick, delete. Press the **LOCKED** button in
the top bar to lock again.

## Live link (share this)

**https://mas.wavypremium.xyz:8443/** — runs on the VPS, works from any phone or laptop
with no account. **Editing password: `MAS200`.** Viewing is open; adding, dragging,
ticking and deleting prompt for the password once per browser session.
(The raw `https://89-125-244-178.sslip.io:8443/` address still works too.)

Operations, backups and password changes: [DEPLOY-VPS.md](DEPLOY-VPS.md). The old GitHub
Pages link now redirects here.

## Open it locally

- This Mac (local server mode): **http://localhost:4321**
- Same Wi-Fi (classmates): **http://192.168.31.50:4321** — the laptop must stay awake and
  the server running.
- Supabase mode preview: **http://localhost:4322** — the exact static build Vercel will
  host, talking to the real Supabase project. Also reachable on phones on the same Wi-Fi:
  **http://192.168.31.50:4322**.

## Try this first

1. Click **NEW POSTER** (or press `n`) to pin a card, then check its due date and
   requirements in the side panel. Set **Work** to *Group* or *Individual* — the poster
   shows it as a badge, and the **Brief** box is tall enough for the whole assignment prompt.
2. Drag a poster anywhere on the wall — position is saved. While you drag (or after
   holding a poster for ~half a second) a bin appears at the bottom: drop the poster on it
   to delete, and use **Undo** in the toast if it was a mistake.
3. Tap a poster (or an agenda row on your phone) to open it read-only — no keyboard pops
   up. Press **Edit** in the drawer when you actually want to change something, then tick
   requirements; the progress ring and "x/y done" update.
4. Open the same URL in a second browser window: everything syncs live.
5. Switch **WALL / AGENDA** (or press `g`) to see the same deadlines as a list.

## Make a permanent public link (free)

The shareable version is a static site on Vercel plus Supabase, so it keeps working after
your laptop sleeps. **The Supabase project is already created, seeded and wired into
[public/supabase-config.json](public/supabase-config.json)** — the only step left is
putting the static site on Vercel:

1. Push this folder to GitHub (or run `npx vercel --prod` from here).
2. Vercel → import the repo → preset **Other**, output directory `public`, no build
   command, no env vars → Deploy.
3. Open the URL, tick a requirement in two windows and confirm it syncs in ~1 s.

If you ever need to rebuild the database from scratch: Supabase → SQL Editor → run
[supabase/schema.sql](supabase/schema.sql), then [supabase/seed.sql](supabase/seed.sql),
then paste the Project URL + anon key into `public/supabase-config.json`.

Full click-path, screenshots-worth of detail and troubleshooting:
[DEPLOY-SUPABASE.md](DEPLOY-SUPABASE.md).

The same client auto-detects the mode: Node API if present → live SSE; otherwise Supabase
→ realtime websockets + presence; otherwise offline cache.

## Where the content lives

- Local server mode: `data/seed.json` is the starter content; `data/state.json` is the live
  board (created on first boot, gitignored). Reset = stop server, delete `data/state.json`,
  start again.
- Supabase mode: content lives in the `cards` and `board` tables. Restore demo content by
  re-running `supabase/seed.sql`.
- Everything is editable in the UI — no code changes needed to swap in your real MAS
  assignments, dates, weights and requirements.

## Heads-up: the link is writable by anyone

There is no login by design. Anyone with the link can add, edit or delete posters. Share
it with your cohort deliberately; keep a copy of the seed data if you want an easy restore.

## File map

| Path | What |
| --- | --- |
| `public/` | the whole frontend (HTML, CSS, app.js, fonts) |
| `server.js` | zero-dependency local Node server: static files, JSON API, SSE, disk state |
| `data/seed.json` | starter content (8 sample MAS posters) |
| `supabase/schema.sql` | database tables, RLS and realtime setup |
| `supabase/seed.sql` | the same 8 sample posters as SQL |
| `DEPLOY-SUPABASE.md` | permanent public link, step by step |
| `README.md` | local server details, API, troubleshooting |

## If something looks wrong

- Page blank → is `node server.js` running? Check http://localhost:4321/api/health.
- Classmates can't open the Wi-Fi link → same network? macOS firewall allowing `node`?
- Supabase mode shows no posters → schema/seed not run, or config URL/key wrong.
- Edits not syncing → check the badge top-right: LIVE (SSE) / POLLING / OFFLINE.
