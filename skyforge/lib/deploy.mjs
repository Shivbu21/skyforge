// Skyforge deploy: config -> workersphp argv, credential checks, and the
// local deployment record. Pure functions take injected dependencies so
// tests never touch the network or the real filesystem.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { appendHistory } from './releases.mjs';

/**
 * Build the `workersphp deploy` argv from a normalized skyforge config.
 * Pure. Throws on configs the base CLI cannot serve.
 */
export function buildDeployArgs(config, { appDir = '.', noDeploy = false } = {}) {
	const args = ['deploy', '--app', appDir, '--name', config.name, '--framework', config.framework];
	if (config.d1) args.push('--d1', config.d1);
	if (config.r2) args.push('--r2', config.r2);
	if (config.kv) args.push('--kv', config.kv);
	if (config.queue) args.push('--queue', config.queue);
	for (const cron of config.crons || []) args.push('--cron', cron);
	if (config.broadcast) args.push('--broadcast');
	if (config.domain) args.push('--domain', config.domain);
	if (config.bake) args.push('--bake');
	for (const [k, v] of Object.entries(config.env || {})) args.push('--env', `${k}=${v}`);
	if (noDeploy) args.push('--no-deploy');
	return args;
}

/**
 * Check Cloudflare credentials. `run` is an injectable
 * (args) -> { status, stdout } — defaults to `npx wrangler whoami`.
 * Returns { ok: true, method } or { ok: false, hint }.
 */
export function checkAuth({ env = process.env, run = defaultRunner } = {}) {
	if (env.CLOUDFLARE_API_TOKEN) {
		return { ok: true, method: 'CLOUDFLARE_API_TOKEN' };
	}
	let result;
	try {
		result = run(['whoami']);
	} catch (e) {
		return { ok: false, hint: authHint(`could not run wrangler: ${e.message}`) };
	}
	if (result.status === 0) {
		return { ok: true, method: 'wrangler login' };
	}
	return { ok: false, hint: authHint('wrangler is not logged in') };
}

function defaultRunner(args) {
	return spawnSync('npx', ['wrangler', ...args], { encoding: 'utf8', timeout: 30000 });
}

function authHint(reason) {
	return `${reason}.\n` +
		`Skyforge deploys through Cloudflare, so it needs an account:\n` +
		`  1. Create a free Cloudflare account at https://dash.cloudflare.com/sign-up\n` +
		`  2. Run: npx wrangler login\n` +
		`  (or set the CLOUDFLARE_API_TOKEN env var instead of interactive login)`;
}

/** Is the base deploy CLI resolvable from cwd? Pure-ish (injectable exists). */
export function checkCliInstalled({ exists = existsSync, cwd = process.cwd() } = {}) {
	// Installed as a devDependency of the scaffolded project, or resolvable
	// from the skyforge repo itself.
	const candidates = [
		join(cwd, 'node_modules', '@workersphp', 'cli', 'package.json'),
		join(cwd, 'node_modules', '.bin', 'workersphp'),
	];
	return candidates.some(exists)
		? { ok: true }
		: {
			ok: false,
			hint: 'the @workersphp/cli package is not installed here.\nRun: npm install   (it is a devDependency of every skyforge project)',
		};
}

/**
 * Run the deploy. `spawn` injectable: (cmd, argv, opts) -> { status }.
 * Returns { ok: true } or throws with the underlying error.
 */
export function runDeploy({ config, cwd, spawn = defaultSpawn, noDeploy = false }) {
	const args = buildDeployArgs(config, { appDir: '.', noDeploy });
	const result = spawn('npx', ['workersphp', ...args], { cwd, stdio: 'inherit' });
	if (result.status !== 0) {
		throw new Error(`workersphp deploy exited with code ${result.status}`);
	}
	return { ok: true, args };
}

function defaultSpawn(cmd, argv, opts) {
	return spawnSync(cmd, argv, { encoding: 'utf8', ...opts });
}

// ---------------------------------------------------------------------------
// Deployment records: ~/.skyforge/deployments.json — the dashboard's source
// of truth. All functions take an explicit storeDir (tests use a tmp dir).
// ---------------------------------------------------------------------------

export function storePath(storeDir) {
	return join(storeDir, 'deployments.json');
}

export function readDeployments(storeDir) {
	const path = storePath(storeDir);
	try {
		const data = JSON.parse(readFileSync(path, 'utf8'));
		return Array.isArray(data.deployments) ? data.deployments : [];
	} catch {
		return [];
	}
}

/** Upsert a deployment record by project name. Returns the full list.
 * Also appends a `production` history entry (used by rollback) — pass
 * branch/commit/dirty/logTail when known. History is additive; the
 * top-level fields keep their Module 1 shape. */
export function recordDeployment(storeDir, entry) {
	const deployments = readDeployments(storeDir);
	const record = {
		name: entry.name,
		framework: entry.framework || 'plain',
		url: entry.url || `https://${entry.name}.workers.dev`,
		domain: entry.domain || null,
		status: entry.status || 'deployed',
		lastDeploy: new Date().toISOString(),
		projectDir: entry.projectDir || null,
		resources: {
			d1: entry.d1 || null,
			r2: entry.r2 || null,
			kv: entry.kv || null,
			queue: entry.queue || null,
		},
	};
	const i = deployments.findIndex((d) => d.name === record.name);
	if (i >= 0) deployments[i] = record;
	else deployments.push(record);
	mkdirSync(storeDir, { recursive: true });
	writeFileSync(storePath(storeDir), JSON.stringify({ deployments }, null, 2) + '\n');
	// History append for rollback candidates (synchronous; advisory — the
	// upsert above is the source of truth). Skipped only when
	// entry.history === false.
	if (entry.history !== false) {
		try {
			appendHistory(storeDir, record.name, {
				type: 'production',
				url: record.url,
				branch: entry.branch ?? null,
				commit: entry.commit ?? null,
				dirty: entry.dirty ?? null,
				...(entry.logTail ? { logTail: entry.logTail } : {}),
			});
		} catch { /* advisory only */ }
	}
	return deployments;
}

export function defaultStoreDir() {
	return join(homedir(), '.skyforge');
}
