# Changelog

All notable changes to this project will be documented in this file. The
format follows Keep a Changelog; versions follow semver (0.x: expect movement).

## [Unreleased]

### Skyforge product layer (fork additions)

- Deploy CLI: `--framework plain|laravel` with auto-detection; plain-PHP
  codegen via the runtime's `vanillaAdapter`; plain pack/publish; Laravel-only
  flags rejected for plain apps with clear errors; `APP_KEY` upload skipped
  for plain apps. Laravel codegen output unchanged (golden tests green).
- `skyforge` CLI (`skyforge/bin/skyforge.mjs`): `init` (plain/Laravel
  scaffolding), `deploy` (config validation, credential checks, deployment
  records), `dashboard` (local usage UI), `list`, `help`.
- R2 storage helper for plain PHP (`SkyforgeStorage`): R2 on Workers, local
  disk fallback in dev.
- Dashboard: deployments table, per-bucket R2 usage (GraphQL), D1 databases;
  light theme; API token kept in memory only.
- Docs: `docs/skyforge-guide.md` (end-to-end), `docs/skyforge-compatibility.md`
  (probe-verified boundary table).

## [0.1.0] - TBD

Initial public release.

- Framework-agnostic runtime (`@workersphp/runtime`): resident PHP 8.5 wasm
  interpreter per isolate, ZipFS lazy filesystem, request bridge, outbox
  flushes, cfbindings handler, BroadcastHub and CacheHub Durable Objects,
  frozen-clock nudge.
- Laravel adapter (`@workersphp/laravel`): dispatch scripts, warmup,
  pack/bake toolchain.
- Deploy CLI (`@workersphp/cli`): `workersphp deploy` provisions D1, Queues,
  R2 and KV, packs, bakes and deploys in one command.
- Laravel drivers (`workersphp/laravel-bridge`): cfd1 database, kv and do
  cache stores (atomic counters + real locks), r2 filesystem, cloudflare
  queue/mail/broadcast drivers, fileinfo polyfill, wasm MIME guesser.
- PHP 8.5.2 binary (`@workersphp/php-wasm-jspi`): JSPI + wasm exceptions +
  cfbindings, reproducible from build-php/REBUILD.md.
