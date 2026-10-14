# {{name}}

Laravel on Cloudflare Workers, scaffolded from the Skyforge
**laravel-starter** template. This directory is the wiring — you create
the Laravel app inside it.

## 1. Create the Laravel app

```sh
composer create-project laravel/laravel .
composer require workersphp/laravel-bridge
npm install          # installs @workersphp/cli
```

Requires Composer and PHP 8.3 locally (bake mode compiles your app to
opcache for the Worker).

## 2. Wire the bridge

In `config/database.php`, add the `cfd1` connection (the bridge ships the
driver; you only register it):

```php
'cfd1' => [
    'driver' => 'cfd1',
    'database' => env('DB_DATABASE', 'default'),
],
```

`skyforge deploy` sets `DB_CONNECTION=cfd1`, `FILESYSTEM_DISK=r2`, and
`CACHE_STORE=kv` automatically when `skyforge.json` configures d1/r2/kv
(as this template does). Locally, keep the default sqlite/mysql drivers
— the bridge drivers only activate inside the Worker.

## 3. Deploy

```sh
npx wrangler login   # once per machine (or set CLOUDFLARE_API_TOKEN)
skyforge deploy      # or: npm run deploy
```

This provisions the D1 database, R2 bucket, and KV namespace from
`skyforge.json`, bakes the app, and publishes. Needs a Cloudflare
account and Workers Paid ($5/mo). Set `domain` in `skyforge.json` to
attach a custom domain.

## What D1 gives you here

D1 is SQLite at the edge — real relational queries and transactions via
the bridge. Limits vs. MySQL: no stored procedures, modest per-query size
caps; the bridge docs list the current edges.
