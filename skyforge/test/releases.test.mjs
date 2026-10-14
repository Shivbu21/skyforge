// Tests for skyforge/lib/releases.mjs — history model, git metadata
// (stubbed), and confirmation. No network, no real git, no real fs
// (in-memory store doubles).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
	newDeployId, appendHistory, getHistory, findEntryById, activePreviews,
	markPreviewCleaned, gitMeta, commitExists, confirmAction,
} from '../lib/releases.mjs';

function memStore() {
	let data = { deployments: [] };
	return {
		read: () => JSON.parse(JSON.stringify(data.deployments)),
		write: (dir, deployments) => { data = { deployments: JSON.parse(JSON.stringify(deployments)) }; },
		get data() { return data; },
	};
}

test('newDeployId has the dep_YYYYMMDD_xxxxxx shape and varies', () => {
	const fixed = new Date('2026-10-14T12:00:00Z');
	const a = newDeployId({ rand: () => 0.1, now: () => fixed });
	const b = newDeployId({ rand: () => 0.9, now: () => fixed });
	assert.match(a, /^dep_20261014_[0-9a-f]{6}$/);
	assert.notEqual(a, b);
});

test('appendHistory creates the project record and appends', () => {
	const s = memStore();
	const { entry } = appendHistory('/x', 'demo', { type: 'production', url: 'https://demo.workers.dev' }, { ...s, now: () => '2026-10-14T10:00:00Z' });
	assert.equal(entry.type, 'production');
	assert.equal(entry.status, 'active');
	const list = getHistory(s.data.deployments, 'demo');
	assert.equal(list.length, 1);
	assert.equal(list[0].id, entry.id);
});

test('a new production entry supersedes the old active one', () => {
	const s = memStore();
	appendHistory('/x', 'demo', { type: 'production', url: 'https://a' }, { ...s, now: () => '2026-10-14T10:00:00Z' });
	appendHistory('/x', 'demo', { type: 'production', url: 'https://b' }, { ...s, now: () => '2026-10-14T11:00:00Z' });
	const list = getHistory(s.data.deployments, 'demo');
	assert.equal(list.length, 2);
	assert.equal(list[0].url, 'https://b');
	assert.equal(list[0].status, 'active');
	assert.equal(list[1].status, 'superseded');
	// top-level record follows the latest production entry
	assert.equal(s.data.deployments[0].url, 'https://b');
});

test('preview entries never supersede production, and keep workerName', () => {
	const s = memStore();
	appendHistory('/x', 'demo', { type: 'production', url: 'https://demo.workers.dev' }, { ...s });
	appendHistory('/x', 'demo', { type: 'preview', url: 'https://demo-preview-abc123.workers.dev', workerName: 'demo-preview-abc123' }, { ...s });
	const list = getHistory(s.data.deployments, 'demo');
	const prod = list.find((h) => h.type === 'production');
	const prev = list.find((h) => h.type === 'preview');
	assert.equal(prod.status, 'active');
	assert.equal(prev.workerName, 'demo-preview-abc123');
	assert.equal(s.data.deployments[0].url, 'https://demo.workers.dev');
});

test('getHistory sorts newest first; findEntryById searches all projects', () => {
	const s = memStore();
	appendHistory('/x', 'a', { type: 'production' }, { ...s, now: () => '2026-10-14T09:00:00Z' });
	appendHistory('/x', 'b', { type: 'preview' }, { ...s, now: () => '2026-10-14T10:00:00Z' });
	const found = findEntryById(s.data.deployments, s.data.deployments[1].history[0].id);
	assert.equal(found.project, 'b');
	assert.equal(found.entry.type, 'preview');
	assert.equal(findEntryById(s.data.deployments, 'nope'), null);
});

test('activePreviews only returns non-cleaned previews', () => {
	const s = memStore();
	const r1 = appendHistory('/x', 'demo', { type: 'preview', url: 'https://u1' }, { ...s });
	const r2 = appendHistory('/x', 'demo', { type: 'preview', url: 'https://u2' }, { ...s });
	markPreviewCleaned('/x', r1.entry.id, s);
	const previews = activePreviews(s.data.deployments);
	assert.equal(previews.length, 1);
	assert.equal(previews[0].entry.id, r2.entry.id);
	assert.equal(markPreviewCleaned('/x', 'nope', s), null);
});

test('gitMeta returns nulls outside a git repo and never throws', () => {
	const m = gitMeta({ run: () => ({ status: 128, stdout: '' }), cwd: '/tmp' });
	assert.deepEqual(m, { branch: null, commit: null, dirty: false });
	const throwing = gitMeta({ run: () => { throw new Error('no git'); }, cwd: '/tmp' });
	assert.deepEqual(throwing, { branch: null, commit: null, dirty: false });
});

test('gitMeta parses branch/commit/dirty', () => {
	const m = gitMeta({
		cwd: '/tmp',
		run: (args) => {
			if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') return { status: 0, stdout: 'true\n' };
			if (args[1] === '--abbrev-ref') return { status: 0, stdout: 'main\n' };
			if (args[1] === 'HEAD' && args[0] === 'rev-parse') return { status: 0, stdout: 'abc123\n' };
			if (args[0] === 'status') return { status: 0, stdout: ' M file\n' };
			return { status: 1, stdout: '' };
		},
	});
	assert.deepEqual(m, { branch: 'main', commit: 'abc123', dirty: true });
});

test('commitExists checks the object database', () => {
	assert.equal(commitExists('abc', { run: () => ({ status: 0 }), cwd: '/tmp' }), true);
	assert.equal(commitExists('abc', { run: () => ({ status: 1 }), cwd: '/tmp' }), false);
	assert.equal(commitExists(null, { run: () => { throw new Error('must not run'); } }), false);
});

test('confirmAction delegates to the injected ask', async () => {
	assert.equal(await confirmAction('x?', { ask: async () => true }), true);
	assert.equal(await confirmAction('x?', { ask: async () => false }), false);
});
