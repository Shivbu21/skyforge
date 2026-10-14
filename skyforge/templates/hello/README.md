# {{name}}

Plain-PHP app on Cloudflare Workers, scaffolded from the Skyforge **hello** template.

## What's inside

- `index.php` — tiny router: `/` (page), `/api/time` (JSON), `/api/visits`
  (KV-backed counter), `/files` + `/upload` (R2-backed file store demo)
- `lib/storage.php` — `SkyforgeStorage`: R2 on Workers, `./storage-dev/`
  on disk locally. Same API both ways.
- `lib/kv.php` — `SkyforgeKV`: KV on Workers, `./storage-dev/kv.json`
  locally. Same API both ways.

## Local dev

```sh
php -S localhost:8000
```

Open http://localhost:8000. Storage calls fall back to `./storage-dev/`
when the `cfbindings` extension is absent (i.e. everywhere except the Worker).

## Deploy

```sh
npm install          # installs @workersphp/cli
npx wrangler login   # once per machine (or set CLOUDFLARE_API_TOKEN)
skyforge deploy      # or: npm run deploy
```

`skyforge deploy` provisions the R2 bucket and KV namespace from
`skyforge.json`, packs the app, and publishes it. Needs a Cloudflare
account and the Workers Paid plan ($5/mo) — the free tier's CPU limit
cannot run PHP.

## Compatibility

Plain PHP here means: no outbound HTTP from PHP, no gd/imagick/intl/iconv,
no exec/proc_open, no D1 (that needs the Laravel bridge — see the
`laravel-starter` template). Full table: `docs/skyforge-compatibility.md`
in the Skyforge repo.
