# Skyforge guide — PHP on Cloudflare, end to end

Skyforge is an open-source kit for deploying PHP apps on Cloudflare Workers
with R2 storage. It is built on the [workersphp](https://github.com/workersphp/core)
runtime (MIT): PHP 8.5 compiled to WebAssembly, running inside Workers V8
isolates, with D1, KV, R2, Queues and Durable Objects behind familiar drivers.

## Prerequisites

- Node.js 20+ (24+ if you use `--bake`)
- PHP 8.3+ with Composer (only for Laravel apps; plain PHP needs just a PHP binary for local dev)
- `zip` on your PATH
- A Cloudflare account (free to create; **Workers Paid** [$5/mo] is effectively
  required — the free tier's 10 ms CPU per request cannot run PHP)
- `npx wrangler login` once per machine, **or** set `CLOUDFLARE_API_TOKEN`

## 1. Scaffold

```sh
npx skyforge init my-app                 # plain PHP (default)
npx skyforge init my-app --framework laravel
cd my-app
npm install
```

You get:

- `skyforge.json` — the deploy config (worker name, D1/R2/KV names, domain, env)
- plain: `index.php` (example routes + R2 file store), `lib/storage.php`
  (R2 helper with local-disk fallback), `style.css`
- laravel: `.env.example` + a README with the `composer create-project` and
  `workersphp/laravel-bridge` wiring steps

## 1b. Start from a template

For anything beyond a blank page, start from a curated template — starter
apps that genuinely run on this platform (each one respects the
compatibility boundary: no MySQL, no gd, no outbound HTTP from PHP):

```sh
skyforge templates                      # list with descriptions
skyforge init --template hello my-app   # plain PHP: page + R2 file store + KV counter
skyforge init --template json-api api   # plain PHP: notes CRUD REST API over KV
skyforge init --template laravel-starter shop  # Laravel + D1 + R2 + KV wiring
```

`init --template` refuses a non-empty directory unless you pass `--force`,
and every `{{name}}` placeholder (project name in `skyforge.json`,
`package.json`, code, docs) is substituted at scaffold time. Each template
ships a README with its own deploy steps and honest limits.

The dashboard (`skyforge dashboard`) has a Templates gallery card with the
same list and a copy button for the exact init command.

What we deliberately left out: **WordPress.** It needs MySQL (no MySQL
driver on this runtime — D1 is SQLite and only reachable through the
Laravel bridge), outbound HTTP for updates/plugins (impossible from PHP
here), and extensions like gd/intl that the wasm build doesn't ship. A
WordPress "template" that can't deploy would be a lie, so there isn't one.

## 2. Develop locally

Plain PHP:

```sh
php -S localhost:8000
```

`SkyforgeStorage` detects the missing `cfbindings` extension and stores to
`./storage-dev/` on disk instead of R2. Same API — no code changes when you
deploy.

## 3. Use R2 storage in PHP code

```php
require __DIR__ . '/lib/storage.php';
$storage = new SkyforgeStorage();

$storage->put('invoices/2026-001.pdf', $pdfBytes, 'application/pdf');
$bytes = $storage->get('invoices/2026-001.pdf');   // null when missing
$files = $storage->list('invoices/');              // [['key'=>..., 'size'=>...]]
$storage->delete('invoices/2026-001.pdf');
$storage->backend(); // 'r2' on Workers, 'local-dev' locally
```

Keys are plain R2 object keys. Writes are per-key atomic on R2.

For Laravel apps, configure the bridge instead (`FILESYSTEM_DISK=r2`) and use
`Storage::disk('r2')` — the same R2 bucket sits behind it.

## 4. Deploy

```sh
skyforge deploy
```

What happens, in order:

1. Config validated (`skyforge.json` — clear errors, no silent defaults)
2. Credentials checked (`wrangler login` session or `CLOUDFLARE_API_TOKEN`;
   a plain-English error tells you exactly what to do when missing)
3. `@workersphp/cli` provisions the D1 database, R2 bucket, KV namespace,
   queue (Laravel only) — tolerating already-exists
4. The app is packed into a secret-free zip, Blade/config caches baked
   (Laravel), static assets published
5. `APP_KEY` generated and uploaded as a Worker secret (Laravel only)
6. `wrangler deploy` publishes; the deployment is recorded in
   `~/.skyforge/deployments.json`

Dry run without publishing: `skyforge deploy --no-deploy`.

## 5. Custom domain

Set it in `skyforge.json`:

```json
{ "name": "my-app", "domain": "app.example.com" }
```

`skyforge deploy` attaches the route (apex + `www`) via wrangler.
Requirements: the domain's DNS must be on Cloudflare — Cloudflare then
provisions the TLS certificate automatically. First deploy on a new domain
can take a few minutes for the certificate.

## 6. Dashboard

```sh
skyforge dashboard            # http://localhost:8788
skyforge dashboard --port 9000
```

Shows every recorded deployment (project, URL, last deploy, status,
resources) plus live R2 storage per bucket and D1 databases once you connect
an API token. The token is kept in the dashboard process's memory only —
never written to disk. Disconnecting (or restarting) forgets it.

## 7. Previews, rollbacks, logs

**Preview** a branch without touching production:

```sh
skyforge preview                  # -> https://<name>-preview-<id>.workers.dev
skyforge preview --branch feat/x  # record branch/commit metadata explicitly
skyforge preview list
skyforge preview clean <id>       # or: skyforge preview clean --all
```

A preview is a separate Worker; it shares the project's D1/R2/KV bindings
(stated, not hidden — point a preview at throwaway resources if your data
is precious). Clean deletes the Worker via `wrangler delete`.

**Roll back** production to a previous deploy:

```sh
skyforge rollback                 # interactive: picks the previous release, asks first
skyforge rollback --to <id> --yes # scripts: no prompt
```

Rollback checks out the recorded commit in a temporary git worktree (your
working tree is never touched) and redeploys it. The rollback itself is
recorded as a new history entry — history is never rewritten. Needs the
commit to exist locally (`git fetch` first on shallow clones).

**Logs:**

```sh
skyforge logs --follow              # live tail (wrangler tail), Ctrl-C to stop
skyforge logs --follow --name <worker>
skyforge logs --deployment <id>     # what skyforge recorded at deploy time
```

Cloudflare does not retain historical worker logs on any plan, so
`--deployment` shows skyforge's deploy-time record (config snapshot +
captured output tail), not platform logs. The dashboard's Logs panel shows
the same records, and its Release history tab has one-click rollback buttons.

## 8. What stays yours

- Your code, your Cloudflare account, your data. No Skyforge servers are
  involved at any point — the CLI shells out to wrangler, the dashboard
  talks to Cloudflare's API directly from your machine.
- MIT licensed. Fork it, rebrand it, sell hosting on top of it.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `skyforge: wrangler is not logged in` | `npx wrangler login`, or export `CLOUDFLARE_API_TOKEN` |
| `the @workersphp/cli package is not installed` | `npm install` in the project dir |
| `plain PHP apps do not support --d1` | D1/queues/mail/broadcast/cron need `--framework laravel` |
| Deploy succeeds but domain shows SSL pending | wait a few minutes; Cloudflare is issuing the certificate |
| `fileinfo` functions missing in plain PHP | set content types explicitly on `put()`; the bridge polyfills this for Laravel only |
| Dashboard shows "not connected" | paste an API token (Account: Read, R2: Read, D1: Read) |
| `skyforge rollback` says nothing to roll back to | only one production deploy recorded — deploy at least twice (or once more after a change) |
| `rollback` says commit not available | shallow clone or pruned history — `git fetch origin <commit>` first |
| `preview clean` fails | the Worker may already be deleted — the record stays until cleaned; re-run to retry |

Read `docs/skyforge-compatibility.md` before shipping anything real.
