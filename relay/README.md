# Looted-cities relay

Lets players submit their looted cities from the app without a GitHub account.
The app sends the list here; this relay files it as an issue on the repository.
It runs as a Cloudflare Worker (the free plan is enough).

Nothing a player submits reaches the shared list by itself. Each submission is
an issue for a maintainer to review and merge.

## One-time setup

1. **Make a GitHub token.** On GitHub: Settings → Developer settings →
   Personal access tokens → Fine-grained tokens → Generate new token.
   - Repository access: *Only select repositories* → `aomc-elytra-hunt`.
   - Permissions → Repository permissions → **Issues: Read and write**.
   - Nothing else. Copy the token.
2. **Deploy the relay.** With a Cloudflare account:
   ```
   cd relay
   npx wrangler login
   npx wrangler deploy
   npx wrangler secret put GITHUB_TOKEN    # paste the token when asked
   ```
   `deploy` prints the relay's address, like
   `https://aomc-looted-relay.<your-subdomain>.workers.dev`.
3. **Point the app at it.** Put that address in `SUBMIT_URL` near the top of
   `src/main.ts`, then commit and push. The "Submit looted" button appears once
   it is set.

## Getting notified

Issues filed by the relay are created with your token, so GitHub counts them as
your own activity and does not email you about them by default. Either:

- turn on **Include your own updates** under GitHub → Settings → Notifications →
  Email, or
- create the token from a second GitHub account that has been invited to the
  repository, so the issues come from that account.

## Handling a submission

```
npm run looted -- --issue 12    # merge issue #12 into public/looted.json
git commit -am "Add looted cities from issue 12" && git push
```

Then close the issue.

## Limits

- Only the app's own site (`ALLOWED_ORIGIN` in `wrangler.toml`) may call it.
- One submission per visitor address per minute, at most 4,000 cities each.
- Only coordinates and a username-like name are accepted; no free text.
