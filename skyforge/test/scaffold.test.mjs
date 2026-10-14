// Tests for skyforge/lib/scaffold.mjs — template generation is pure;
// the writer is exercised against a tmp dir.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { templateFiles, initProject } from '../lib/scaffold.mjs';

test('plain template has all expected files', () => {
	const files = templateFiles('demo-app', 'plain');
	for (const f of ['index.php', 'lib/storage.php', 'style.css', 'skyforge.json', 'package.json', '.gitignore', 'README.md']) {
		assert.ok(files[f], `missing ${f}`);
	}
});

test('plain skyforge.json wires r2 + kv with the project name', () => {
	const cfg = JSON.parse(templateFiles('demo-app', 'plain')['skyforge.json']);
	assert.equal(cfg.name, 'demo-app');
	assert.equal(cfg.framework, 'plain');
	assert.equal(cfg.r2, 'demo-app-uploads');
	assert.equal(cfg.kv, 'demo-app-cache');
	assert.equal(cfg.d1, null); // plain PHP has no D1 driver
});

test('plain index.php requires the storage helper and handles routes', () => {
	const php = templateFiles('demo-app', 'plain')['index.php'];
	assert.match(php, /require __DIR__ . '\/lib\/storage\.php'/);
	assert.match(php, /\/api\/time/);
	assert.match(php, /\/upload/);
	assert.match(php, /\/files/);
	assert.match(php, /new SkyforgeStorage\(\)/);
});

test('storage helper degrades gracefully without cfbindings', () => {
	const helper = templateFiles('demo-app', 'plain')['lib/storage.php'];
	assert.match(helper, /function_exists\('cf_bindings_call'\)/);
	assert.match(helper, /storage-dev/);
	for (const m of ['function put(', 'function get(', 'function list(', 'function delete(']) {
		assert.ok(helper.includes(m), `missing ${m}`);
	}
});

test('storage helper calls the r2 binding with the documented wire shape', () => {
	const helper = templateFiles('demo-app', 'plain')['lib/storage.php'];
	// Must match packages/runtime/src/bindings.mjs: {kind, op, args}
	assert.match(helper, /'kind' => 'r2', 'op' => \$op, 'args' => \$args/);
	assert.match(helper, /base64_encode\(\$body\)/); // put expects base64 body
	assert.match(helper, /base64_decode\(\$value\['body'\]\)/); // get returns base64 body
});

test('laravel template has wiring guide, no php files', () => {
	const files = templateFiles('demo-app', 'laravel');
	assert.ok(files['skyforge.json']);
	assert.ok(files['.env.example']);
	assert.ok(files['README.md']);
	assert.match(files['README.md'], /composer create-project/);
	assert.match(files['README.md'], /workersphp\/laravel-bridge/);
	assert.ok(!files['index.php']);
	const cfg = JSON.parse(files['skyforge.json']);
	assert.equal(cfg.framework, 'laravel');
	assert.equal(cfg.d1, 'demo-app-db');
});

test('rejects bad project names and frameworks', () => {
	assert.throws(() => templateFiles('Bad Name', 'plain'), /lowercase/);
	assert.throws(() => templateFiles('ok', 'django'), /unknown framework/);
});

test('initProject writes files to disk', () => {
	const dir = mkdtempSync(join(tmpdir(), 'skyforge-init-'));
	const written = initProject(dir, 'my-proj', 'plain');
	assert.ok(written.includes('index.php'));
	assert.ok(existsSync(join(dir, 'index.php')));
	assert.ok(existsSync(join(dir, 'lib', 'storage.php')));
	const cfg = JSON.parse(readFileSync(join(dir, 'skyforge.json'), 'utf8'));
	assert.equal(cfg.name, 'my-proj');
});
