# Deploying to our own server

For the host chosen in the handbook (task 7.42): one small Linux server (Hetzner CX33, Ubuntu 24.04)
with Caddy in front for HTTPS. `docs/MANUAL_STEPS.md` §10 says what any host must offer; this is
how to set up that one. Every command runs on the server, as root unless it says otherwise.

These files have not been run on a real server yet. Check each step's result as you go.

## 1. Node 22 and Caddy

```sh
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs caddy git
node --version          # v22.13 or newer
```

## 2. The app, as its own user

```sh
useradd --system --home /opt/loyalty-system --shell /usr/sbin/nologin loyalty
# Once the repo is private (docs/MANUAL_STEPS.md §1), add a read-only deploy key for this server first.
git clone https://github.com/Heath114/loyalty-system /opt/loyalty-system
cd /opt/loyalty-system
npm ci --omit=dev
mkdir -p data certs /var/backups/loyalty
```

Copy in, from the machine that made them (`scp`, never email or chat): `certs/pass.pem`,
`certs/pass.key`, `certs/wwdr-g4.pem`, `certs/google-service-account.json` and a `.env`. In `.env`:
`PUBLIC_URL` is the real domain, `HOST=127.0.0.1` (only Caddy talks to the app), and `APP_SECRET` is
a fresh `openssl rand -base64 32`, never the one from a test.

```sh
chown -R loyalty:loyalty /opt/loyalty-system /var/backups/loyalty
chmod 600 .env certs/*
chmod 700 certs data /var/backups/loyalty
sudo -u loyalty npm run doctor      # must end with "Ready."
```

## 3. Start it, and keep it running

```sh
cp deploy/loyalty.service deploy/loyalty-backup.service deploy/loyalty-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now loyalty loyalty-backup.timer
systemctl status loyalty            # "active (running)"
journalctl -u loyalty -f            # the log: "loyalty-system on :8787, ..."
```

## 4. HTTPS

Point the domain at the server first (an `A` record on Cloudflare DNS, proxy **off**, so Caddy can get
its certificate). Then:

```sh
sed "s/cards.example.com/<the domain>/" deploy/Caddyfile > /etc/caddy/Caddyfile
systemctl reload caddy
sudo -u loyalty npm run doctor -- --online
```

In Hetzner's firewall, allow only 22, 80 and 443 in.

## Updating

```sh
cd /opt/loyalty-system
sudo -u loyalty git pull
sudo -u loyalty npm ci --omit=dev
systemctl restart loyalty
```

Database changes run by themselves at start (`src/db.ts`). Take a backup first: `sudo -u loyalty npm run backup`.

## Backups

`loyalty-backup.timer` copies the database every night to `/var/backups/loyalty`, keeping 14. Copies
on the same disk do not survive losing the server, so one copy a day must leave it, **encrypted**
(it holds members' names and phone numbers). The partners choose where (handbook 7.51); with
[age](https://age-encryption.org) and any storage the server can reach:

```sh
age -r <public key> -o latest.db.age "$(ls -t /var/backups/loyalty/*.db | head -1)"
```

Restore test, once a month: copy a backup to a spare machine, set `DB_PATH` to it, `npm start`, open
the dashboard. A backup nobody has restored is a hope, not a backup.
