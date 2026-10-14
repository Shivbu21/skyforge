// Codegen goldens. The single most protected value here is the Durable
// Object migrations ledger: it is APPEND-ONLY on live workers — reordering,
// renaming a tag, or renaming a DO class destroys live Durable Object state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/codegen.mjs';
import { parseArgs } from '../src/args.mjs';
import { UsageError } from '../src/constants.mjs';

const CHIRPER_FLAGS = [
  'deploy', '--app', 'apps/chirper', '--name', 'php-chirper',
  '--d1', 'php-chirper', '--queue', 'php-chirper-jobs', '--broadcast',
  '--r2', 'php-chirper-storage', '--kv', 'php-chirper-cache',
  '--cron', '*/15 * * * *', '--bake', '--domain', 'workersphp.dev',
];

const STARTER_FLAGS = ['deploy', '--app', 'apps/starter', '--name', 'php-starter', '--d1', 'php-starter', '--bake'];

test('full-fat config pins the append-only migrations ledger', () => {
  const options = parseArgs(CHIRPER_FLAGS);
  const { wranglerConfig } = generate(options, { d1Id: 'D1-ID', kvId: 'KV-ID' });

  // GOLDEN — do not edit without understanding DO migration semantics.
  assert.deepEqual(wranglerConfig.migrations, [
    { tag: 'broadcast-v1', new_sqlite_classes: ['BroadcastHub'] },
    { tag: 'cache-v1', new_sqlite_classes: ['CacheHub'] },
  ]);
  assert.deepEqual(wranglerConfig.durable_objects.bindings, [
    { name: 'BROADCAST_HUB', class_name: 'BroadcastHub' },
    { name: 'CACHE_HUB', class_name: 'CacheHub' },
  ]);

  assert.deepEqual(wranglerConfig.queues, {
    producers: [{ binding: 'QUEUE', queue: 'php-chirper-jobs' }],
    consumers: [{ queue: 'php-chirper-jobs', max_batch_size: 10, max_batch_timeout: 0 }],
  });
  assert.deepEqual(wranglerConfig.routes, [
    { pattern: 'workersphp.dev', custom_domain: true },
    { pattern: 'www.workersphp.dev', custom_domain: true },
  ]);
  assert.deepEqual(wranglerConfig.d1_databases, [
    { binding: 'DB', database_name: 'php-chirper', database_id: 'D1-ID' },
  ]);
  assert.deepEqual(wranglerConfig.kv_namespaces, [{ binding: 'CACHE', id: 'KV-ID' }]);
  assert.equal(wranglerConfig.assets.run_worker_first, true);
  assert.equal(wranglerConfig.limits.cpu_ms, 30000);
});

test('minimal config carries only the cache-v1 migration', () => {
  const { wranglerConfig } = generate(parseArgs(STARTER_FLAGS), { d1Id: 'D1-ID' });
  assert.deepEqual(wranglerConfig.migrations, [
    { tag: 'cache-v1', new_sqlite_classes: ['CacheHub'] },
  ]);
  assert.deepEqual(wranglerConfig.durable_objects.bindings, [
    { name: 'CACHE_HUB', class_name: 'CacheHub' },
  ]);
  assert.equal(wranglerConfig.queues, undefined);
  assert.equal(wranglerConfig.routes, undefined);
});

test('worker source uses bare package specifiers and wires every flag', () => {
  const { workerSource } = generate(parseArgs(CHIRPER_FLAGS), { d1Id: 'x', kvId: 'y' });
  for (const marker of [
    "from '@workersphp/laravel'",
    "from '@workersphp/runtime/src/CacheHub.mjs'",
    "from '@workersphp/runtime/src/BroadcastHub.mjs'",
    "from '@workersphp/php-wasm-jspi/php8.5-web.mjs'",
    '"DB_CONNECTION":"cfd1"',
    '"cache.limiter":"do"',
    "broadcastBinding: 'BROADCAST_HUB'",
    "r2Binding: 'STORAGE'",
    "kvBinding: 'CACHE'",
    "cacheHubBinding: 'CACHE_HUB'",
    'env.QUEUE.send',
  ]) {
    assert.ok(workerSource.includes(marker), `missing: ${marker}`);
  }
});

test('the wasm variant flag steers the binary import', () => {
  const options = parseArgs([...STARTER_FLAGS, '--wasm', 'php-wasm-85-ours']);
  const { workerSource } = generate(options, {});
  assert.ok(workerSource.includes('vendor/php-wasm-85-ours/php8.5-web.mjs'));
});

test('argument validation refuses malformed input', () => {
  assert.throws(() => parseArgs(['deploy']), UsageError);
  assert.throws(() => parseArgs(['deploy', '--app', 'x', '--name', 'Bad_Name']), UsageError);
  assert.throws(() => parseArgs(['deploy', '--app', 'x', '--name', 'ok', '--email', 'not-an-address']), UsageError);
  assert.throws(() => parseArgs(['nonsense']), UsageError);
  assert.throws(() => parseArgs(['deploy', '--app', 'x', '--name', 'ok', '--framework', 'django']), UsageError);
});

// --- Skyforge: plain-PHP framework support (fork addition) ---

const PLAIN_FLAGS = ['deploy', '--app', 'apps/plain-demo', '--name', 'php-plain',
  '--framework', 'plain', '--r2', 'plain-uploads', '--kv', 'plain-cache',
  '--domain', 'example.com'];

test('plain framework generates a vanilla worker, not a Laravel one', () => {
  const options = parseArgs(PLAIN_FLAGS);
  assert.equal(options.framework, 'plain');
  const { workerSource, wranglerConfig } = generate(options, { kvId: 'KV-ID' });
  for (const marker of [
    "from '@workersphp/runtime/src/worker.mjs'",
    "from '@workersphp/runtime/src/vanilla.mjs'",
    'vanillaAdapter(',
    "r2Binding: 'STORAGE'",
    "kvBinding: 'CACHE'",
    "cacheHubBinding: 'CACHE_HUB'",
  ]) {
    assert.ok(workerSource.includes(marker), `missing: ${marker}`);
  }
  for (const absent of ['createLaravelWorker', 'laravelAdapter', 'DB_CONNECTION', 'APP_KEY']) {
    assert.ok(!workerSource.includes(absent), `should not contain: ${absent}`);
  }
  // Same append-only migrations ledger, cache hub only.
  assert.deepEqual(wranglerConfig.migrations, [
    { tag: 'cache-v1', new_sqlite_classes: ['CacheHub'] },
  ]);
  assert.deepEqual(wranglerConfig.r2_buckets, [{ binding: 'STORAGE', bucket_name: 'plain-uploads' }]);
  assert.deepEqual(wranglerConfig.kv_namespaces, [{ binding: 'CACHE', id: 'KV-ID' }]);
  assert.deepEqual(wranglerConfig.routes, [
    { pattern: 'example.com', custom_domain: true },
    { pattern: 'www.example.com', custom_domain: true },
  ]);
  assert.equal(wranglerConfig.d1_databases, undefined);
  assert.equal(wranglerConfig.queues, undefined);
});

test('unset framework still generates the Laravel worker (backwards compatible)', () => {
  const options = parseArgs(CHIRPER_FLAGS);
  assert.equal(options.framework, undefined);
  const { workerSource } = generate(options, { d1Id: 'x', kvId: 'y' });
  assert.ok(workerSource.includes('createLaravelWorker'));
});
