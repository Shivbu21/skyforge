// Tests for skyforge/lib/config.mjs — pure validation logic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateConfig, normalizeConfig, loadConfig } from '../lib/config.mjs';

test('accepts a minimal valid config', () => {
	assert.deepEqual(validateConfig({ name: 'my-app' }), []);
});

test('accepts a full config', () => {
	const errors = validateConfig({
		name: 'my-app', framework: 'laravel', d1: 'my-db', r2: 'my-bucket',
		kv: 'my-kv', queue: 'jobs', crons: ['*/5 * * * *'], broadcast: true,
		domain: 'example.com', bake: false, env: { FOO: 'bar' },
	});
	assert.deepEqual(errors, []);
});

test('rejects bad names', () => {
	for (const name of [undefined, '', 'My App', 'UPPER', 'has space', 'under_score']) {
		assert.ok(validateConfig({ name }).length > 0, `expected error for name=${name}`);
	}
});

test('rejects bad framework, domain, r2, crons, env', () => {
	assert.ok(validateConfig({ name: 'a', framework: 'django' }).length);
	assert.ok(validateConfig({ name: 'a', domain: 'not a domain' }).length);
	assert.ok(validateConfig({ name: 'a', r2: 'UPPER_BUCKET' }).length);
	assert.ok(validateConfig({ name: 'a', crons: '*/5 * * * *' }).length);
	assert.ok(validateConfig({ name: 'a', env: { K: 42 } }).length);
	assert.ok(validateConfig({ name: 'a', broadcast: 'yes' }).length);
});

test('rejects non-objects', () => {
	assert.ok(validateConfig(null).length);
	assert.ok(validateConfig([]).length);
	assert.ok(validateConfig('nope').length);
});

test('normalizeConfig fills defaults', () => {
	const c = normalizeConfig({ name: 'a' });
	assert.equal(c.framework, 'plain');
	assert.equal(c.d1, null);
	assert.deepEqual(c.crons, []);
	assert.equal(c.broadcast, false);
	assert.deepEqual(c.env, {});
});

test('loadConfig reads and validates a file', () => {
	const dir = mkdtempSync(join(tmpdir(), 'skyforge-cfg-'));
	writeFileSync(join(dir, 'skyforge.json'), JSON.stringify({ name: 'demo', framework: 'plain' }));
	const c = loadConfig(dir);
	assert.equal(c.name, 'demo');
	assert.equal(c.framework, 'plain');
});

test('loadConfig throws clearly when missing or invalid', () => {
	const dir = mkdtempSync(join(tmpdir(), 'skyforge-cfg-'));
	assert.throws(() => loadConfig(dir), /run "skyforge init" first/);
	writeFileSync(join(dir, 'skyforge.json'), '{not json');
	assert.throws(() => loadConfig(dir), /not valid JSON/);
	writeFileSync(join(dir, 'skyforge.json'), JSON.stringify({ name: 'BAD NAME' }));
	assert.throws(() => loadConfig(dir), /problem\(s\)/);
});
