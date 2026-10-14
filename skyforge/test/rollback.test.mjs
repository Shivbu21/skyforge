// Tests for skyforge/lib/rollback.mjs — candidate selection, target
// resolution, and the worktree-based rollback flow. All side effects
// stubbed: no git, no network, no fs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
	doRollback, rollbackCandidates, resolveTarget, describeTarget,
} from '../lib/rollback.mjs';

const deployments = [{
	name: 'demo',
	history: [
		{ id: 'dep_1', type: 'production', commit: 'aaa', branch: 'main', at: '2026-10-10T10:00:00Z', status: 'active' },
		{ id: 'dep_2', type: 'production', commit: 'bbb', branch: 'main', at: '2026-10-12T10:00:00Z', status: 'superseded' },
		{ id: 'dep_3', type: 'preview', commit: 'ccc', at: '2026-10-13T10:00:00Z', status: 'active' },
		{ id: 'dep_4', type: 'rollback', commit: 'aaa', branch: 'main', at: '2026-10-11T10:00:00Z', status: 'superseded' },
		{ id: 'dep_5', type: 'production', commit: null, at: '2026-10-09T10:00:00Z', status: 'superseded' },
	],
}];

test('rollbackCandidates keeps production/rollback entries with commits, newest first', () => {
	const c = rollbackCandidates(deployments, 'demo');
	assert.deepEqual(c.map((e) => e.id), ['dep_2', 'dep_4', 'dep_1']);
});

test('rollbackCandidates is empty for unknown projects', () => {
	assert.deepEqual(rollbackCandidates(deployments, 'nope'), []);
});

test('resolveTarget defaults to the latest superseded entry', () => {
	const c = rollbackCandidates(deployments, 'demo');
	assert.equal(resolveTarget(c, null).id, 'dep_2');
});

test('resolveTarget matches an explicit id prefix', () => {
	const c = rollbackCandidates(deployments, 'demo');
	assert.equal(resolveTarget(c, 'dep_2').id, 'dep_2');
	assert.equal(resolveTarget(c, 'dep_').id, 'dep_2');
});

test('resolveTarget errors helpfully with no match or nothing to roll back to', () => {
	const c = rollbackCandidates(deployments, 'demo');
	assert.throws(() => resolveTarget(c, 'zzz'), /no deployment matches/);
	assert.throws(() => resolveTarget([{ id: 'only', status: 'active' }], null), /nothing to roll back to/);
});

test('describeTarget renders a one-liner', () => {
	const s = describeTarget({ id: 'dep_1', branch: 'main', commit: 'aabbccdd', at: '2026-10-10T10:00:00Z', status: 'active' });
	assert.match(s, /dep_1/);
	assert.match(s, /main/);
	assert.match(s, /aabbccdd/);
	assert.match(s, /\[current\]/);
});

function rollbackDeps(over = {}) {
	const calls = { added: [], removed: [], ran: [] };
	const recorded = [];
	return {
		calls, recorded,
		deps: {
			checkCli: () => ({ ok: true }),
			auth: () => ({ ok: true, method: 'test' }),
			read: () => deployments,
			commitCheck: () => true,
			worktreeAdd: (dir, commit) => { calls.added.push([dir, commit]); return { status: 0 }; },
			worktreeRemove: (dir) => { calls.removed.push(dir); },
			run: async (cmd, argv, opts) => { calls.ran.push({ cmd, argv, opts }); return { status: 0, output: 'deployed\n' }; },
			record: (dir, name, entry) => { recorded.push(entry); return { deployments: [], entry: { id: 'dep_new', ...entry } }; },
			mkDir: () => '/tmp/skyforge-rollback-test',
			loadCfg: null,
			...over,
		},
	};
}

const config = { name: 'demo', framework: 'plain', domain: null };

test('doRollback checks out the target commit in a worktree and deploys it', async () => {
	const { deps, calls, recorded } = rollbackDeps();
	const { url, entryId } = await doRollback({ config, cwd: '/repo', storeDir: '/s', targetId: 'dep_2', deps });
	assert.deepEqual(calls.added, [['/tmp/skyforge-rollback-test', 'bbb']]);
	assert.deepEqual(calls.removed, ['/tmp/skyforge-rollback-test']);
	const deployCall = calls.ran[0];
	assert.equal(deployCall.cmd, 'npx');
	assert.ok(deployCall.argv.includes('workersphp'), deployCall.argv.join(' '));
	assert.ok(deployCall.argv.includes('--app'), 'must deploy the worktree, not the working tree');
	assert.ok(deployCall.argv.includes('/tmp/skyforge-rollback-test'));
	assert.equal(url, 'https://demo.workers.dev');
	assert.equal(entryId, 'dep_new');
	assert.equal(recorded[0].type, 'rollback');
	assert.equal(recorded[0].rollbackOf, 'dep_2');
	assert.equal(recorded[0].commit, 'bbb');
});

test('doRollback uses the worktree skyforge.json when available', async () => {
	const { deps, calls } = rollbackDeps({
		loadCfg: (dir) => ({ name: 'demo', framework: 'plain', domain: 'old.example.com' }),
	});
	const { url } = await doRollback({ config, cwd: '/repo', storeDir: '/s', targetId: 'dep_2', deps });
	assert.equal(url, 'https://old.example.com');
	assert.ok(calls.ran[0].argv.includes('old.example.com'));
});

test('doRollback refuses when the commit is missing locally', async () => {
	const { deps } = rollbackDeps({ commitCheck: () => false });
	await assert.rejects(
		doRollback({ config, cwd: '/repo', storeDir: '/s', targetId: 'dep_2', deps }),
		/not available in this repo/,
	);
});

test('doRollback fails fast without auth and cleans up the worktree on deploy failure', async () => {
	const { deps } = rollbackDeps({ auth: () => ({ ok: false, hint: 'log in' }) });
	await assert.rejects(doRollback({ config, cwd: '/repo', storeDir: '/s', targetId: 'dep_2', deps }), /log in/);

	const bad = rollbackDeps({ run: async () => ({ status: 1, output: 'x' }) });
	await assert.rejects(
		doRollback({ config, cwd: '/repo', storeDir: '/s', targetId: 'dep_2', deps: bad.deps }),
		/production is untouched/,
	);
	assert.deepEqual(bad.calls.removed, ['/tmp/skyforge-rollback-test'], 'worktree must be removed even on failure');
	assert.equal(bad.recorded.length, 0, 'failed rollbacks are not recorded');
});
