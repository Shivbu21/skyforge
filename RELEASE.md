# skyforge 1.0.0 — Release Notes

**Build date:** 2026-10-14
**License:** MIT (see LICENSE; upstream workersphp/core attribution preserved)
**Codename:** skyforge (working name — not final branding)

## What it is

An open-source kit for deploying PHP apps on Cloudflare Workers (PHP 8.5.2 via
WebAssembly). Scaffolds projects, provisions D1/R2/KV, deploys, and manages the
app lifecycle from one CLI plus a light web dashboard.

## Verified this release

- `npm run test:skyforge` — **82/82 pass** (71 from Modules 1–2 + 11 new template tests)
- `node --check` clean on all CLI entry points
- Credential-free checks: `skyforge templates` lists all 3 templates; `init --template`
  scaffolds all three with zero unsubstituted tokens; non-empty-dir refusal and
  `--force` verified; hello + json-api worker bundles generate correctly

## Modules included

1. **Init / Deploy / Dashboard** — `skyforge init` (plain-PHP + Laravel scaffolding),
   `skyforge deploy` (D1/R2/KV provisioning, domain attach), light dashboard
   (deployments, R2 usage, D1 listings)
2. **Previews / Rollbacks / Logs** — `skyforge preview` (throwaway preview URLs),
   `skyforge rollback` (one-click, recorded as new history entry, never rewrites history),
   `skyforge logs --follow` (live tail); dashboard Previews / Release-history / Logs cards
3. **Template gallery** — 3 curated starters: `hello` (plain PHP), `json-api` (plain PHP
   REST), `laravel-starter`; `skyforge init --template <name>`; dashboard gallery

## Run it

```bash
cd skyforge-1.0.0
npm install          # or: npm i -g ./  (exposes the `skyforge` command)
skyforge templates
skyforge init --template hello my-app
cd my-app && skyforge deploy
```

Dashboard: `skyforge dashboard` (see docs/skyforge-guide.md)

## Going live — required

- A **Cloudflare account** with API token (provisioning shells out to wrangler and
  refuses without credentials)
- **Workers Paid (~$5/mo)** — effectively required; free-tier CPU limits are
  inadequate for the PHP WASM runtime
- Full docs: `docs/skyforge-guide.md`

## Honest limitations

- Live preview deploys, real log tailing, and live rollbacks were not exercised
  against a real Cloudflare account (no account available at build time)
- **WordPress is excluded** — it needs a MySQL driver, outbound HTTP for updates,
  and gd/intl/iconv, none of which the PHP WASM build provides
- `laravel-starter` needs a real `composer create-project` app before its bundle
  can be packed (binding wiring verified via codegen instead)
- PHP platform limits (verified): no gd, imagick, intl, iconv, curl; no outbound
  HTTP from PHP; process/socket functions restricted
