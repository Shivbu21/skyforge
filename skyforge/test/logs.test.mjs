// Tests for skyforge/lib/logs.mjs and skyforge/lib/exec.mjs.
// No network, no wrangler: everything stubbed or faked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { tailLogs, deploymentLog } from '../lib/logs.mjs';
import { runTee, tailLines } from '../lib/exec.mjs';

test('tailLines keeps the last N lines', () => {
	assert.equal(tailLines('a\nb\nc\nd', 2), 'c\nd');
	assert.equal(tailLines('', 10), '');
	assert.equal(tailLines(null), '');
});

function fakeSpawn(chunks, status) {
	return () => {
		const child = new EventEmitter();
		child.stdout = new EventEmitter();
		child.stderr = new EventEmitter();
		process.nextTick(() => {
			for (const c of chunks) child.stdout.emit('data', Buffer.from(c));
			child.emit('close', status);
		});
		return child;
	};
}

test('runTee resolves status and keeps a capped tail', async () => {
	const r = await runTee('x', ['y'], { spawnFn: fakeSpawn(['one\n', 'two\n'], 0) });
	assert.equal(r.status, 0);
	assert.equal(r.output, 'one\ntwo\n');
	const fail = await runTee('x', [], { spawnFn: fakeSpawn([], 3) });
	assert.equal(fail.status, 3);
});

test('runTee rejects when the process cannot start', async () => {
	await assert.rejects(
		runTee('x', [], { spawnFn: () => { throw new Error('ENOENT'); } }),
		/ENOENT/,
	);
});

test('tailLogs requires a worker name and auth', () => {
	assert.throws(() => tailLogs({}), /no worker name/);
	assert.throws(
		() => tailLogs({ workerName: 'w', deps: { auth: () => ({ ok: false, hint: 'log in' }) } }),
		/log in/,
	);
});

test('tailLogs surfaces wrangler failures honestly', () => {
	assert.throws(
		() => tailLogs({ workerName: 'w', deps: { auth: () => ({ ok: true }), spawnTail: () => { throw new Error('nope'); } } }),
		/could not start wrangler tail/,
	);
	assert.throws(
		() => tailLogs({ workerName: 'w', deps: { auth: () => ({ ok: true }), spawnTail: () => ({ status: 1 }) } }),
		/exited with code 1/,
	);
	const ok = tailLogs({ workerName: 'w', deps: { auth: () => ({ ok: true }), spawnTail: () => ({ status: 0 }) } });
	assert.deepEqual(ok, { ok: true });
});

const deployments = [{
	name: 'demo',
	history: [
		{ id: 'dep_abc', type: 'production', url: 'https://demo.workers.dev', at: '2026-10-14T10:00:00Z', branch: 'main', commit: 'deadbeef', status: 'active', logTail: 'line1\nline2' },
		{ id: 'dep_def', type: 'preview', url: 'https://u', at: '2026-10-14T11:00:00Z', status: 'active' },
	],
}];

test('deploymentLog returns metadata and the captured tail', () => {
	const info = deploymentLog({ storeDir: '/s', deploymentId: 'dep_abc', deps: { read: () => deployments } });
	assert.equal(info.project, 'demo');
	assert.equal(info.logTail, 'line1\nline2');
	assert.match(info.note, /captured by skyforge/);
});

test('deploymentLog matches id prefixes and is honest when nothing was captured', () => {
	const info = deploymentLog({ storeDir: '/s', deploymentId: 'dep_d', deps: { read: () => deployments } });
	assert.equal(info.id, 'dep_def');
	assert.equal(info.logTail, null);
	assert.match(info.note, /does not retain historical worker logs/);
	assert.throws(
		() => deploymentLog({ storeDir: '/s', deploymentId: 'zzz', deps: { read: () => deployments } }),
		/no deployment matches/,
	);
});
