# Skyforge — Module 3: app template gallery

**Working dir:** `~/workspace/open-cloud-kit/app/` (codename "skyforge").
Builds on Modules 1–2's CLI + dashboard. No Webotapp code, copy, or branding
anywhere. No credentials in the repo.

## What was built

**Template gallery** — `skyforge/templates/<name>/`
- Each template is an on-disk directory: `template.json` manifest
  (`name`, `title`, `description`, `framework`, `badges[]`, `requirements[]`)
  plus the file tree to copy. `{{name}}` in file contents is replaced with
  the project name at scaffold time; `template.json` itself is never copied.
- Three templates, all chosen to genuinely run on this platform:
  - **hello** (plain): page + JSON time endpoint + KV-backed visit counter
    + R2 file-store demo. `lib/storage.php` (R2, same helper as Module 1)
    and `lib/kv.php` (new KV helper: `cf_bindings_call` kind `kv` on
    Workers, `./storage-dev/kv.json` locally). Binds R2 + KV.
  - **json-api** (plain): notes CRUD REST API over KV — 201/404/422 status
    codes, JSON body parsing, CORS for local dev. Binds KV only.
  - **laravel-starter** (laravel): `skyforge.json` wiring D1 + R2 + KV,
    `.env.example`, and a README with the `composer create-project` +
    bridge-wiring steps (the app itself is created by the user, as in
    Module 1's Laravel scaffold).
- Every template ships `skyforge.json` (bindings prewired, name
  substituted), `package.json`, `.env.example`, `.gitignore`, and a README
  with deploy steps and honest limits.

**CLI** — `skyforge/bin/skyforge.mjs`
- `skyforge templates`: lists name, title, framework, description, stack
  badges, requirements, and the exact init command per template.
- `skyforge init --template <name> [dir] [--force]`: scaffolds into
  `./[dir]` (default: the template name). Refuses a non-empty directory
  without `--force`. The existing `init <name> [--framework]` path is
  untouched.
- New `skyforge/lib/templates.mjs`: `listTemplates`, `getTemplate`,
  `validateManifest`, `scaffoldTemplate`, `renderName` — all taking an
  explicit root dir so tests never touch the real templates.

**Dashboard** — light theme preserved (`#faf8f4`, cobalt `#175cd3`)
- New `GET /api/templates` (never throws: an unreadable templates dir
  logs and returns an empty list).
- New Templates gallery card: per-template card with title, description,
  stack badges, requirements, and the exact
  `skyforge init --template <name>` command in a dark mono block with a
  working copy button.

**Docs** — `docs/skyforge-guide.md` gained section 1b (templates:
  list, init, dashboard gallery, and the WordPress exclusion rationale).

## Why each template works on the platform

Verified against Module 1's probed compatibility boundary (PHP 8.5.2 wasm:
mbstring/JSON/PDO/SQLite/OpenSSL/zlib/DOM present; **no**
gd/imagick/intl/iconv/curl; no outbound HTTP from PHP):
- Plain templates use only R2 + KV, both reachable from plain PHP via
  `cf_bindings_call` (kinds `r2` and `kv`, confirmed in
  `packages/runtime/src/bindings.mjs`). D1 is intentionally absent from
  plain templates — the orchestrator rejects `--d1` for plain apps because
  D1 needs the Laravel bridge's PHP-side driver.
- `laravel-starter` gets D1 + R2 + KV through the bridge, which is the
  only supported path for D1.

**Excluded: WordPress.** It needs MySQL (no driver on this runtime; D1 is
SQLite and only reachable via the Laravel bridge), outbound HTTP for
core/plugin updates (impossible from PHP here — `fsockopen` fails, no
curl), and extensions the wasm build doesn't ship (gd, intl, iconv).
Shipping a WordPress "template" that cannot deploy would be dishonest, so
there isn't one. (Same reasoning excludes anything needing MySQL,
Postgres, Redis-over-TCP, or image processing.)

**On `wrangler.toml`:** the task spec asked for one per template, but the
platform's deploy flow *generates* `wrangler.jsonc` at deploy time from
`skyforge.json` bindings (`packages/cli/src/index.mjs`) and deploys with
`-c <generated>`. A hand-written `wrangler.toml` in the template would be
ignored, so bindings are prewired in `skyforge.json` instead — verified
below to produce the correct generated bindings.

## Verification performed

- `npm run test:skyforge`: **82/82 pass** (71 Modules 1–2 + 11 new).
  New suite covers: manifest validity of all shipped templates, binding
  wiring per template (`hello` r2+kv, `json-api` kv-only, `laravel-starter`
  d1+r2+kv), manifest rejection cases, unknown-template errors,
  `{{name}}` substitution, non-empty-dir refusal / `--force` overwrite,
  project-name validation, empty-template rejection.
- `node --check` clean on all new/changed JS (lib, bin, server, app.js, tests).
- CLI (no credentials): `skyforge templates` lists all three with full
  detail; `init --template` scaffolded all three into temp dirs with zero
  `{{name}}` tokens remaining; non-empty dir refused with a clear error;
  `--force` overwrote; existing `init <name>` path unaffected.
- Credential-free bundle check (workspace CLI, `deploy --no-deploy`,
  no resource flags so provisioning is a no-op):
  - `hello` and `json-api`: bundle **OK** — `wrangler.jsonc` +
    `src/index.mjs` + `assets/app.zip` all generated.
  - `laravel-starter`: bundle **not** built here — packing requires a real
    Laravel app (`composer create-project`), which this environment did
    not run. Verified instead: its `skyforge.json` passes the real
    `loadConfig` validator, and the pure `generate()` codegen emits the
    correct `d1_databases` / `r2_buckets` / `kv_namespaces` bindings for its
    config. Same honest scope as Module 1's Laravel path.
- Codegen binding check (pure, no network): `hello` → r2 `STORAGE` +
  kv `CACHE`; `json-api` → kv only; `laravel-starter` → d1 `DB` + r2 +
  kv. All correct.
- Dashboard smoke (fake store, no token): `GET /api/templates` → 200 with
  all three manifests; gallery card renders — verified via headless
  Chrome screenshot (fixed one CSS bug found there: the copy button was
  pushed out of the command block by overflow; now truncated with ellipsis
  and the button stays visible).

## Honest limits — what needs a real Cloudflare account

- **Live deploy of any template** (provisioning R2/KV/D1, `wrangler deploy`):
  needs `wrangler login` or `CLOUDFLARE_API_TOKEN`. The provision step
  shells out to wrangler and throws without credentials — verified
  empirically (this is also why the bundle check above omits resource flags).
- **Workers Paid ($5/mo) effectively required** — free tier CPU cannot run
  PHP (Module 1).
- **Laravel template end-to-end**: needs `composer create-project` +
  bake (Docker + PHP 8.3) + a Cloudflare account; not exercised here.
- **No PHP binary on this machine**: template PHP was verified by
  inspection + substitution/bundle tests, not `php -l`.
- Template PHP helpers assume the `cfbindings` extension's `{ok, value}`
  response envelope (same convention as Module 1's storage helper) —
  code-reviewed, not live-fired.
