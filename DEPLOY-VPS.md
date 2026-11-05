# Deploy on the VPS (current live setup)

**Live board: https://mas.wavypremium.xyz:8443/**

- Viewing is public; editing requires the class password (shared privately, not in this repo).
- Server: Japan VPS (`japan` in SSH config, root@89.125.244.178)
- App: `/opt/mas-wall`, Node 20, systemd service `mas-wall` running as **`maswall`**
- Reverse proxy: Caddy with free Let's Encrypt certs for `mas.wavypremium.xyz` and
  `89-125-244-178.sslip.io`, listening on **8443** (port 443 belongs to an unrelated Xray
  service — do not touch it)
- App listens on `127.0.0.1:4321` only; 4321/tcp is not exposed
- Data: `/opt/mas-wall/data/state.json` (atomic writes, seeded from `data/seed.json`)
- Backups: hourly systemd timer → `/var/backups/mas-wall/state-YYYYMMDD-HHMM.json` (14 days)

## Write authentication

The password is **never stored in the repo or browser storage**:

1. The browser posts the password to `POST /api/auth/unlock`.
2. The server compares SHA-256 against `WRITE_HASH` (from the systemd environment),
   with per-IP rate limiting.
3. It returns a random **12-hour token**; the browser stores only that token and sends it
   as `x-write-token` on `POST /api/op`.

The password hash is configured in `/etc/systemd/system/mas-wall.service`:
`Environment=WRITE_HASH=<sha256 of the password>`. To rotate:

```bash
NEW_HASH=$(node -e "console.log(require('crypto').createHash('sha256').update('NEW-PASSWORD').digest('hex'))")
ssh japan "sed -i 's/^Environment=WRITE_HASH=.*/Environment=WRITE_HASH=$NEW_HASH/' /etc/systemd/system/mas-wall.service"
ssh japan 'systemctl daemon-reload && systemctl restart mas-wall'
```

All existing tokens are invalidated on restart. Tell the class the new password — never
commit it to the repo.

## Everyday commands

```bash
ssh japan
systemctl status mas-wall
journalctl -u mas-wall -n 50
systemctl restart mas-wall
systemctl list-timers mas-wall-backup.timer
ls -la /var/backups/mas-wall | tail
```

## Update the live board

```bash
tar -czf /tmp/mas-wall.tgz --exclude='./qa' --exclude='./.git' --exclude='./node_modules' \
  --exclude='./data/state.json' --exclude='./.github' server.js package.json public \
  data/seed.json README.md START-HERE.md DEPLOY-VPS.md DEPLOY-PAGES.md DEPLOY-SUPABASE.md docs
scp /tmp/mas-wall.tgz japan:/tmp/
ssh japan 'tar -xzf /tmp/mas-wall.tgz -C /opt/mas-wall && chown -R maswall:maswall /opt/mas-wall && systemctl restart mas-wall'
```

Do not overwrite `data/state.json` unless you deliberately want to reset the board.

## Restore a backup

```bash
ssh japan 'cp /var/backups/mas-wall/state-YYYYMMDD-HHMM.json /opt/mas-wall/data/state.json && systemctl restart mas-wall'
```

## Hardening / security notes

- Service runs as unprivileged `maswall` with `ProtectSystem=strict`, `ProtectHome`,
  `PrivateTmp`, `NoNewPrivileges`, `CapabilityBoundingSet=` and `ReadWritePaths` limited
  to `/opt/mas-wall/data`.
- Caddy adds HSTS, CSP, X-Frame-Options, Referrer-Policy and Permissions-Policy.
- SSE/presence/write endpoints are capped and per-IP rate-limited.
- The old Supabase project is no longer used. Delete/pause it in the Supabase dashboard so
  the old public anon key cannot write anywhere. Its config has been removed from this repo.
