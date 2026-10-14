// Skyforge release history: production / preview / rollback entries stored in
// ~/.skyforge/deployments.json, backward compatible with the Module 1 shape
// (top-level per-project fields unchanged; a `history` array is added).
// Pure functions take injected dependencies so tests never touch the network,
// the real filesystem, or git.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { readDeployments, storePath } from './deploy.mjs';

/**
 * Generate a deployment id. `rand`/`now` injectable for tests.
 * e.g. dep_20261014_9f3a2b
 */
export function newDeployId({ rand = Math.random, now = () => new Date() } = {}) {
	const d = now();
	const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
	const hex = Math.floor(rand() * 0xffffff).toString(16).padStart(6, '0');
	return `dep_${ymd}_${hex}`;
}

function writeDeployments(storeDir, deployments) {
	mkdirSync(storeDir, { recursive: true });
	writeFileSync(storePath(storeDir), JSON.stringify({ deployments }, null, 2) + '\n');
}

/**
 * Append a history entry to a project's record (creating the record if needed).
 * Production/rollback entries supersede older active production entries.
 * Returns the full deployments list. Pure-ish: fs injectable.
 */
export function appendHistory(storeDir, projectName, entry, {
	read = readDeployments, write = writeDeployments, now = () => new Date().toISOString(),
} = {}) {
	const deployments = read(storeDir);
	let record = deployments.find((d) => d.name === projectName);
	if (!record) {
		record = {
			name: projectName,
			framework: entry.framework || 'plain',
			url: entry.url || `https://${projectName}.workers.dev`,
			domain: null,
			status: 'deployed',
			lastDeploy: now(),
			resources: {},
			history: [],
		};
		deployments.push(record);
	}
	record.history = Array.isArray(record.history) ? record.history : [];
	const full = {
		id: entry.id || newDeployId(),
		type: entry.type || 'production',
		at: entry.at || now(),
		url: entry.url || record.url,
		branch: entry.branch ?? null,
		commit: entry.commit ?? null,
		dirty: entry.dirty ?? null,
		status: entry.status || 'active',
		...(entry.workerName ? { workerName: entry.workerName } : {}),
		...(entry.rollbackOf ? { rollbackOf: entry.rollbackOf } : {}),
		...(entry.logTail ? { logTail: entry.logTail } : {}),
	};
	if (full.type === 'production' || full.type === 'rollback') {
		for (const h of record.history) {
			if ((h.type === 'production' || h.type === 'rollback') && h.status === 'active') {
				h.status = 'superseded';
			}
		}
		record.url = full.url;
		record.status = 'deployed';
		record.lastDeploy = full.at;
	}
	record.history.push(full);
	write(storeDir, deployments);
	return { deployments, entry: full };
}

/** All history entries for a project, newest first. Pure. */
export function getHistory(deployments, projectName) {
	const record = deployments.find((d) => d.name === projectName);
	if (!record || !Array.isArray(record.history)) return [];
	return [...record.history].sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** Find a single history entry by id across all projects. Pure.
 * Exact match first, then a unique id-prefix match (CLI ids are often
 * abbreviated). Ambiguous prefixes return null. */
export function findEntryById(deployments, id) {
	for (const d of deployments) {
		const hit = (d.history || []).find((h) => h.id === id);
		if (hit) return { project: d.name, entry: hit };
	}
	const prefixHits = [];
	for (const d of deployments) {
		for (const h of d.history || []) {
			if (h.id.startsWith(id)) prefixHits.push({ project: d.name, entry: h });
		}
	}
	return prefixHits.length === 1 ? prefixHits[0] : null;
}

/** Active (not cleaned) preview entries across all projects, newest first. Pure. */
export function activePreviews(deployments) {
	const out = [];
	for (const d of deployments) {
		for (const h of d.history || []) {
			if (h.type === 'preview' && h.status === 'active') out.push({ project: d.name, entry: h });
		}
	}
	return out.sort((a, b) => (a.entry.at < b.entry.at ? 1 : -1));
}

/** Mark a preview entry cleaned. Returns the entry or null. */
export function markPreviewCleaned(storeDir, previewId, {
	read = readDeployments, write = writeDeployments,
} = {}) {
	const deployments = read(storeDir);
	const found = findEntryById(deployments, previewId);
	if (!found || found.entry.type !== 'preview') return null;
	found.entry.status = 'cleaned';
	write(storeDir, deployments);
	return found;
}

// ---------------------------------------------------------------------------
// Git metadata: branch / commit / dirty flag. Best-effort — returns nulls
// (never throws) when the directory is not a git repo. `run` injectable.
// ---------------------------------------------------------------------------

function defaultGitRun(args, cwd) {
	return spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 10000 });
}

export function gitMeta({ run = defaultGitRun, cwd = process.cwd() } = {}) {
	const blank = { branch: null, commit: null, dirty: false };
	let r;
	try {
		r = run(['rev-parse', '--is-inside-work-tree'], cwd);
	} catch {
		return blank;
	}
	if (r.status !== 0 || String(r.stdout || '').trim() !== 'true') return blank;
	const out = { ...blank };
	try {
		const b = run(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
		if (b.status === 0) out.branch = String(b.stdout || '').trim() || null;
		const c = run(['rev-parse', 'HEAD'], cwd);
		if (c.status === 0) out.commit = String(c.stdout || '').trim() || null;
		const s = run(['status', '--porcelain'], cwd);
		if (s.status === 0) out.dirty = String(s.stdout || '').trim().length > 0;
	} catch {
		// partial metadata is fine
	}
	return out;
}

/** Does this commit exist locally? Used to guard rollbacks. */
export function commitExists(commit, { run = defaultGitRun, cwd = process.cwd() } = {}) {
	if (!commit) return false;
	try {
		const r = run(['cat-file', '-e', `${commit}^{commit}`], cwd);
		return r.status === 0;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Interactive confirmation. `--yes` skips; otherwise asks on stdin.
// `ask` injectable for tests.
// ---------------------------------------------------------------------------

export async function confirmAction(message, {
	input = process.stdin, output = process.stdout, ask = null,
} = {}) {
	if (ask) return ask(message);
	const rl = createInterface({ input, output });
	try {
		const answer = await new Promise((resolve) => {
			rl.question(`${message} [y/N] `, resolve);
		});
		return /^(y|yes)$/i.test(answer.trim());
	} finally {
		rl.close();
	}
}
