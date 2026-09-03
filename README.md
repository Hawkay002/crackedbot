# crackedbot

A Discord bot that vets engineering-community applicants by their GitHub. The applicant proves they own the account through GitHub OAuth, the bot computes an explainable **Cracked Score** from 0 to 100, and your server's own rubric decides which tier and roles they get.

**[Add to your Discord server](https://discord.com/oauth2/authorize?client_id=1545185623697268777&permissions=268553216&integration_type=0&scope=bot+applications.commands)** · [Self-host it](docs/DEPLOY.md) · [How scoring works](docs/BLUEPRINT.md)

```
/verify  →  Link GitHub  →  OAuth on the applicant's own token
         →  four GraphQL queries, no repo access, token discarded
         →  6 dimensions × trust multiplier → 0–100
         →  rubric → tier → roles, with a receipt explaining every point
```

| Tier     | Default bar | What it means                                        |
|----------|-------------|------------------------------------------------------|
| Tourist  | 0           | account exists, nothing sustained                    |
| Tinkerer | 20          | some real repos, sporadic activity                   |
| Builder  | 40          | ships consistently, mostly solo                      |
| Shipper  | 60          | consistent, collaborates, projects people use        |
| Cracked  | 80          | sustained output, upstream merged PRs, real impact   |

Names, thresholds, weights, gates, and role mappings are all per server.

## Why it is hard to game

- **Ownership is proven.** Nobody can verify as someone else's username.
- **Merged PRs into repos you do not own** carry real weight, scaled by the target's popularity. That needs another human to merge you.
- **Bought stars and followers are sampled and fingerprinted.** Account-age clustering and zero-repo followers discount the numbers and raise a flag.
- **Craft is measured per repo**: CI, tests, README, license, commit depth, project longevity. Repo size is ignored.
- **Adversarial fixtures live in the test suite.** A star farm, a commit bot, a fork farm, an empty alt, and a dormant account must all score at or below Tinkerer, or CI fails.
- **Every flag is shown on the receipt**, so applicants know exactly what tripped.

## Commands

| Command                                              | Who    | Does                                                   |
|------------------------------------------------------|--------|--------------------------------------------------------|
| `/verify`                                            | anyone | link GitHub, get scored, get placed                    |
| `/score [user]`                                      | anyone | your receipt; mods can view others                     |
| `/unlink`                                            | anyone | remove link, roles, and stored data                    |
| `/leaderboard`                                       | anyone | top 10 in this server                                  |
| `/setup verify-channel [modlog-channel] [review-channel]` | admin | where things happen                               |
| `/rubric view · preset · tier · entry · export · import` | admin | shape the bar                                      |
| `/review`                                            | mod    | open manual reviews                                    |
| `/whois <user>` · `/rescore <user>`                  | mod    | inspect and refresh                                    |

Presets: `general`, `systems`, `web`, `ml`, `mobile`, `gamedev`, `hackathon`.

## Run it

Hosted setup with every click spelled out is in [`docs/DEPLOY.md`](docs/DEPLOY.md). The short version:

1. Create a Discord application and a GitHub App (no permissions, OAuth callback at `PUBLIC_URL/auth/callback`).
2. `cp .env.example .env` and fill it in.
3. `npm install && npm run dev`, or `docker compose up -d`, or `fly deploy`.
4. In Discord: `/setup`, then `/rubric tier Builder @Builder` for each tier, then `/verify`.

The bot needs no privileged intents and only Manage Roles, View Channels, Send Messages, Embed Links, and Attach Files.

## Badge

Once scored, anyone can embed their score:

```markdown
![Cracked Score](https://your-host/badge/octocat.svg)
```

## Development

```bash
npm install
npm run dev          # tsx watch
npm test             # vitest, scoring fixtures included
npm run smoke        # migrations + HTTP routes, no network
npm run score -- torvalds systems   # dry-run the analyzer (needs GITHUB_APP_FALLBACK_TOKEN)
npm run lint && npm run typecheck
```

Design docs: [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md) for the scoring model, [`docs/ROADMAP.md`](docs/ROADMAP.md) for what is next.

## Privacy

Public GitHub data plus the applicant's own contribution counts. No repo access. Tokens are used once and never stored. `/unlink` deletes everything. Details in [`PRIVACY.md`](PRIVACY.md).

## License

MIT