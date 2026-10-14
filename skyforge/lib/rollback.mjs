// Skyforge rollback: redeploy a previous production version's code.
// Implemented via `git worktree` at the recorded commit — the user's working
// tree is never touched. The rollback itself is recorded as a NEW history
// entry (type 'rollback'); history is never rewritten.
// All side effects injectable so tests never touch git, the network, or disk.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDeployArgs, checkAuth, checkCliInstalled, readDeployments } from './deploy.mjs';
import { runTee, tailLines } from './exec.mjs';
import {
	appendHistory, findEntryById, commitExists, gitMeta,
} from './releases.mjs';

/** Rollback candidates: production/rollback entries that have a commit, newest first. Pure. */
export function rollbackCandidates(deployments, projectName) {
	const record = deployments.find((d) => d.name === projectName);
	if (!record || !Array.isArray(record.history)) return [];
	return record.history
		.filter((h) => (h.type === 'production' || h.type === 'rollback') && h.commit && h.status !== 'failed')
		.sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** Resolve the target entry: explicit --to id (prefix match) or the latest superseded one. Pure. */
export function resolveTarget(candidates, targetId) {
	if (targetId) {
		const hit = candidates.find((c) => c.id.startsWith(targetId));
		if (!hit) {
			const ids = candidates.map((c) => `  ${c.id}  ${c.branch || '?'}  ${(c.at || '').slice(0, 16).replace('T', ' ')}`).join('\n');
			throw new Error(`no deployment matches "${targetId}". Candidates:\n${ids || '  (none)'}`);
		}
		return hit;
	}
	const superseded = candidates.filter((c) => c.status === 'superseded');
	if (!superseded.length) {
		throw new Error('nothing to roll back to — only one production deployment is recorded');
	}
	return superseded[0];
}

function defaultWorktreeAdd(dir, commit, cwd) {
	return spawnSync('git', ['worktree', 'add', '--detach', dir, commit], { cwd, encoding: 'utf8', timeout: 60000 });
}

function defaultWorktreeRemove(dir, cwd) {
	try {
		spawnSync('git', ['worktree', 'remove', '--force', dir], { cwd, encoding: 'utf8', timeout: 60000 });
	} catch { /* best effort */ }
	try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

/**
 * Roll back a project to a previous deployment's commit.
 * Returns { target, url, entryId }. Throws with plain-English errors.
 */
export async function doRollback({ config, cwd, storeDir, targetId, deps = {} }) {
	const {
		checkCli = checkCliInstalled,
		auth = checkAuth,
		read = readDeployments,
		commitCheck = commitExists,
		worktreeAdd = defaultWorktreeAdd,
		worktreeRemove = defaultWorktreeRemove,
		run = runTee,
		record = appendHistory,
		mkDir = (prefix) => mkdtempSync(join(tmpdir(), prefix)),
		loadCfg = null, // (dir) -> config; null = reuse current config
	} = deps;

	const cli = checkCli({ cwd });
	if (!cli.ok) throw new Error(cli.hint);
	const a = auth();
	if (!a.ok) throw new Error(a.hint);

	const candidates = rollbackCandidates(read(storeDir), config.name);
	const target = resolveTarget(candidates, targetId);
	if (!commitCheck(target.commit, { cwd })) {
		throw new Error(
			`commit ${target.commit} is not available in this repo (shallow clone? pruned?).\n` +
			`Fetch it first: git fetch origin ${target.commit}`);
	}

	const workDir = mkDir('skyforge-rollback-');
	try {
		const add = worktreeAdd(workDir, target.commit, cwd);
		if (add.status !== 0) {
			throw new Error(`could not check out ${target.commit}: ${(add.stderr || '').trim() || 'git worktree failed'}`);
		}
		let deployConfig = config;
		if (loadCfg) {
			try { deployConfig = loadCfg(workDir); } catch { /* keep current config */ }
		}
		const args = buildDeployArgs(deployConfig, { appDir: workDir });
		const result = await run('npx', ['workersphp', ...args], { cwd });
		if (result.status !== 0) {
			throw new Error(`rollback deploy failed (exit ${result.status}) — production is untouched; see the log above`);
		}
		const url = deployConfig.domain
			? `https://${deployConfig.domain}`
			: `https://${deployConfig.name}.workers.dev`;
		const { entry } = record(storeDir, config.name, {
			type: 'rollback',
			rollbackOf: target.id,
			url,
			branch: target.branch,
			commit: target.commit,
			dirty: false,
			logTail: tailLines(result.output),
		});
		return { target, url, entryId: entry.id };
	} finally {
		worktreeRemove(workDir, cwd);
	}
}

/** Human-readable one-liner for a candidate. Pure. */
export function describeTarget(entry) {
	const when = (entry.at || '').slice(0, 16).replace('T', ' ');
	const meta = [entry.branch, (entry.commit || '').slice(0, 8), when].filter(Boolean).join(' · ');
	return `${entry.id}  (${meta})${entry.status === 'active' ? '  [current]' : ''}`;
}
