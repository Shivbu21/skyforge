# Skyforge — Module 1: open-source "deploy PHP apps on Cloudflare with R2 storage" kit

**Codename:** skyforge. **Working dir:** `~/workspace/open-cloud-kit/app/`
**Base:** [workersphp/core](https://github.com/workersphp/core) (MIT), forked 2026-10-14.
No Webotapp code, copy, or branding anywhere. No credentials in the repo.

## What was built

**Fork changes (the base was Laravel-only; the fork adds plain PHP):**
- `packages/cli`: new `--framework plain|laravel` flag with auto-detection
  (artisan → laravel, index.php → plain). New vanilla codegen path
  (`createPhpWorker` + `vanillaAdapter`) — the Laravel codegen output is
  byte-identical to upstream (golden tests still pass). Plain pack = direct
  zip; plain asset publish excludes project metadata. Laravel-only flags
  (`--d1/--queue/--email/--broadcast/--cron`) are rejected for plain apps
  with clear errors instead of failing at runtime. `APP_KEY` upload skipped
  for plain.

**Product layer (`skyforge/`):**
- `bin/skyforge.mjs` — CLI: `init`, `deploy`, `dashboard`, `list`, `help`.
- `lib/config.mjs` — `skyforge.json` load/validate/normalize (pure).
- `lib/scaffold.mjs` — project templates. Plain: `index.php` (router with
  `/api/time`, `/files`, `/upload` R2 demo), `lib/storage.php`
  (`SkyforgeStorage`: R2 via `cf_bindings_call` on Workers, local
  `./storage-dev/` fallback in dev — same API), `style.css`, `skyforge.json`,
  `package.json`, `.gitignore`, README. Laravel: config + wiring guide.
- `lib/deploy.mjs` — config → `workersphp deploy` argv builder (pure),
  credential check (`CLOUDFLARE_API_TOKEN` or `wrangler login`, plain-English
  hints when missing), CLI-installed check, deployment records in
  `~/.skyforge/deployments.json`.
- `lib/cloudflare.mjs` — Cloudflare REST/GraphQL client with injected fetch
  (pure builders/parsers; token never written to disk).
- `dashboard/` — zero-dependency Node server + light-theme UI (warm paper
  background `#faf8f4`, one cobalt accent): deployments table, per-bucket R2
  usage (GraphQL), D1 databases, connect/disconnect with in-memory token.
- `skyforge/test/` — 34 tests, all pure, no network.
- `docs/skyforge-guide.md` — end-to-end: prerequisites → init → dev →
  R2 in PHP → deploy → custom domain → dashboard → troubleshooting.
- `docs/skyforge-compatibility.md` — the boundary table (see below).

## Maturity verdict on the base: FORKABLE, with eyes open

- **Real, not vaporware:** 25/25 upstream tests pass, including a JSPI smoke
  test that boots the actual PHP 8.5.2 wasm interpreter. `npm install` clean.
  The wasm binary downloads from the npm registry (`tools/ensure-binaries.mjs`).
- **Compatibility boundary verified by probe** (booted the real interpreter):
  PHP 8.5.2; mbstring/json/pdo/sqlite3/openssl/zlib/dom/simplexml/filter
  present; gd/imagick/intl/iconv/curl/fileinfo absent (fileinfo polyfilled by
  the Laravel bridge); `exec`/`proc_open` exist but return `false` cleanly;
  `fsockopen` fails after timeout; `cf_bindings_call` present, errors
  gracefully outside a Worker. No outbound HTTP from PHP — confirmed.
- **Young:** 4 commits, v0.1.0, ~2 months old. Small community, no track
  record at scale. The Skyforge layer deliberately wraps the documented CLI
  interface (not internals) so upstream fixes flow through.
- **Not forced:** nothing in the base was found to be fake or unusable; no
  "not ready" fallback was needed. The one gap that mattered (CLI refused
  non-Laravel apps despite the runtime supporting vanilla PHP) was fixed in
  the fork rather than worked around.

## Verification performed

- `npm test` in the fork: **62/62 pass** (25 upstream runtime + 7 CLI incl.
  2 new plain-framework goldens + 30 skyforge... counted 62 total, 0 fail).
- `skyforge init` scaffolded a real project; `workersphp deploy
  --framework plain --no-deploy` ran end-to-end **without credentials**:
  generated worker source (vanillaAdapter), wrangler.jsonc, app.zip with
  correct contents, published assets excluding metadata.
- Dashboard server: `/api/state` returns deployments + unauthenticated
  state; `/api/r2` unauthenticated returns the graceful "not connected"
  state; HTML/CSS/JS all serve correctly (fixed one Buffer-serialization bug
  found during this check).
- No PHP binary on this machine, so the scaffolded `index.php`/`storage.php`
  were verified by inspection + template-content tests, not `php -l`.

## Honest limits — what needs a real Cloudflare account

- **Actual deploy** (provisioning D1/R2/KV, `wrangler deploy`, custom-domain
  attach): needs `wrangler login` or `CLOUDFLARE_API_TOKEN`. Not tested live.
- **Dashboard live panels** (R2 usage via GraphQL, D1 list): need an API
  token with Account:Read, R2:Read, D1:Read. The GraphQL shape
  (`r2StorageAdaptiveGroups`) is coded defensively — if Cloudflare's schema
  differs, the UI shows the error instead of breaking.
- **Workers Paid ($5/mo) is effectively required** — free tier's 10 ms
  CPU/request cannot run PHP (upstream's own finding).
- **Bake mode** (`--bake`, needs Docker + PHP 8.3 + Composer) not exercised here.
- **Laravel path**: scaffold + config verified; full Laravel deploy needs
  `composer create-project` + a Cloudflare account (not done here).

## Suggested next steps (for the parent)

1. User picks the public project name (codename "skyforge" is the working name).
2. Live deploy test against a real Cloudflare account (plain PHP first —
   cheapest to verify).
3. `php -l` the scaffolded PHP on a machine with PHP, or add a CI job.
4. Push the fork to GitHub (needs the user's repo + name choice).
