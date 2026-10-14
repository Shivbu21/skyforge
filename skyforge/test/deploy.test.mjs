// Tests for skyforge/lib/deploy.mjs — argv building, auth checks (stubbed),
// and deployment records (tmp dir). No network, no real wrangler.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	buildDeployArgs, checkAuth, checkCliInstalled,
	recordDeployment, readDeployments,
} from '../lib/deploy.mjs';

const base = { name: 'demo', framework: 'plain', d1: null, r2: null, kv: null, queue: null, crons: [], broadcast: false, domain: null, bake: false, env: {} };

test('builds minimal argv for a plain app', () => {
	const args = buildDeployArgs(base);
	assert.deepEqual(args, ['deploy', '--app', '.', '--name', 'demo', '--framework', 'plain']);
});

test('maps every config knob to flags', () => {
	const args = buildDeployArgs({
		...base, framework: 'laravel', d1: 'db', r2: 'bucket', kv: 'ns',
		queue: 'jobs', crons: ['*/5 * * * *'], broadcast: true,
		domain: 'example.com', bake: true, env: { A: '1', B: '2' },
	});
	const joined = args.join(' ');
	for (const want of ['--d1 db', '--r2 bucket', '--kv ns', '--queue jobs', '--cron */5 * * * *',
		'--broadcast', '--domain example.com', '--bake', '--env A=1', '--env B=2', '--framework laravel']) {
		assert.ok(joined.includes(want), `missing: ${want}`);
	}
});

test('supports --no-deploy passthrough', () => {
	assert.ok(buildDeployArgs(base, { noDeploy: true }).includes('--no-deploy'));
});

test('checkAuth prefers CLOUDFLARE_API_TOKEN', () => {
	const r = checkAuth({ env: { CLOUDFLARE_API_TOKEN: 'x' }, run: () => { throw new Error('must not run'); } });
	assert.deepEqual(r, { ok: true, method: 'CLOUDFLARE_API_TOKEN' });
});

test('checkAuth accepts a logged-in wrangler', () => {
	const r = checkAuth({ env: {}, run: () => ({ status: 0, stdout: 'you@example.com' }) });
	assert.deepEqual(r, { ok: true, method: 'wrangler login' });
});

test('checkAuth fails with a helpful hint when logged out', () => {
	const r = checkAuth({ env: {}, run: () => ({ status: 1, stdout: '' }) });
	assert.equal(r.ok, false);
	assert.match(r.hint, /wrangler login/);
	assert.match(r.hint, /CLOUDFLARE_API_TOKEN/);
});

test('checkAuth fails gracefully when wrangler is missing', () => {
	const r = checkAuth({ env: {}, run: () => { throw new Error('spawn npx ENOENT'); } });
	assert.equal(r.ok, false);
	assert.match(r.hint, /could not run wrangler/);
});

test('checkCliInstalled detects the devDependency', () => {
	const dir = mkdtempSync(join(tmpdir(), 'skyforge-cli-'));
	assert.equal(checkCliInstalled({ cwd: dir, exists: () => false }).ok, false);
	assert.match(checkCliInstalled({ cwd: dir, exists: () => false }).hint, /npm install/);
	assert.equal(checkCliInstalled({ cwd: dir, exists: (p) => p.endsWith('.bin/workersphp') }).ok, true);
});

test('recordDeployment writes and upserts records', () => {
	const store = mkdtempSync(join(tmpdir(), 'skyforge-rec-'));
	assert.deepEqual(readDeployments(store), []);
	recordDeployment(store, { name: 'a', framework: 'plain', url: 'https://a.workers.dev', r2: 'a-uploads' });
	recordDeployment(store, { name: 'b', framework: 'laravel', domain: 'example.com', url: 'https://example.com', d1: 'b-db' });
	let list = readDeployments(store);
	assert.equal(list.length, 2);
	assert.equal(list[0].resources.r2, 'a-uploads');
	assert.ok(list[0].lastDeploy);
	// Upsert by name
	recordDeployment(store, { name: 'a', framework: 'plain', url: 'https://a.workers.dev', status: 'deployed' });
	list = readDeployments(store);
	assert.equal(list.length, 2);
	const raw = JSON.parse(readFileSync(join(store, 'deployments.json'), 'utf8'));
	assert.ok(Array.isArray(raw.deployments));
});
