// Skyforge previews: deploy the working tree to a unique preview worker.
// A preview is a real, separate Cloudflare Worker named
// `<project>-preview-<shortid>` — no production traffic is touched, and the
// preview shares the project's D1/R2/KV bindings (stated, not hidden).
// All side effects are injectable so tests never touch the network or git.
import { spawnSync } from 'node:child_process';
import { buildDeployArgs, checkAuth, checkCliInstalled, readDeployments } from './deploy.mjs';
import { runTee, tailLines } from './exec.mjs';
import {
	appendHistory, newDeployId, gitMeta, activePreviews,
	markPreviewCleaned,
} from './releases.mjs';

/** Preview worker name for a project + deploy id suffix. Pure. */
export function previewWorkerName(projectName, shortId) {
	const safe = String(projectName).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
	return `${safe}-preview-${shortId}`;
}

/** Short id suffix derived from a deploy id (`dep_20261014_9f3a2b` -> `9f3a2b`). Pure. */
export function shortId(deployId) {
	const parts = String(deployId).split('_');
	return parts[parts.length - 1] || deployId;
}

/**
 * Deploy a preview. Returns { id, workerName, url }.
 * Throws with a plain-English message on any failure (auth, CLI, deploy).
 * Everything injectable via `deps`.
 */
export async function doPreview({ config, cwd, storeDir, branch, commit, deps = {} }) {
	const {
		checkCli = checkCliInstalled,
		auth = checkAuth,
		git = gitMeta,
		run = runTee,
		record = appendHistory,
		makeId = newDeployId,
	} = deps;

	const cli = checkCli({ cwd });
	if (!cli.ok) throw new Error(cli.hint);
	const a = auth();
	if (!a.ok) throw new Error(a.hint);

	const meta = git({ cwd });
	const id = makeId();
	const workerName = previewWorkerName(config.name, shortId(id));
	// Previews never take the production custom domain.
	const args = buildDeployArgs({ ...config, name: workerName, domain: null });
	const url = `https://${workerName}.workers.dev`;

	const result = await run('npx', ['workersphp', ...args], { cwd });
	if (result.status !== 0) {
		record(storeDir, config.name, {
			id, type: 'preview', status: 'failed', url, workerName,
			branch: branch || meta.branch, commit: commit || meta.commit, dirty: meta.dirty,
			logTail: tailLines(result.output),
		});
		throw new Error(`preview deploy failed (exit ${result.status}) — recorded as failed; see the log above`);
	}
	const { entry } = record(storeDir, config.name, {
		id, type: 'preview', url, workerName,
		branch: branch || meta.branch, commit: commit || meta.commit, dirty: meta.dirty,
		logTail: tailLines(result.output),
	});
	return { id: entry.id, workerName, url };
}

function defaultDeleteRunner(workerName) {
	return spawnSync('npx', ['wrangler', 'delete', workerName], { encoding: 'utf8', stdio: 'inherit', timeout: 60000 });
}

/**
 * Tear down preview workers. `ids` empty + `all` false -> error.
 * Returns [{ id, workerName, ok, error? }]. Never throws on per-preview
 * failures; reports them. `remove`/`del`/`list` injectable.
 */
export async function cleanPreviews({ storeDir, ids = [], all = false, deps = {} }) {
	const {
		list = (dir) => activePreviews(readDeployments(dir)),
		remove = defaultDeleteRunner,
		markCleaned = markPreviewCleaned,
	} = deps;
	const previews = list(storeDir);
	const targets = all ? previews : previews.filter((p) => ids.some((id) => p.entry.id.startsWith(id)));
	if (!targets.length) {
		throw new Error(all
			? 'no active previews to clean'
			: `no active preview matches: ${ids.join(', ')}\nrun: skyforge preview list`);
	}
	const results = [];
	for (const p of targets) {
		const workerName = p.entry.workerName || previewWorkerName(p.project, shortId(p.entry.id));
		let r;
		try {
			r = remove(workerName);
		} catch (e) {
			results.push({ id: p.entry.id, workerName, ok: false, error: e.message });
			continue;
		}
		const status = typeof r.status === 'number' ? r.status : 0;
		if (status === 0) {
			markCleaned(storeDir, p.entry.id);
			results.push({ id: p.entry.id, workerName, ok: true });
		} else {
			results.push({ id: p.entry.id, workerName, ok: false, error: `wrangler delete exited ${status}` });
		}
	}
	return results;
}
