# {{name}}

JSON REST API in plain PHP on Cloudflare Workers, scaffolded from the
Skyforge **json-api** template. Notes CRUD over KV.

## Endpoints

| Method | Path              | Body                  | Result        |
|--------|-------------------|-----------------------|---------------|
| GET    | `/api/notes`      | —                     | 200, list     |
| POST   | `/api/notes`      | `{title, body?}`      | 201, the note |
| GET    | `/api/notes/{id}` | —                     | 200 or 404    |
| PUT    | `/api/notes/{id}` | `{title?, body?}`     | 200 or 404    |
| DELETE | `/api/notes/{id}` | —                     | 204 or 404    |

Validation failures return 422 with an `error` message.

## Local dev

```sh
php -S localhost:8000
curl -X POST localhost:8000/api/notes \
  -H 'Content-Type: application/json' \
  -d '{"title":"first note","body":"hello from plain PHP"}'
curl localhost:8000/api/notes
```

KV falls back to `./storage-dev/kv.json` on disk locally.

## Deploy

```sh
npm install
npx wrangler login   # once per machine (or set CLOUDFLARE_API_TOKEN)
skyforge deploy
```

Provisions the KV namespace from `skyforge.json` and publishes. Needs a
Cloudflare account and Workers Paid ($5/mo).

## Honest limits

- **KV is eventually consistent.** Two writes in a row can briefly read
  stale — fine for a starter API, wrong for ledgers. Need strong
  consistency or relational queries? Use the `laravel-starter` template
  (D1 via the Laravel bridge).
- CORS is wide open (`*`) for local dev — tighten `index.php` before
  production.
- No auth in this starter — add your own (e.g. a bearer token checked
  against an env var) before exposing real data.
- Plain-PHP limits apply: no outbound HTTP from PHP, no D1, no
  gd/imagick/intl/iconv. Full table: `docs/skyforge-compatibility.md`
  in the Skyforge repo.
