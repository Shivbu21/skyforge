// Skyforge dashboard server: zero-dependency node:http.
// Serves the light-theme UI and a small JSON API.
// The Cloudflare API token is kept in process memory only — never written
// to disk. Restarting the server forgets it; that is intentional.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDeployments } from '../lib/deploy.mjs';
import { getHistory, activePreviews } from '../lib/releases.mjs';
import { cleanPreviews } from '../lib/preview.mjs';
import { doRollback } from '../lib/rollback.mjs';
import { deploymentLog } from '../lib/logs.mjs';
import { loadConfig } from '../lib/config.mjs';
import { listTemplates } from '../lib/templates.mjs';
import { randomBytes } from 'node:crypto';
import {
	verifyToken, listR2Buckets, listD1Databases, fetchR2Usage, formatBytes,
} from '../lib/cloudflare.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(here, 'public');

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.svg': 'image/svg+xml',
};

function send(res, status, body, type = 'application/json') {
	const payload = typeof body === 'string' ? body : JSON.stringify(body);
	res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
	res.end(payload);
}

function readBody(req) {
	return new Promise((resolve, reject) => {
		let data = '';
		req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
		req.on('end', () => resolve(data));
		req.on('error', reject);
	});
}

export async function startDashboard({ port = 8788, storeDir }) {
	// In-memory only.
	let token = process.env.CLOUDFLARE_API_TOKEN || null;
	let account = null;
	if (token) {
		const v = await verifyToken(token).catch(() => ({ ok: false }));
		if (v.ok) account = { id: v.accountId, name: v.accountName };
		else token = null; // env token invalid: fall back to manual connect
	}

	// Background jobs (rollback / preview clean): in-memory only.
	const jobs = new Map();
	function startJob(kind, label, fn) {
		const id = 'job_' + Date.now().toString(36) + randomBytes(3).toString('hex');
		const job = { id, kind, label, status: 'running', startedAt: new Date().toISOString(), finishedAt: null, error: null };
		jobs.set(id, job);
		(async () => {
			try {
				await fn();
				job.status = 'done';
			} catch (e) {
				job.status = 'error';
				job.error = e.message;
			} finally {
				job.finishedAt = new Date().toISOString();
			}
		})();
		return job;
	}

	const server = createServer(async (req, res) => {
		const url = new URL(req.url, 'http://localhost');
		try {
			// --- API ---
			if (url.pathname === '/api/state' && req.method === 'GET') {
				const deployments = readDeployments(storeDir);
				return send(res, 200, {
					connected: !!token,
					account,
					deployments,
					previews: activePreviews(deployments),
				});
			}
			if (url.pathname === '/api/history' && req.method === 'GET') {
				const project = url.searchParams.get('project');
				if (!project) return send(res, 400, { ok: false, error: 'project required' });
				return send(res, 200, { ok: true, history: getHistory(readDeployments(storeDir), project) });
			}
			if (url.pathname === '/api/log' && req.method === 'GET') {
				const id = url.searchParams.get('deployment');
				if (!id) return send(res, 400, { ok: false, error: 'deployment required' });
				try {
					return send(res, 200, { ok: true, ...deploymentLog({ storeDir, deploymentId: id }) });
				} catch (e) {
					return send(res, 404, { ok: false, error: e.message });
				}
			}
			if (url.pathname === '/api/templates' && req.method === 'GET') {
				let templates = [];
				try {
					templates = listTemplates();
				} catch (e) {
					console.error(`[dashboard] /api/templates: ${e.message}`);
				}
				return send(res, 200, { ok: true, templates });
			}
			if (url.pathname === '/api/rollback' && req.method === 'POST') {
				const { project, targetId } = JSON.parse(await readBody(req) || '{}');
				if (!project || !targetId) return send(res, 400, { ok: false, error: 'project and targetId required' });
				const record = readDeployments(storeDir).find((d) => d.name === project);
				if (!record) return send(res, 404, { ok: false, error: 'unknown project' });
				if (!record.projectDir || !existsSync(record.projectDir)) {
					return send(res, 400, {
						ok: false,
						error: 'dashboard cannot roll back this project (its local directory is not recorded). ' +
							`Run in the project dir: skyforge rollback --to ${targetId}`,
					});
				}
				let config;
				try {
					config = loadConfig(record.projectDir);
				} catch (e) {
					return send(res, 400, { ok: false, error: `cannot read skyforge.json: ${e.message}` });
				}
				const job = startJob('rollback', `rollback ${project} to ${targetId}`, async () => {
					await doRollback({
						config, cwd: record.projectDir, storeDir, targetId,
						deps: { loadCfg: loadConfig },
					});
				});
				return send(res, 202, { ok: true, job: job.id });
			}
			if (url.pathname === '/api/preview-clean' && req.method === 'POST') {
				const { id } = JSON.parse(await readBody(req) || '{}');
				if (!id) return send(res, 400, { ok: false, error: 'id required' });
				const job = startJob('preview-clean', `clean preview ${id}`, async () => {
					const results = await cleanPreviews({ storeDir, ids: [id] });
					const failed = results.filter((r) => !r.ok);
					if (failed.length) throw new Error(failed.map((r) => r.error).join('; '));
				});
				return send(res, 202, { ok: true, job: job.id });
			}
			if (url.pathname.startsWith('/api/jobs/') && req.method === 'GET') {
				const id = url.pathname.slice('/api/jobs/'.length);
				const job = jobs.get(id);
				if (!job) return send(res, 404, { ok: false, error: 'unknown job' });
				return send(res, 200, { ok: true, job });
			}
			if (url.pathname === '/api/connect' && req.method === 'POST') {
				const { token: t } = JSON.parse(await readBody(req) || '{}');
				if (!t || typeof t !== 'string') return send(res, 400, { ok: false, error: 'token required' });
				const v = await verifyToken(t.trim()).catch((e) => ({ ok: false, error: e.message }));
				if (!v.ok) return send(res, 200, { ok: false, error: v.error });
				token = t.trim();
				account = { id: v.accountId, name: v.accountName };
				return send(res, 200, { ok: true, account });
			}
			if (url.pathname === '/api/disconnect' && req.method === 'POST') {
				token = null; account = null;
				return send(res, 200, { ok: true });
			}
			if (!token) {
				if (url.pathname.startsWith('/api/')) {
					return send(res, 401, { ok: false, error: 'not connected', connected: false });
				}
			} else if (url.pathname === '/api/r2' && req.method === 'GET') {
				const buckets = await listR2Buckets(account.id, token).catch((e) => ({ ok: false, error: e.message }));
				if (!buckets.ok) return send(res, 200, buckets);
				const usage = await fetchR2Usage(account.id, token).catch((e) => ({ ok: false, error: e.message }));
				const byName = new Map((usage.ok ? usage.usage : []).map((u) => [u.bucket, u.bytes]));
				return send(res, 200, {
					ok: true,
					usageOk: usage.ok,
					usageError: usage.ok ? null : usage.error,
					buckets: buckets.buckets.map((b) => ({
						...b,
						bytes: byName.has(b.name) ? byName.get(b.name) : null,
						display: byName.has(b.name) ? formatBytes(byName.get(b.name)) : '—',
					})),
				});
			} else if (url.pathname === '/api/d1' && req.method === 'GET') {
				const dbs = await listD1Databases(account.id, token).catch((e) => ({ ok: false, error: e.message }));
				if (!dbs.ok) return send(res, 200, dbs);
				return send(res, 200, {
					ok: true,
					databases: dbs.databases.map((d) => ({ ...d, display: formatBytes(d.sizeBytes) })),
				});
			}
			// --- static ---
			let file = url.pathname === '/' ? '/index.html' : url.pathname;
			const full = join(PUBLIC, file);
			if (!full.startsWith(PUBLIC) || !existsSync(full)) {
				return send(res, 404, 'not found', 'text/plain');
			}
			const type = MIME[extname(full)] || 'application/octet-stream';
			const payload = type.startsWith('text/') || type.includes('javascript')
				? readFileSync(full, 'utf8')
				: readFileSync(full);
			res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
			return res.end(payload);
		} catch (e) {
			return send(res, 500, { ok: false, error: e.message });
		}
	});

	await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
	return server;
}
