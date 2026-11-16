# zupu

A password-protected family tree that relatives can view and edit. It runs on Cloudflare's free tier:
one Worker serves the site and a small API, and the data lives in a D1 (SQLite) database.

- **Interactive chart:** click anyone to center them, search by Chinese, English or nicknames, and share a link to a person (`#/p/<id>`).
- **Extend anywhere:** add a parent, spouse, child or sibling to any person, or link two people already in the tree.
- **Change history:** every edit records who made it (the name they type once) and what changed, and any change can be reverted.
- **Privacy:** the password is checked by the Worker. Sessions are signed HttpOnly cookies, and failed logins are rate limited per IP. The data is only reachable through the API. `seed/` and `backups/` are gitignored, so no family data is in the repo.

## One-time setup

1. Create a free Cloudflare account at https://dash.cloudflare.com/sign-up (no credit card).
2. In this directory:
   ```sh
   npm install
   npx wrangler login                     # or `npx wrangler login --device` on a machine without a browser
   npx wrangler d1 create zupu            # found by name; no need to copy the id
   npm run deploy                         # build, create tables, deploy
   npx wrangler secret put FAMILY_PASSWORD   # the password relatives will type
   npm run seed -- --remote               # import seed/family.json
   ```
3. **Address:** the Worker has no public address until you give it one. In the Cloudflare dashboard → Workers → zupu → Settings → Domains & Routes, add a custom domain (its DNS must be on Cloudflare). Deploys leave it in place. Or set `"workers_dev": true` in `wrangler.jsonc` to use `https://zupu.<your-subdomain>.workers.dev`.

### Deploy on every push
`.github/workflows/deploy.yml` runs the tests and then `npm run deploy` on every push to `main` (or manually from the Actions tab). It needs two repository secrets (GitHub → Settings → Secrets and variables → Actions):
- **`CLOUDFLARE_API_TOKEN`:** Cloudflare dashboard → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template, plus *Account → D1 → Edit*.
- **`CLOUDFLARE_ACCOUNT_ID`:** shown by `npx wrangler whoami`.

## Day to day

- **Change the password:** `npx wrangler secret put FAMILY_PASSWORD`. Every existing session is signed out.
- **Undo a bad edit:** 修改紀錄 / History → 詳細 / Details → 還原 / Revert.
- **Back up:** `npm run backup` writes a full SQL dump to `backups/` (gitignored).
- **Edits from other relatives** show up within about 30 seconds, or immediately when switching back to the tab.

## Free-tier headroom

- **Workers:** 100k API requests/day. Static files are free and don't count.
- **D1:** 5 GB storage, 5M row reads/day, 100k row writes/day.

Opening the app costs about 100 row reads, and each open tab checks for changes every 30 s while visible. A family would have to use it thousands of times a day to get near the limits. If they're ever hit, requests fail until midnight UTC; nothing is charged.

## Development

```sh
cp .dev.vars.example .dev.vars   # local password: dev
npm run db:migrate:local
npm run seed -- --local
npm run dev                      # Vite + the Worker in workerd, with a local D1 database
npm test                         # unit tests, Worker API tests, UI smoke test (all local, no account needed)
```

Code map:
- `worker/`: the API (`index.ts`), sessions and rate limiting (`auth.ts`), input validation (`validate.ts`).
- `migrations/`: the D1 schema.
- `src/model.ts`: the person type and relationship helpers.
- `src/store.ts`: turns every edit into ops plus a change-log entry.
- `src/backend.ts`: the API client and polling.
- `src/chart.ts`: family-chart adapter.
- `src/panel.ts`, `src/history.ts`: the UI.
- `src/i18n.ts`: all labels.
