// Tests for skyforge/lib/preview.mjs — naming, preview orchestration and
// cleanup. All side effects stubbed: no network, no wrangler, no fs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { doPreview, cleanPreviews, previewWorkerName, shortId } from '../lib/preview.mjs';

const okCli = () => ({ ok: true });
const okAuth = () => ({ ok: true, method: 'test' });
const noGit = () => ({ branch: null, commit: null, dirty: false });
const records = [];
const fakeRecord = (dir, name, entry) => {
	const e = { id: entry.id || 'dep_20261014_abcdef', ...entry };
	records.push(e);
	return { deployments: [], entry: e };
};

function baseDeps(over = {}) {
	return {
		checkCli: okCli,
		auth: okAuth,
		git: noGit,
		run: async () => ({ status: 0, output: 'ok\n' }),
		record: fakeRecord,
		makeId: () => 'dep_20261014_9f3a2b',
		...over,
	};
}

const config = { name: 'demo', framework: 'plain', d1: 'db', r2: 'bucket', domain: 'example.com' };

test('previewWorkerName sanitizes the project name', () => {
	assert.equal(previewWorkerName('demo', '9f3a2b'), 'demo-preview-9f3a2b');
	assert.equal(previewWorkerName('My_App!', 'aa11bb'), 'my-app-preview-aa11bb');
});

test('shortId takes the trailing segment', () => {
	assert.equal(shortId('dep_20261014_9f3a2b'), '9f3a2b');
});

test('doPreview deploys under a preview name without the prod domain', async () => {
	records.length = 0;
	let seenArgs;
	const { id, workerName, url } = await doPreview({
		config, cwd: '/x', storeDir: '/s',
		deps: baseDeps({ run: async (cmd, argv) => { seenArgs = argv; return { status: 0, output: '' }; } }),
	});
	assert.equal(id, 'dep_20261014_9f3a2b');
	assert.equal(workerName, 'demo-preview-9f3a2b');
	assert.equal(url, 'https://demo-preview-9f3a2b.workers.dev');
	const joined = seenArgs.join(' ');
	assert.ok(joined.includes('--name demo-preview-9f3a2b'), joined);
	assert.ok(!joined.includes('--domain'), 'preview must not take the production domain');
	assert.equal(records[0].type, 'preview');
	assert.equal(records[0].workerName, 'demo-preview-9f3a2b');
});

test('doPreview records a failed entry and throws on deploy failure', async () => {
	records.length = 0;
	const deps = baseDeps({ run: async () => ({ status: 1, output: 'boom\n' }) });
	await assert.rejects(
		doPreview({ config, cwd: '/x', storeDir: '/s', deps }),
		/exit 1/,
	);
	assert.equal(records[0].status, 'failed');
	assert.equal(records[0].logTail, 'boom\n');
});

test('doPreview fails fast without auth or CLI', async () => {
	await assert.rejects(
		doPreview({ config, cwd: '/x', storeDir: '/s', deps: baseDeps({ auth: () => ({ ok: false, hint: 'log in' }) }) }),
		/log in/,
	);
	await assert.rejects(
		doPreview({ config, cwd: '/x', storeDir: '/s', deps: baseDeps({ checkCli: () => ({ ok: false, hint: 'npm install' }) }) }),
		/npm install/,
	);
});

test('doPreview prefers explicit branch/commit over git metadata', async () => {
	records.length = 0;
	const deps = baseDeps({ git: () => ({ branch: 'main', commit: 'gitcommit', dirty: false }) });
	await doPreview({ config, cwd: '/x', storeDir: '/s', branch: 'feat', commit: 'explicit', deps });
	assert.equal(records[0].branch, 'feat');
	assert.equal(records[0].commit, 'explicit');
});

test('cleanPreviews deletes by id prefix and marks cleaned', async () => {
	const cleaned = [];
	const deleted = [];
	const deps = {
		list: () => [
			{ project: 'demo', entry: { id: 'dep_20261014_aaaaaa', type: 'preview', status: 'active', workerName: 'demo-preview-aaaaaa' } },
			{ project: 'demo', entry: { id: 'dep_20261014_bbbbbb', type: 'preview', status: 'active', workerName: 'demo-preview-bbbbbb' } },
		],
		remove: (name) => { deleted.push(name); return { status: 0 }; },
		markCleaned: (dir, id) => { cleaned.push(id); return { id }; },
	};
	const results = await cleanPreviews({ storeDir: '/s', ids: ['dep_20261014_aaa'], deps });
	assert.equal(results.length, 1);
	assert.equal(results[0].ok, true);
	assert.deepEqual(deleted, ['demo-preview-aaaaaa']);
	assert.deepEqual(cleaned, ['dep_20261014_aaaaaa']);
});

test('cleanPreviews --all removes everything; unknown id errors', async () => {
	const deps = {
		list: () => [{ project: 'demo', entry: { id: 'dep_1', type: 'preview', status: 'active', workerName: 'w1' } }],
		remove: () => ({ status: 0 }),
		markCleaned: () => ({}),
	};
	const results = await cleanPreviews({ storeDir: '/s', all: true, deps });
	assert.equal(results.length, 1);
	await assert.rejects(cleanPreviews({ storeDir: '/s', ids: ['nope'], deps }), /no active preview matches/);
	await assert.rejects(cleanPreviews({ storeDir: '/s', all: true, deps: { ...deps, list: () => [] } }), /no active previews/);
});

test('cleanPreviews reports per-preview failures without throwing', async () => {
	const deps = {
		list: () => [{ project: 'demo', entry: { id: 'dep_1', type: 'preview', status: 'active', workerName: 'w1' } }],
		remove: () => { throw new Error('network down'); },
		markCleaned: () => { throw new Error('must not mark cleaned on failure'); },
	};
	const results = await cleanPreviews({ storeDir: '/s', ids: ['dep_1'], deps });
	assert.equal(results[0].ok, false);
	assert.match(results[0].error, /network down/);
});
