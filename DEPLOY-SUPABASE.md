# Deploy MAS WALL on Vercel + Supabase

This is the **hosted** mode: a permanent, shareable link that works from anywhere, with
state stored in Supabase (Postgres + Realtime). The local `node server.js` mode is still
there and is unchanged — it keeps using `data/state.json` on the machine you run it on.

Nothing needs to be installed to deploy: the site is static files on Vercel, the vendor
client is committed in `public/vendor/`, and there is no build step, no npm install and no
serverless function.

---

## Which option should I pick?

| | **Vercel + Supabase (this guide)** | **Local server / tunnel** |
|---|---|---|
| Link | Permanent, free, works anywhere | `http://192.168.x.x:4321` (same Wi-Fi) or a tunnel URL that changes each run |
| Laptop must stay on | No | Yes |
| Sync speed between tabs | Supabase Realtime: usually **100–800 ms** | SSE on the LAN: **instant (<100 ms)** |
| Where data lives | Supabase Postgres (survives redeploys) | `data/state.json` on your machine |
| Setup effort | ~20 minutes once | `node server.js` |
| Good for | Sharing with the whole cohort, demo links, "open it on your phone" | A classroom on one Wi-Fi, hacking on the design |

Pick **Vercel + Supabase** when you want one link to keep working tomorrow. Pick the
**local server** when you want the snappiest edits and don't care about the laptop staying
open. You can do both: the app decides at boot which mode it is in (see
[How the app chooses a mode](#how-the-app-chooses-a-mode)).

---

## What you need

- A free **Vercel** account (GitHub/Google login is fine).
- A free **Supabase** account.
- This repository pushed to GitHub (or GitLab/Bitbucket) so Vercel can import it.

Supabase free tier (as of 2026; check their pricing page — limits change):

- 2 active projects
- 500 MB database, 5 GB bandwidth/month
- 200 concurrent Realtime connections, 2 million Realtime messages/month
- **A free project is paused after ~7 days without activity.** Open the Supabase dashboard
  to un-pause it; the data is not lost.

That is comfortably enough for a class of 30 people, a few hundred posters and a few
open tabs each.

---

## Step 1 — Create the Supabase project

1. Go to <https://supabase.com/dashboard> and sign in.
2. **New project** → pick your organisation → name it `mas-wall` → generate/save the
   database password (the app never uses it — it is for you) → choose the region closest to
   your classmates → **Create new project**. Wait ~2 minutes for provisioning.
3. You now have a project with a URL like `https://abcdefghijkl.supabase.co`.

## Step 2 — Create the tables (run `supabase/schema.sql`)

1. In the Supabase dashboard open **SQL Editor** → **New query**.
2. Open [supabase/schema.sql](supabase/schema.sql) from this repo, copy the whole file and
   paste it into the editor.
3. Press **Run** (or Cmd/Ctrl+Enter).
4. Expected result: a small table at the bottom showing `cards | 0` and `board | 0`
   (that is the file's final sanity query). If you see a red error, stop and read the
   [Troubleshooting](#troubleshooting) section — do not continue to the next step.

What it created: `public.cards` (one row per poster), `public.board` (one row for the
course header), Row Level Security with deliberately open policies, updated-at triggers,
and Realtime enabled on both tables. The file is safe to run again.

## Step 3 — Load the starter posters (run `supabase/seed.sql`)

1. **SQL Editor** → **New query**.
2. Paste the whole of [supabase/seed.sql](supabase/seed.sql) → **Run**.
3. Expected result: `8 rows affected` (one per seed poster) plus 1 board row.
4. Optional: run it a second time — it should report `0 rows affected` and change nothing.
   `ON CONFLICT (id) DO NOTHING` makes it safe to re-run.

## Step 4 — Copy the Project URL and anon key into the repo

1. Supabase dashboard → **Project Settings** (gear) → **API**.
2. Copy **Project URL** — looks like `https://abcdefghijkl.supabase.co`.
3. Copy the **anon / public** key — a long `eyJ...` JWT. (If your project offers only the
   newer **Publishable key** `sb_publishable_...`, that works with the vendored client too;
   either way only the *public* key is allowed in a browser.)
4. Open [public/supabase-config.json](public/supabase-config.json) and fill it in:

   ```json
   {
     "url": "https://abcdefghijkl.supabase.co",
     "anonKey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
   }
   ```

   Leave both values as empty strings to keep the deployed site in offline/local mode.
5. Commit and push:

   ```bash
   git add public/supabase-config.json
   git commit -m "chore: point the hosted board at Supabase"
   git push
   ```

The **anon/public key is designed to be public** — it is shipped to every browser in any
Supabase app. Access is controlled by the RLS policies you created in Step 2, not by hiding
the key. **Never** put the `service_role` / secret key in this file: it bypasses RLS and
would let anyone with the URL wipe the database.

> The URL is read by the browser from `/supabase-config.json` with `Cache-Control:
> no-store`, so after a deploy a plain refresh picks up a changed config.

## Step 5 — Deploy to Vercel

### Option A — dashboard (recommended, no terminal)

1. Go to <https://vercel.com/new>.
2. **Import Git Repository** → pick the repo that contains this project.
3. On the configure screen:
   - **Framework Preset**: `Other`
   - **Root Directory**: `./` (the repo root, leave as is)
   - **Build Command**: leave empty / disabled (**Override** off)
   - **Output Directory**: `public` (vercel.json already says this; set it here too so the
     dashboard and the file agree)
   - **Environment Variables**: none. The Supabase settings live in
     `public/supabase-config.json`, not in Vercel env vars.
4. **Deploy**. First build takes ~20 seconds because there is nothing to build.
5. Your board is at `https://<project-name>.vercel.app`.

### Option B — CLI

```bash
npx vercel login          # once
npx vercel link           # link this folder to a Vercel project
npx vercel --prod         # deploy
```

Answer the prompts with: framework **Other**, root directory `./`, build command empty,
output directory `public`. Add `.vercel/` to your local `.gitignore` if the CLI creates it.

Either way, every push to the production branch redeploys automatically (Git integration).

## Step 6 — First-run checklist

Open the deployment URL on two devices (or two browser windows) and confirm:

- [ ] The wall renders **8 posters** from `seed.sql`.
- [ ] Tick a requirement in window A → window B updates **within ~1 second**, no reload.
- [ ] Drag a poster in A, reload it later — it stays where you put it.
- [ ] Add a poster, edit its title in the drawer — it appears in the other window.
- [ ] The presence row shows "2 online" with two avatars.
- [ ] Rename the course header → the other window follows.
- [ ] Delete the poster you added → it disappears everywhere.
- [ ] Reload with the network throttled/offline → the board still opens from cache and the
      offline banner appears (app.js's localStorage fallback), then reconnects.

If the header badge says **offline** even though the network is fine, `supabase-config.json`
is empty or wrong — see Troubleshooting.

---

## How sync works (and what latency to expect)

- **Poster edits**: written straight to Supabase (one row per card) and broadcast over
  Supabase Realtime to every open tab. Typical end-to-end **100–800 ms**; the local SSE
  server feels instant on the same Wi-Fi.
- **Presence** ("N online" avatars): Supabase Realtime Presence channel, ~1–2 s to settle.
- **Initial load**: two small queries (cards + board) instead of one `/api/state` call.
- **Fallback**: if Realtime cannot connect (blocked WebSocket, paused project), app.js polls
  the same tables every few seconds, so changes still arrive — but with **2–5 s** latency.
- **Offline**: with no Supabase configured or no network, app.js runs on its localStorage
  cache (edits stay local until you refresh; the local `node server.js` mode is the full
  offline story).

There is no long-lived SSE stream on Vercel, so the local `/api/events` endpoint simply does
not exist in hosted mode. That is expected.

## Where the data lives

| Mode | Data location | Survives redeploys? |
|---|---|---|
| Vercel + Supabase | Supabase Postgres tables `cards` / `board` | **Yes** — Vercel only hosts files |
| Local `node server.js` | `data/state.json` on your machine | Yes, on that machine |

The two modes are independent: deploying to Vercel never touches `data/state.json`, and
running the local server never touches Supabase.

To reset the hosted board to the demo content:

```sql
-- in the Supabase SQL editor
delete from public.cards;
delete from public.board;
```

…then re-run [supabase/seed.sql](supabase/seed.sql). (Re-running the seed *without* deleting
first restores only the posters you deleted; edited ones keep your edits, because the seed
uses `ON CONFLICT (id) DO NOTHING`.)

## Security — please read

- This board is **intentionally open edit**: no accounts, no login. Anyone who has the URL
  can add, move, edit and delete posters, including all of them at once. That is the
  product decision, not an oversight.
- The `anon` key in `public/supabase-config.json` is public by design. It can only do what
  the RLS policies allow, and those policies currently allow everything on these two tables.
- **Never** commit the `service_role` key or your database password. They bypass RLS.
- No rate limiting, no moderation, no undo. A public URL is a public URL: share it with your
  cohort, not on a public timeline.
- If you later want a closed board: add Supabase Auth and change the policies from
  `to anon` to `to authenticated`, then gate the page behind login. That is a product change,
  not a deployment change.
- Supabase's SPA (Browser) Security Model assumes RLS is doing the enforcing. Here it is
  enforcing "everybody is allowed" — deliberate, and documented in `supabase/schema.sql`.

## Files added for the hosted mode

```
supabase/schema.sql              tables, RLS policies, triggers, Realtime publication
supabase/seed.sql                starter posters + course header (generated from data/seed.json)
public/vendor/supabase-js.min.js official @supabase/supabase-js v2 UMD build (MIT), vendored
public/supabase-config.json      your project URL + anon key (empty = not configured)
public/supabase-config.example.json  copy-me template
vercel.json                      static-only deploy: public/ at the root, no functions
DEPLOY-SUPABASE.md               this file
qa/deploy/                       generation + validation tooling used to verify the above
```

## Updating the vendored client

`public/vendor/supabase-js.min.js` is pinned so the wall makes **no third-party CDN
requests** at runtime. To update it:

```bash
curl -sSL https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js \
  -o public/vendor/supabase-js.min.js
```

then re-add the short license banner comment at the top and redeploy. It exposes
`window.supabase.createClient(url, anonKey)`.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Header badge says offline, no posters | `/supabase-config.json` has empty `url`/`anonKey` | Fill both values, commit, redeploy |
| `/supabase-config.json` is a 404 on the deployed site | File not under `public/`, or output directory is not `public` | Check Vercel → Settings → Build & Deployment → Output Directory = `public` |
| Console: `Invalid API key` | Key truncated/whitespace, or wrong key type copied | Re-copy the anon/public key exactly |
| Console: `new row violates row-level security policy` | `schema.sql` was not run (or was edited) | Re-run [supabase/schema.sql](supabase/schema.sql) |
| Two tabs do not sync, polling still works | Realtime publication missing or WebSocket blocked | Run `select * from pg_publication_tables where pubname = 'supabase_realtime';` — expect both `cards` and `board`. Re-run schema.sql if not. Corporate Wi-Fi can block WebSockets; the app falls back to ~2–5 s polling |
| Board is empty but tables exist | `seed.sql` never ran | Run [supabase/seed.sql](supabase/seed.sql) |
| Everything stopped working after a week | Free Supabase project auto-paused | Supabase dashboard → **Restore project** |
| Vercel shows the repo README instead of the wall | Output directory not set | Vercel → Settings → Build & Deployment → Output Directory = `public`, redeploy |
| Fonts/poster styling look wrong on the deployed site | Font files not deployed | `public/fonts/*.woff2` must be committed |
| Edited `supabase-config.json` but browser still uses the old URL | Old cached copy | It is served `no-store`; hard refresh (Cmd/Ctrl+Shift+R) and redeploy |

## Local testing of the hosted mode

You do not need Supabase for layout work: `node server.js` serves the app in HTTP mode.
To test the *static* build exactly as Vercel serves it:

```bash
python3 -m http.server 4402 --directory public
# open http://127.0.0.1:4402/  (app.js will find no /api/state, then read
# /supabase-config.json; with empty values it falls back to offline mode)
```

With Supabase configured in that file, the same static server gives you the full hosted
experience locally. The Vercel CLI also works: `npx vercel dev --local` runs the local dev
server without linking a project or logging in (it only discovers the config locally); a bare
`npx vercel dev` wants a linked, logged-in project. A real deployment is the only true test of
Vercel's routing.
