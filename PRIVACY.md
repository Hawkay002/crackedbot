# Privacy

Plain-language summary of what crackedbot reads, stores, and deletes.

## What it reads

When you run `/verify` and sign in with GitHub, the bot reads, using a token that belongs to you:

- your public profile (name, bio, avatar, account age, follower and following counts)
- your public repositories and their metadata (stars, forks, languages, whether they have a README, CI, tests, a license)
- your contribution counts for the last three years, including the **count** of private contributions, but never their content
- your merged pull requests and which repositories they went into
- a sample of your followers and of the people who starred your top repository, by account age and follower count only

It never reads repository contents, private repositories, email addresses, or organization membership details. The GitHub App requests **no permissions**.

## What it stores

- the link between your Discord user id and your GitHub id, per server
- your score, tier, the dimension breakdown, and any flags
- a compressed copy of the analysis above so moderators can see why you scored what you scored
- an audit line for each verification, review, rescore, and unlink

It never stores your GitHub token. The token is used for a few seconds and dropped.

## How long

- the compressed analysis: 30 days
- everything about a failed or rejected attempt: 90 days
- your link and score: until you run `/unlink` or leave the server and a moderator removes you

## How to delete

Run `/unlink` in the server. Your link, roles granted by the bot, and stored scores are removed immediately. If you are linked in several servers, each server's data is separate.

## Who can see what

- **You**: your full receipt, ephemerally.
- **Everyone in the server**: your login, score, and tier on the welcome message and leaderboard. You can ask a moderator to opt you out of the leaderboard.
- **Moderators**: receipts and flags for members of their own server. Not other servers.
- **The bot host**: the database above. Hosts are asked to keep it private and to honor deletion requests.

## Badge

The badge endpoint shows your latest score and tier for your GitHub login to anyone who requests it. It reveals nothing beyond what the welcome message already shows.
