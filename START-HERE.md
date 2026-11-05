# MAS WALL — start here

A shared wall of assignments and presentations. Each poster shows its deadline, how many
days are left, the assignment brief, and a tickable requirement checklist.

**Viewing is open to anyone with the link. Editing is locked behind a class password.**
Tap a poster to read it, press **Edit**, enter the password (the board owner shares it
privately — it is not in this repo), and editing unlocks for that browser session. Press
the **LOCKED** button in the top bar to lock again.

## Live link (share this)

**https://mas.wavypremium.xyz:8443/** — served by the Node/SSE server on the VPS behind
Caddy (valid HTTPS certificate, HTTP/2). Works from any phone or laptop with no account.

Operations, backups and password rotation: [DEPLOY-VPS.md](DEPLOY-VPS.md).
The old GitHub Pages link redirects here.

## Run it locally (development)

```bash
node server.js
```

Requires Node 18+. Writes need the write-password hash in the environment:

```bash
WRITE_HASH=$(node -e "console.log(require('crypto').createHash('sha256').update('YOUR-PASSWORD').digest('hex'))") \
PORT=4321 node server.js
```

- This Mac: **http://localhost:4321**
- Same Wi-Fi: **http://<your-lan-ip>:4321** (the server prints the address)
- The local server keeps its state in `data/state.json` (seeded from `data/seed.json`).

## What you can do

1. **New poster** (or press `N`) — title, course, kind, work type, due date/time, weight,
   brief and requirements. Editing asks for the class password once.
2. **Drag** posters anywhere on the wall; the position is saved.
3. **Hold or drag** a poster to reveal the bin; drop it there to delete. Undo is in the toast.
4. **Agenda** (or `G`) shows the same deadlines as a list; tapping a row opens a read-only
   preview with an explicit **Edit** button.
5. **LIVE** badge = shared server state; every open device sees changes immediately.

## Where the content lives

- Production: `/opt/mas-wall/data/state.json` on the VPS, backed up hourly to
  `/var/backups/mas-wall/` and retained for 14 days.
- Local: `data/state.json` (delete it to reseed from `data/seed.json`).
- The old Supabase/Vercel setup (`DEPLOY-SUPABASE.md`, `supabase/`) is legacy and no
  longer used by the live board.

## Troubleshooting

- Page loads but editing says "wrong password" → the board password was rotated; ask the
  owner for the current one.
- Uploads/edits do nothing → check the top-right badge; if it is not **LIVE**, the server
  is unreachable.
- Local server refuses writes → `WRITE_HASH` was not set in the environment.
