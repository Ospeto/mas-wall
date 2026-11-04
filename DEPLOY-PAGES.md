# Deploy on GitHub Pages (current setup)

The public site is a static copy of `public/` served by GitHub Pages, with Supabase as the
database and realtime layer. There is no Node server in this mode; the same client detects
it because there is no `/api/state` at the Pages URL.

- Site: **https://ospeto.github.io/mas-wall/**
- Repo: https://github.com/Ospeto/mas-wall (public)
- Workflow: `.github/workflows/pages.yml` publishes `public/` on every push to `main`
- First build: repo Settings -> Pages -> Source = **GitHub Actions** (already enabled here)

## Update the live site

Any change to files under `public/` (plus `public/supabase-config.json`) that is pushed to
`main` redeploys automatically in ~1 minute. Check progress:

```bash
gh run list --repo Ospeto/mas-wall --limit 5
gh run watch --repo Ospeto/mas-wall
```

Local commands:

```bash
git add -A
git commit -m "Update wall content"
git push
```

## What is public

- The repo (source, sample assignments) is public.
- The Supabase **publishable/anon** key in `public/supabase-config.json` is public by design.
- The board itself is open-edit: anyone with the link can add, edit or delete posters.
  Never put the `service_role` key in the frontend.

## If you later prefer Vercel

Import the same repo at vercel.com/new, preset **Other**, output directory `public`, no
build command, no env vars. See [DEPLOY-SUPABASE.md](DEPLOY-SUPABASE.md).
