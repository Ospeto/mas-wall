# MAS WALL

A collaborative poster wall for a Master's cohort. Everyone on the same Wi-Fi opens the
same URL, pins assignments to a shared canvas, ticks off requirements, and sees changes
live. No accounts, no build step, no dependencies.

## Requirements

Node.js 18 or newer. The server uses only built-in Node modules (`http`, `fs`, `os`,
`path`, `crypto`); there is nothing to install.

## Run it

From the project root, either command works (`npm start` runs the same file):

```bash
node server.js
npm start
```

The server listens on port 4321 and prints:

```text
MAS WALL
  Local    http://localhost:4321
  Wi-Fi    http://192.168.1.42:4321   <- share this with classmates
```

The Wi-Fi address is your machine's real LAN IP. To use a different port:

```bash
PORT=4399 node server.js
```

The server binds `0.0.0.0` so other devices can reach it; `HOST=127.0.0.1` keeps it
local-only, but breaks Wi-Fi sharing. All paths resolve from the server file's own
directory, so any working directory is fine:

```bash
node "/path/to/Assignment Dashboard/server.js"
```

## Share it on Wi-Fi

Everyone on the same network opens the Wi-Fi URL from the boot banner. Edits sync live
over Server-Sent Events. There is nothing to install and no accounts to create.

If it does not load for a classmate:

- Confirm both devices are on the same network, not one on a guest network or hotspot.
- On macOS, allow incoming connections for `node` in System Settings > Network > Firewall.
- Disable VPNs on both devices; make sure the URL uses the LAN IP, not `localhost`.

Reaching people outside the room: see [Public link without a host](#public-link-without-a-host).

## Where your data lives

`data/seed.json` is the checked-in starter content. On first boot the server copies it
to `data/state.json` next to `server.js`; after that, that file is the live state and is
gitignored.

- Reset: stop the server, delete `data/state.json`, start again.
- Change the starter content permanently: edit `data/seed.json`, or edit in the UI and
  copy the resulting `state.json` content into `seed.json`.
- Writes are atomic (temp file plus rename), debounced 250 ms, and flushed on Ctrl-C or
  SIGTERM.

## API

JSON in, JSON out. Failures return `{ok:false, error:"message"}`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/state` | Full state: `{rev, course, cards}` |
| GET | `/api/health` | Health and counts: `{ok, rev, cards, clients}` |
| GET | `/api/events` | SSE stream: `hello` event, then `card.upsert`, `card.delete`, `course.update`, `presence`; heartbeat comment every 20 s |
| POST | `/api/op` | One operation: `card.upsert` (card object), `card.delete` (id), or `course.update` (course object). Returns `{ok:true, rev}` |
| POST | `/api/presence` | Publish a user object `{id, name, color, x, y, cardId}`. Returns 204 |

Add a card:

```bash
curl -X POST http://localhost:4321/api/op \
  -H 'content-type: application/json' \
  -d '{"op": "card.upsert", "card": {
    "title": "Seminar presentation",
    "type": "presentation",
    "course": "MAS 601",
    "due": "2026-11-09T23:59:00+06:30",
    "x": 120, "y": 160, "w": 340, "color": "bone",
    "requirements": [{"id": "r1", "text": "12 min talk", "done": false}]
  }}'
```

The server generates an id when you omit one.

### Limits

- 400 cards maximum; title up to 200 characters; brief and notes up to 4000 each.
- Requirement text up to 200 characters, at most 40 requirements per card.
- Request bodies capped at 1.5 MB (`413` beyond that); malformed JSON gets `400`.

## No auth, by design

Anyone with the link can add, edit, move and delete posters — that is the product, not a
bug. On a trusted classroom Wi-Fi that is fine. On the open internet treat the link as a
shared editable document: share it deliberately, and restore demo content by re-running
`supabase/seed.sql` (Supabase mode) or deleting `data/state.json` (local mode). Put it
behind a VPN or a password-protected proxy if you need stricter access.

## Deploy

Any host that runs `node server.js` and reads `PORT` works: Render, Railway, Fly.io, or
a plain VPS, with no build or install step.

Ephemeral disk caveat: on most free and standard web-service tiers the filesystem resets
on deploy or restart, so `data/state.json` is lost. Mount a persistent volume at
`data/` (Fly volumes, Railway volumes, Render disks) to keep state. Otherwise treat the
deployment as a demo that reseeds from `data/seed.json`.

### Permanent free link: Vercel + Supabase

The recommended way to share outside the room is the static build in `public/` with
Supabase as the database and realtime layer. No Node server to host, no laptop to keep
awake, and state survives deploys. Step-by-step: [DEPLOY-SUPABASE.md](DEPLOY-SUPABASE.md).
The same client auto-detects the mode; local server mode above still works unchanged.

## Public link without a host

Tunnel a local instance:

```bash
cloudflared tunnel --url http://localhost:4321
```

or:

```bash
npx localtunnel --port 4321
```

Both print a public URL that changes each run, and SSE works through both. Anyone with
the URL can edit, so share deliberately.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `EADDRINUSE` on start | Port 4321 is taken. Run `PORT=4399 node server.js`. |
| Blank page | `public/` is missing or incomplete; check the terminal for 404s. |
| Stale content after editing `data/seed.json` | Stop the server, delete `data/state.json`, start again. |
| Other devices stop updating | Check the `clients` count at `/api/health`; a proxy may be buffering SSE. |

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4321` | HTTP port. |
| `HOST` | `0.0.0.0` | Bind address. Set `127.0.0.1` for local-only. |
| `HEARTBEAT_MS` | `20000` | SSE heartbeat interval in ms; mainly a test hook. |
