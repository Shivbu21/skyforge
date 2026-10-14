# Skyforge — Module 2: preview deployments, rollbacks, log streaming

**Working dir:** `~/workspace/open-cloud-kit/app/` (codename "skyforge").
Builds on Module 1's CLI + dashboard. No Webotapp code, copy, or branding
anywhere. No credentials in the repo.

## What was built

**Release history model** — `skyforge/lib/releases.mjs` (new)
- `~/.skyforge/deployments.json` gains a backward-compatible `history`
  array per project: `{ id, type: production|preview|rollback, at, url,
  branch, commit, dirty, status: active|superseded|cleaned|failed,
  workerName?, rollbackOf?, logTail? }`. Top-level per-project fields keep
  their Module 1 shape; old files without `history` read as empty.
- New production/rollback entries supersede older active ones; previews
  never supersede. Rollbacks are recorded as NEW entries — history is never
  rewritten.
- Helpers: `newDeployId` (`dep_YYYYMMDD_xxxxxx`), `appendHistory`,
  `getHistory` (newest first), `findEntryById` (exact, then unique prefix),
  `activePreviews`, `markPreviewCleaned`, `gitMeta` (branch/commit/dirty,
  nulls outside a repo, never throws), `commitExists`, `confirmAction`
  (`--yes` skips; readline prompt otherwise).
- `recordDeployment` (Module 1, `lib/deploy.mjs`) now also appends a
  `production` history entry with git metadata, and records `projectDir`
  (used by the dashboard's rollback button; absent on old records).

**Previews** — `skyforge/lib/preview.mjs` (new) + CLI
- `skyforge preview [--branch b] [--commit c]` deploys the working tree as
  a separate Worker named `<project>-preview-<shortid>`
  (`https://<name>-preview-<id>.workers.dev`). The production custom domain
  is never taken by a preview. Previews share the project's D1/R2/KV
  bindings — stated in help text and docs, not hidden.
- `skyforge preview list` / `skyforge preview clean [--all] [<id>...]`
  (clean runs `wrangler delete` and marks the record cleaned; per-preview
  failures are reported, not thrown).

**Rollback** — `skyforge/lib/rollback.mjs` (new) + CLI
- `skyforge rollback [--to <id>] [--yes]`: resolves the target (explicit id
  or the latest superseded production release), prints what will be
  redeployed, asks for confirmation unless `--yes`.
- Implementation: `git worktree add` the recorded commit to a temp dir
  (the user's working tree is never touched), then `workersphp deploy
  --app <worktree>` from the project dir (which has node_modules), using
  the worktree's `skyforge.json` when present. Worktree is removed in a
  `finally` — even on deploy failure.
- Guards, all with plain-English errors: CLI installed → authenticated →
  candidates exist → commit exists locally (`git fetch` hint on shallow
  clones). A failed rollback deploy never touches production and is not
  recorded.

**Log streaming** — `skyforge/lib/logs.mjs` (new) + `skyforge/lib/exec.mjs` (new) + CLI
- `skyforge logs --follow [--name <worker>]` → `npx wrangler tail`
  (stdio inherit, Ctrl-C stops). Clear error when auth is missing.
- `skyforge logs --deployment <id>` → the recorded metadata + captured
  deploy-log tail. Honest by design: Cloudflare retains no historical
  worker logs, and the output says so, pointing at `--follow`.
- `runTee`: spawns a child, forwards output live to the console, and keeps
  a capped (200 KB) tail. Preview/rollback deploys use it so their output
  lands in the history record. Module 1's `deploy` keeps `stdio: inherit`
  untouched.

**Dashboard** — light theme preserved (warm paper `#faf8f4`, cobalt accent)
- Deployments card unchanged. New **Previews** card (active previews, open
  links, clean buttons), **Release history** card (project picker, per-entry
  type badges, rollback buttons), **Logs** card (deployment picker, metadata
  + captured tail in a dark log pane; notes that live tail is CLI-only).
- Server: `GET /api/history?project=`, `GET /api/log?deployment=`,
  `POST /api/rollback` and `POST /api/preview-clean` (both return 202 and
  run as background jobs — deploys take minutes, never block the request),
  `GET /api/jobs/:id` for polling. `/api/state` now also returns `previews`.
- Rollback button degrades honestly: if the project's local directory isn't
  recorded (old records), the API returns the exact CLI command to run
  instead of failing silently.

**Docs** — `docs/skyforge-guide.md` gained section 7 (previews, rollbacks,
logs) and three troubleshooting rows.

## Verification performed

- `npm run test:skyforge`: **71/71 pass** (34 Module 1 + 37 new).
  The suite caught 4 real issues during the build, all fixed: a wrong import
  (`readDeployments` from the wrong module), exact-only id matching (now
  exact-then-unique-prefix), a preview-name sanitizer leaving a trailing
  dash, and two newest-first/oldest-first expectation mistakes in my own
  tests. A fifth — my dashboard edit swallowing the `renderR2` function
  header — was caught by `node --check` on `app.js`.
- `node --check` clean on all new/changed JS (7 lib/bin/server files + app.js).
- CLI smoke (no credentials): `help` lists the new commands; `preview list`
  on an empty store; `logs --deployment xyz` → clean "no deployment matches"
  error; `rollback --to <id> --yes` in a fake git repo with a fake store →
  resolves the target by prefix, prints the plan, then fails honestly at the
  CLI-installed guard (correct order: candidates → confirm → CLI → auth).
- Dashboard smoke (fake store, no token): `/api/state` (deployments +
  previews), `/api/history`, `/api/log` (200 + 404 paths), `/api/rollback`
  → 202 → job polls to `error` with the honest guard message; all new HTML
  sections serve.

## Honest limits — what needs a real Cloudflare account

- **Live preview deploys** (unique preview URLs), **real `wrangler tail`
  streaming**, **live rollback deploys**, and **preview cleanup** (`wrangler
  delete`) were not exercised — no account available. All paths are coded
  against documented wrangler/CLI interfaces with credential guards first.
- **Workers Paid ($5/mo) effectively required** — free tier's 10 ms
  CPU/request cannot run PHP (upstream's own finding, Module 1).
- The dashboard job runner is in-memory: restarting the dashboard loses
  in-flight job state (history records themselves persist).
- `wrangler delete` behavior on a missing worker is passed through, not
  normalized — the record is only marked cleaned on exit 0.
