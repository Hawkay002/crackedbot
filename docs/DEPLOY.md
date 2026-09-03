# crackedbot — Deploy Guide

Click-by-click. Four accounts are involved: Discord, GitHub, Fly.io, and optionally Cloudflare for backups. Budget: about $3 per month on Fly, or about $4 per month on a VPS. Total setup time the first time: about 40 minutes.

Recommended host is **Fly.io**. Reasons: it gives you an HTTPS domain automatically (the GitHub OAuth callback needs HTTPS), it supports persistent volumes for the SQLite file, machines can be pinned always-on (a gateway bot must never sleep), and the smallest machine is enough. Render's free tier sleeps, which kills a gateway bot. Railway works but costs more for always-on. A VPS is the alternative at the end of this file.

---

## Part A — Discord application (10 min)

1. Go to https://discord.com/developers/applications and click **New Application**. Name it `crackedbot`. Accept the terms. Click **Create**.
2. **General Information** tab: copy the **Application ID**. This is `DISCORD_APP_ID`. Add an icon and a one-line description, they show on the invite screen.
3. Left sidebar → **Bot**.
   - Click **Reset Token** → **Yes, do it** → copy the token. This is `DISCORD_BOT_TOKEN`. It is shown once.
   - Under **Privileged Gateway Intents**, leave all three **off**. The bot does not need them.
   - Under **Authorization Flow**, leave **Public Bot** on so other communities can install it.
4. Left sidebar → **OAuth2**.
   - Under **OAuth2 URL Generator**, tick scopes **bot** and **applications.commands**.
   - Under **Bot Permissions**, tick **Manage Roles**, **View Channels**, **Send Messages**, **Embed Links**, **Attach Files**, **Read Message History**.
   - Copy the generated URL at the bottom. This is your **Add to Discord** link. Save it for the README.
5. Left sidebar → **Installation**. Under **Install Link** choose **Discord Provided Link**. Under **Default Install Settings → Guild Install**, set scopes to `applications.commands` and `bot`, and the same permissions as step 4.
6. Open the invite link in a browser, pick your test server, click **Continue** → **Authorize**.
7. In the Discord app on that server: **Server Settings → Roles**. Drag the `crackedbot` role **above** every tier role you will create (Tinkerer, Builder, Shipper, Cracked). A bot cannot assign roles that sit above its own. This is the most common setup mistake.

---

## Part B — GitHub App (10 min)

1. Go to https://github.com/settings/apps and click **New GitHub App**. If you want the app owned by an organization, go to that org's **Settings → Developer settings → GitHub Apps** instead.
2. Fill in:
   - **GitHub App name**: `crackedbot` (must be globally unique, add a suffix if taken).
   - **Homepage URL**: the repo URL for now.
   - **Callback URL**: `https://<your-app-name>.fly.dev/auth/callback`. You will know the exact hostname after Part C step 4. You can come back and edit this.
   - Tick **Request user authorization (OAuth) during installation**.
   - Tick **Expire user authorization tokens**. The bot discards the token after one use anyway.
   - Leave **Setup URL** empty.
   - **Webhook**: untick **Active**. The bot does not need webhooks.
3. **Permissions**: leave every Repository, Organization, and Account permission at **No access**. Public data plus the user's own contribution counts is all the analyzer reads.
4. **Where can this GitHub App be installed?**: choose **Any account**.
5. Click **Create GitHub App**.
6. On the app's page:
   - Copy **Client ID**. This is `GITHUB_CLIENT_ID`.
   - Click **Generate a new client secret**, copy it. This is `GITHUB_CLIENT_SECRET`.
   - Scroll to **Private keys** and ignore it. The bot does not need installation tokens for v1.
7. Left sidebar → **Display information**: upload a logo and a description. Left sidebar → **Advanced**: nothing to do. When you are ready for other communities, the app is already public because of step 4.

Optional but recommended for the badge feature and for `/rescore`: create a classic personal access token with **no scopes** at https://github.com/settings/tokens → **Generate new token (classic)** → tick nothing → **Generate**. This is `GITHUB_APP_FALLBACK_TOKEN`. It raises the unauthenticated 60 requests per hour to 5000 for the bot's own public reads.

---

## Part C — Fly.io (15 min)

1. Sign up at https://fly.io/app/sign-up. Add a card under **Billing**. The bot will cost about $3 per month.
2. Install the CLI.
   - Windows PowerShell: `pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"`
   - macOS or Linux: `curl -L https://fly.io/install.sh | sh`
   Restart the terminal, then run `fly auth login`. A browser tab opens, click **Continue**.
3. In the repo root, run:
   ```
   fly launch --no-deploy --name crackedbot --region iad
   ```
   Pick a name that is free. Answer **No** to Postgres, **No** to Redis, **No** to Tigris. It writes `fly.toml`.
4. Your hostname is now `https://crackedbot.fly.dev` (or whatever name you picked). Go back to Part B step 2 and set the **Callback URL** to `https://<name>.fly.dev/auth/callback`. Click **Save changes**.
5. Create the volume for the SQLite file:
   ```
   fly volumes create data --size 1 --region iad --yes
   ```
6. Open `fly.toml` and make sure these sections exist (the repo ships a correct file, this is what to check):
   ```toml
   [build]

   [env]
     DATA_DIR = "/data"
     PORT = "8080"
     PUBLIC_URL = "https://crackedbot.fly.dev"

   [[mounts]]
     source = "data"
     destination = "/data"

   [http_service]
     internal_port = 8080
     force_https = true
     auto_stop_machines = "off"
     auto_start_machines = true
     min_machines_running = 1

   [[vm]]
     size = "shared-cpu-1x"
     memory = "256mb"
   ```
   `auto_stop_machines = "off"` and `min_machines_running = 1` are the two lines that keep the gateway connection alive.
7. Set secrets. Run this once, pasting each value:
   ```
   fly secrets set DISCORD_BOT_TOKEN=... DISCORD_APP_ID=... GITHUB_CLIENT_ID=... GITHUB_CLIENT_SECRET=... STATE_SECRET=$(openssl rand -hex 32)
   ```
   On Windows without openssl, generate `STATE_SECRET` with:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Optionally add `GITHUB_APP_FALLBACK_TOKEN=...`.
8. Deploy:
   ```
   fly deploy
   ```
   First build takes about two minutes. Then run `fly logs` and wait for `discord: ready as crackedbot#1234` and `http: listening on 8080`.
9. Open `https://<name>.fly.dev/health` in a browser. It should return `{"ok":true,...}`.
10. Keep exactly one machine. Check with `fly scale show`. If it says 2, run `fly scale count 1`. Two gateway connections for one bot token cause session conflicts.

Updating later is just `fly deploy`. Rolling back is `fly releases` then `fly deploy --image <previous image>`.

---

## Part D — First run inside Discord (5 min)

1. In the test server, type `/setup`. Pick the verify channel, the modlog channel, the review channel, and map each tier to a role from the select menus. Roles must already exist. Create four: Tinkerer, Builder, Shipper, Cracked. Leave Tourist unmapped.
2. Type `/rubric preset general`.
3. Type `/verify`, click **Link GitHub**, authorize, wait for the page to say done, go back to Discord. You should have a tier role and an ephemeral receipt.
4. Lock down the server the standard way: `@everyone` loses **View Channels** on every category, each tier role gets **View Channels** on the categories it should see, and the verify channel is visible to `@everyone`.

---

## Part E — Backups (5 min, optional but do it)

The whole state is one SQLite file at `/data/crackedbot.db`.

Cheapest good option is Litestream to Cloudflare R2, which is free for 10 GB.

1. Cloudflare dashboard → **R2 Object Storage** → **Create bucket** → name `crackedbot-backups`.
2. **R2 → Manage R2 API Tokens → Create API Token**, permission **Object Read & Write**, scoped to that bucket. Copy the Access Key ID, Secret Access Key, and the endpoint URL shown.
3. Add these Fly secrets: `LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY`, `LITESTREAM_ENDPOINT`, `LITESTREAM_BUCKET`.
4. The repo Dockerfile has a Litestream stage that is enabled when those variables are present. Redeploy. Check `fly logs` for `litestream: replicating`.

Manual fallback at any time: `fly ssh console -C "sqlite3 /data/crackedbot.db .backup /data/backup.db"` then `fly sftp get /data/backup.db`.

---

## Part F — Uptime alert (2 min)

1. https://betterstack.com or https://uptimerobot.com, free tier.
2. Add an HTTP monitor for `https://<name>.fly.dev/health`, interval 5 minutes, alert on non-200 or on body not containing `"ok":true`.

---

## Part G — GitHub Developer Program (3 min)

1. Go to https://docs.github.com/en/get-started/exploring-integrations/github-developer-program and click the registration link.
2. Integration name: `crackedbot`. Description: one sentence. Support email: a real public address you will answer. Website: the repo URL or the Fly hostname.
3. Submit. The **Developer Program Member** badge appears on your profile once accepted.

---

## Alternative host — any VPS with Docker (Hetzner, DigitalOcean, Oracle free tier)

Use this if you would rather own the box. Hetzner CX22 is about €4 per month. Oracle Cloud's Always Free ARM tier is $0 but sign-up is flaky.

1. Create an Ubuntu 24.04 server, add your SSH key, note the public IP.
2. Point a DNS `A` record at it, for example `bot.yourdomain.com`. HTTPS is required for the OAuth callback, so a domain is not optional here.
3. SSH in and install Docker:
   ```
   curl -fsSL https://get.docker.com | sh
   ```
4. Clone the repo, copy `.env.example` to `.env`, fill it in, set `PUBLIC_URL=https://bot.yourdomain.com`.
5. The repo ships `docker-compose.yml` with two services: `bot` and `caddy`. Caddy terminates HTTPS automatically with Let's Encrypt. Edit `Caddyfile` to your domain.
6. Run:
   ```
   docker compose up -d
   docker compose logs -f bot
   ```
7. Set the GitHub App callback URL to `https://bot.yourdomain.com/auth/callback`.
8. Updates: `git pull && docker compose up -d --build`.
9. Backups: `docker compose exec bot sqlite3 /data/crackedbot.db ".backup /data/backup.db"` on a cron, then copy the file anywhere.

---

## Environment variables, complete list

| Variable                      | Required | Notes                                                        |
|-------------------------------|----------|--------------------------------------------------------------|
| `DISCORD_BOT_TOKEN`           | yes      | Part A step 3                                                |
| `DISCORD_APP_ID`              | yes      | Part A step 2                                                |
| `GITHUB_CLIENT_ID`            | yes      | Part B step 6                                                |
| `GITHUB_CLIENT_SECRET`        | yes      | Part B step 6                                                |
| `STATE_SECRET`                | yes      | 32 random bytes hex, signs OAuth state                       |
| `PUBLIC_URL`                  | yes      | `https://<name>.fly.dev`, no trailing slash                  |
| `PORT`                        | no       | default 8080                                                 |
| `DATA_DIR`                    | no       | default `./data`, on Fly `/data`                             |
| `GITHUB_APP_FALLBACK_TOKEN`   | no       | no-scope classic PAT for badge refresh and `/rescore`        |
| `LOG_LEVEL`                   | no       | `info` default, `debug` for troubleshooting                  |
| `LITESTREAM_*`                | no       | Part E                                                       |

---

## Troubleshooting

| Symptom                                              | Fix                                                                                  |
|------------------------------------------------------|--------------------------------------------------------------------------------------|
| Slash commands do not appear                         | Invite link must include `applications.commands`. Global commands can take up to an hour to propagate; the bot registers them on boot. |
| "Missing Permissions" when assigning a role          | Drag the bot's role above the tier roles in Server Settings → Roles.                 |
| GitHub says "redirect_uri is not associated"         | The Callback URL in the GitHub App must exactly equal `PUBLIC_URL + /auth/callback`.  |
| Link button opens a page saying "state expired"      | The 10-minute window passed. Run `/verify` again.                                     |
| Bot goes offline every few minutes on Fly            | `auto_stop_machines` must be `"off"` and `min_machines_running` must be `1`.          |
| Two bots respond, or the gateway keeps reconnecting  | More than one machine is running. `fly scale count 1`.                                |
| `SQLITE_READONLY` or `unable to open database`       | Volume not mounted at `DATA_DIR`. Check `[[mounts]]` in `fly.toml`.                   |
| Analysis says INCOMPLETE for everyone                 | GitHub rate limit on the fallback token, or GitHub GraphQL outage. Check `/health`.   |
