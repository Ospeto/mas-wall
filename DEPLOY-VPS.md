# Deploy on the VPS (current live setup)

**Live board: https://89-125-244-178.sslip.io:8443/** — password for editing: **MAS200**.
Viewing is open; adding, editing, dragging and deleting require the password.

- Provider/host: SpeedyPage? no — this is the **Japan** box (`japan` in SSH config, root@89.125.244.178)
- App directory: `/opt/mas-wall` (Node 20, systemd service `mas-wall`)
- Reverse proxy: Caddy with a free Let's Encrypt certificate for `89-125-244-178.sslip.io`, listening on **8443** (port 443 belongs to another service on that box)
- App only listens on `127.0.0.1:4321`; 4321/tcp is not reachable from the internet
- Data: `/opt/mas-wall/data/state.json` (atomic writes; seed in `data/seed.json`)
- Write password is enforced by `server.js` (`x-write-password` header); only its SHA-256 hash is in code

## Everyday commands

```bash
ssh japan
systemctl status mas-wall       # is it up?
journalctl -u mas-wall -n 50    # recent ops / errors
systemctl restart mas-wall      # after updating files
```

## Update the live board

From this project folder on the Mac:

```bash
tar -czf /tmp/mas-wall.tgz --exclude='./qa' --exclude='./.git' --exclude='./node_modules' \
  --exclude='./data/state.json' --exclude='./.github' server.js static-server.js package.json \
  public data/seed.json README.md START-HERE.md DEPLOY-SUPABASE.md docs
scp /tmp/mas-wall.tgz japan:/tmp/
ssh japan 'tar -xzf /tmp/mas-wall.tgz -C /opt/mas-wall && systemctl restart mas-wall'
```

Keep `data/state.json` on the server (do not overwrite it with the seed unless you want a reset).

## Backup / restore

```bash
ssh japan 'cp /opt/mas-wall/data/state.json /root/mas-wall-backup-$(date +%F-%H%M).json'
# restore: scp a backup to /opt/mas-wall/data/state.json and restart
```

## Change the write password

1. Produce hashes: `node -e "const c=require('crypto');console.log('server',c.createHash('sha256').update('NEWPASS').digest('hex'));console.log('client',c.createHash('sha256').update('mas-wall-write|NEWPASS').digest('hex'))"`
2. Put the **server** hash in the systemd unit as `Environment=WRITE_HASH=<server-hash>` (or replace the default in `server.js`), then `systemctl daemon-reload && systemctl restart mas-wall`.
3. Put the **client** hash in `public/app.js` (`WRITE_HASH`), redeploy the files and reload the page.

## HTTPS / certs

Caddy renews the`89-125-244-178.sslip.io` certificate automatically. Caddyfile: `/etc/caddy/Caddyfile`.
If you later point a real domain at this VPS, replace the site address and `systemctl reload caddy`.

## Why the GitHub Pages copy redirects here

`public/index.html` redirects `*.github.io` to the VPS URL, so the old link keeps working.
The VPS is the single source of truth; Supabase is no longer used by the live board.
