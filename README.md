# Skyforge

An open-source kit for deploying PHP apps on Cloudflare Workers with R2
storage. One scaffold command, one deploy command, and a small dashboard —
no servers to manage.

Built on the [workersphp](https://github.com/workersphp/core) runtime (MIT):
PHP 8.5 compiled to WebAssembly, running inside Workers V8 isolates, with
D1, KV, R2, Queues and Durable Objects behind familiar drivers.

This is release **1.0.0** (2026-10-14) of the open-source rebuild — an
original fork with a new product layer (scaffolding, deploy UX, previews,
rollbacks, logs, templates, dashboard). See MODULE1.md / MODULE2.md /
MODULE3.md for the build record.

## License

MIT (see LICENSE). The distributed wasm binary bundles software under its
own licenses; see NOTICE and the LICENSES directory inside the binary
package.

## Install

Prerequisites: Node 20+, `zip`, and a Cloudflare account (see "Going live"
below). PHP 8.3+ with Composer only for the Laravel template.

```sh
npm i -g skyforge-1.0.0.tar.gz     # from this release tarball
# or, from the source tree:
npm i -g .
```

This package is `private: true` in package.json, so `npm i -g .` installs from
the local tree. `skyforge --help` lists every command.

## Commands overview

| Command | What it does |
|---|---|
| `skyforge init [dir]` | Scaffolds a project: plain PHP (default) or Laravel (`--framework laravel`). Writes `skyforge.json`, an R2 storage helper with local-disk fallback for dev, and example routes. |
| `skyforge init --template <name> [dir]` | Scaffolds from a curated starter instead: `hello` (plain PHP + R2/KV demo), `json-api` (notes CRUD over KV), `laravel-starter` (Laravel wired to D1/R2/KV). |
| `skyforge templates` | Lists available templates with descriptions and requirements. |
| `skyforge deploy` | Validates config, checks Cloudflare credentials with plain-English errors, provisions D1/R2/KV, packs, and publishes. Records the release in `~/.skyforge/deployments.json`. |
| `skyforge preview [--branch b] [--commit c]` | Deploys the working tree as a separate preview Worker (`<name>-preview-<id>`); production domain is never taken. Previews share the project's D1/R2/KV. |
| `skyforge preview list` / `skyforge preview clean [--all] [id...]` | List and tear down previews. |
| `skyforge rollback [--to <id>] [--yes]` | Redeploys a previous release (git worktree at the recorded commit — your working tree is never touched). Recorded as a *new* history entry; history is never rewritten. |
| `skyforge logs --follow [--name <worker>]` | Tails live Worker logs (`wrangler tail`). `skyforge logs --deployment <id>` shows a deployment's recorded metadata. |
| `skyforge dashboard` | Local web UI (http://localhost:8788): deployments + release history with one-click rollback, previews, R2 usage, D1 listings, template gallery, log viewer. The Cloudflare token lives in memory only — never on disk. |

Deployment bookkeeping lives in `~/.skyforge/deployments.json`.

## The compatibility boundary (read before shipping)

Verified 2026-10-14 against the real interpreter — see
`docs/skyforge-compatibility.md` for the full table.

- No outbound HTTP from PHP (`curl` absent, sockets fail) — wasm has no network stack.
- No `gd`, `imagick`, `intl`, `iconv`. No `exec`/`proc_open` (present but inert).
- Requests serialize per isolate; cold starts ~1 s.
- Plain PHP gets KV + R2 + atomic cache/locks. D1, queues, mail, broadcast and cron need the Laravel bridge.
- **WordPress is not supported**: it needs a MySQL driver (D1 is SQLite via the Laravel bridge only), outbound HTTP for updates (impossible from PHP here), and `gd`/`intl`/`iconv`, which the wasm build does not ship.

## Honest status and caveats

- This is a **1.0.0 of the fork's product layer** — the underlying runtime is young (v0.1.0, ~2 months old). It is real (25/25 tests pass against the actual wasm interpreter), but expect rough edges. The Skyforge layer wraps the documented CLI interface, not runtime internals, so upstream fixes flow through.
- **Live deploys need a real Cloudflare account** (`wrangler login` or `CLOUDFLARE_API_TOKEN`). Provisioning shells out to wrangler and fails with a plain-English error without credentials — nothing was live-deployed during this build.
- **Workers Paid (~$5/month) is effectively required for PHP** — the free tier's CPU/request limits cannot run the interpreter.
- **No live verification yet**: preview deploys, real `wrangler tail` streaming, live rollbacks, and R2 usage queries were not exercised against a real account (all paths guard on credentials first). Dashboard job state is in-memory; history records persist in `~/.skyforge/deployments.json`.
- The `laravel-starter` template's bundle was validated by config/codegen checks only — packing needs a real `composer create-project` app.
