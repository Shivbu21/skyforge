# Skyforge compatibility table

What PHP can and cannot do on this runtime. Every row marked **verified**
was checked 2026-10-14 by booting the actual PHP 8.5.2 wasm interpreter
(the same binary the Worker runs) in a local harness and probing it.
Rows marked **documented** come from the upstream runtime's own docs and
were not independently re-verified.

## Interpreter

| Feature | Status | Note |
|---|---|---|
| PHP version | **verified** 8.5.2 | `PHP_VERSION` from the wasm binary |
| mbstring, json, pdo, sqlite3, openssl, zlib, dom, simplexml, filter | **verified** present | usable in app code |
| fileinfo | **verified** absent from binary, **polyfilled** by the Laravel bridge (`WasmMimeTypeGuesser`) | `mime_content_type()` works in Laravel apps via the bridge; plain PHP gets no MIME guessing — set content types yourself |
| gd | **verified** absent | no image manipulation in PHP; resize client-side or in a separate service |
| imagick | **verified** absent | same as gd |
| intl | **verified** absent | no `NumberFormatter`, no `Collator`; use plain string/number handling |
| iconv | **verified** absent | mbstring covers most conversions |

## Platform limits (the honest boundary)

| Feature | Status | Note |
|---|---|---|
| Outbound HTTP from PHP (`Http::`, Guzzle, `curl_*`) | **verified** impossible | `curl` extension absent; `fsockopen()` exists but fails (times out). The wasm build has no network stack. An outbound-fetch bridge is on the upstream roadmap, not here yet. |
| `exec()`, `shell_exec()`, `proc_open()` | **verified** present but inert | functions exist, return `false` immediately — no crash, no shell. Never rely on them. |
| `sleep()` / `usleep()` | **documented** no-op / works-in-harness | `sleep()` is a no-op on Workers; `usleep()` suspends correctly under JSPI in tests but don't build timing logic on it. |
| `cf_bindings_call()` (KV / R2 / cache) | **verified** present | compiled into the binary. Outside a Worker it returns a clean `{"ok":false}` error instead of crashing — the Skyforge storage helper uses this to fall back to local disk in dev. |
| Request concurrency | **documented** serialized per isolate | one PHP request at a time per isolate; Cloudflare spreads load across isolates (queue depth guard fails fast past 20). |
| Cold start | **documented** ~1s CPU | warm requests run in tens of ms. `--bake` pre-compiles OPcache to cut this. |
| Worker bundle | **documented** 10 MB gzipped (paid) | the 17.7 MB wasm binary gzips to ~5 MB; app code ships as static assets outside the bundle. **Workers Paid is effectively required** — the free tier's 10 ms CPU/request cannot run PHP. |

## Framework support in this fork

| Capability | Laravel | Plain PHP |
|---|---|---|
| Request serving | yes | yes |
| R2 storage | yes (bridge driver) | yes (`SkyforgeStorage` helper) |
| KV cache | yes (bridge driver) | yes (`cf_bindings_call` directly) |
| Atomic counters / locks | yes (Durable Object cache hub) | yes (same hub, via `cfbindings` `docache` ops) |
| D1 database | yes (`cfd1` PDO driver) | no — needs the bridge's PDO driver |
| Queues, mail, broadcast | yes | no — needs the bridge |
| Cron triggers | yes | rejected at deploy time with a clear error |

## What needs a real Cloudflare account (cannot be verified locally)

- `skyforge deploy` — provisioning (D1/R2/KV), asset publish, and publish all
  go through `wrangler`, which needs `wrangler login` or `CLOUDFLARE_API_TOKEN`.
- The dashboard's live R2 usage and D1 panels need an API token with
  Account: Read, R2: Read, D1: Read.
- Custom domains need the domain's DNS on Cloudflare (wrangler attaches the
  route; Cloudflare provisions the certificate).
