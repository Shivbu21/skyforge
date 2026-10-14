// Skyforge logs: live tail via `wrangler tail`, and historical deploy logs
// from the local deployment record. Cloudflare does not retain historical
// worker logs on any plan — `logs --deployment` is honest about that and
// shows what skyforge recorded instead. All side effects injectable.
import { spawnSync } from 'node:child_process';
import { checkAuth, readDeployments } from './deploy.mjs';
import { findEntryById } from './releases.mjs';

function defaultTailSpawn(workerName) {
	return spawnSync('npx', ['wrangler', 'tail', workerName], { stdio: 'inherit', timeout: 0 });
}

/**
 * Stream a worker's live logs. Blocks until Ctrl-C (stdio inherit, so the
 * user sees wrangler's own output and can interrupt it). Returns when the
 * tail process exits. Throws with a plain-English message when auth or the
 * CLI is missing.
 */
export function tailLogs({ workerName, deps = {} } = {}) {
	const { auth = checkAuth, spawnTail = defaultTailSpawn } = deps;
	if (!workerName) throw new Error('no worker name — run inside a project dir or pass --name <worker>');
	const a = auth();
	if (!a.ok) throw new Error(a.hint);
	let r;
	try {
		r = spawnTail(workerName);
	} catch (e) {
		throw new Error(`could not start wrangler tail: ${e.message}`);
	}
	if (r.status !== 0 && r.status !== null) {
		throw new Error(`wrangler tail exited with code ${r.status} — is "${workerName}" a deployed worker on this account?`);
	}
	return { ok: true };
}

/**
 * Historical view for one deployment id (prefix match): the recorded
 * metadata plus whatever log tail skyforge captured at deploy time.
 * Pure-ish: `read` injectable.
 */
export function deploymentLog({ storeDir, deploymentId, deps = {} }) {
	const { read = readDeployments } = deps;
	const found = findEntryById(read(storeDir), deploymentId);
	if (!found) {
		throw new Error(`no deployment matches "${deploymentId}"\nrun: skyforge list   (or: skyforge preview list)`);
	}
	const { project, entry } = found;
	return {
		project,
		id: entry.id,
		type: entry.type,
		url: entry.url,
		at: entry.at,
		branch: entry.branch,
		commit: entry.commit,
		status: entry.status,
		rollbackOf: entry.rollbackOf || null,
		logTail: entry.logTail || null,
		note: entry.logTail
			? 'captured by skyforge at deploy time'
			: 'no log captured for this deployment — Cloudflare does not retain historical worker logs; use `skyforge logs --follow` for live logs',
	};
}
