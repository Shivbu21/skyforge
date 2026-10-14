#!/usr/bin/env node
// Skyforge — deploy PHP apps on Cloudflare Workers with R2 storage.
// Commands: init, deploy, dashboard, help.
import { existsSync, readdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { loadConfig } from '../lib/config.mjs';
import { initProject } from '../lib/scaffold.mjs';
import { listTemplates, scaffoldTemplate } from '../lib/templates.mjs';
import {
	buildDeployArgs, checkAuth, checkCliInstalled, runDeploy,
	recordDeployment, readDeployments, defaultStoreDir,
} from '../lib/deploy.mjs';
import { doPreview, cleanPreviews, shortId, previewWorkerName } from '../lib/preview.mjs';
import { activePreviews } from '../lib/releases.mjs';
import { doRollback, rollbackCandidates, resolveTarget, describeTarget } from '../lib/rollback.mjs';
import { confirmAction, gitMeta } from '../lib/releases.mjs';
import { tailLogs, deploymentLog } from '../lib/logs.mjs';

const VERSION = '0.1.0';

const HELP = `skyforge ${VERSION} — deploy PHP apps on Cloudflare Workers with R2 storage.

usage:
  skyforge init <name> [--framework plain|laravel] [--no-r2]
      Scaffold a new project in ./<name> with skyforge.json.
      plain   = framework-free PHP (default): index.php + R2 storage helper
      laravel = Laravel wiring guide + config (you run composer create-project)

  skyforge init --template <name> [dir] [--force]
      Scaffold a curated starter template (see: skyforge templates)
      into ./[dir] (default: ./<name>). Refuses a non-empty dir
      without --force.

  skyforge templates
      List the curated starter templates with descriptions.

  skyforge deploy [--no-deploy]
      Provision D1/R2/KV from skyforge.json and publish via the workersphp
      runtime. --no-deploy scaffolds the worker without publishing.
      Needs a Cloudflare account: npx wrangler login (or CLOUDFLARE_API_TOKEN).

  skyforge dashboard [--port 8788]
      Start the local usage dashboard (deployments + R2 storage).

  skyforge preview [--branch <b>] [--commit <c>]
      Deploy the working tree to a unique preview URL
      (https://<name>-preview-<id>.workers.dev). Production untouched.
      Previews share the project's D1/R2/KV bindings.

  skyforge preview list
      Show active previews.

  skyforge preview clean [--all] [<id>...]
      Delete preview workers and mark them cleaned.

  skyforge rollback [--to <id>] [--yes]
      Redeploy a previous production version (via git worktree at the
      recorded commit). Asks for confirmation unless --yes. Recorded as
      a new history entry — history is never rewritten.

  skyforge logs --follow [--name <worker>]
      Tail a worker's live logs (wrangler tail). Ctrl-C to stop.

  skyforge logs --deployment <id>
      Show what skyforge recorded for a past deployment. Cloudflare does
      not retain historical worker logs, so this is the deploy-time record.

  skyforge help
      This text.
`;

function fail(message) {
	console.error(`skyforge: ${message}`);
	process.exit(1);
}

async function cmdInit(argv) {
	const tplIdx = argv.indexOf('--template');
	if (tplIdx >= 0) {
		const templateName = argv[tplIdx + 1];
		if (!templateName || templateName.startsWith('-')) fail('usage: skyforge init --template <name> [dir] [--force]');
		const force = argv.includes('--force');
		const dirArg = argv.filter((a, i) => i !== tplIdx && i !== tplIdx + 1 && a !== '--force')[0];
		const dirName = dirArg || templateName;
		if (dirName.startsWith('-')) fail(`unknown init flag: ${dirName}`);
		const dir = resolve(process.cwd(), dirName);
		const projectName = basename(dir);
		let files;
		try {
			files = scaffoldTemplate({}, templateName, projectName, dir, { force });
		} catch (e) {
			fail(e.message);
		}
		console.log(`created ${dirName}/ from template "${templateName}"`);
		for (const f of files) console.log(`  ${f}`);
		console.log('\nnext:');
		console.log(`  cd ${dirName} && npm install`);
		console.log('  npx wrangler login   # once per machine, or set CLOUDFLARE_API_TOKEN');
		console.log('  skyforge deploy');
		return;
	}
	const name = argv[0];
	if (!name || name.startsWith('-')) fail('init needs a project name: skyforge init my-app');
	let framework = 'plain';
	let withR2 = true;
	for (let i = 1; i < argv.length; i++) {
		if (argv[i] === '--framework') framework = argv[++i];
		else if (argv[i] === '--no-r2') withR2 = false;
		else fail(`unknown init flag: ${argv[i]}`);
	}
	if (!['plain', 'laravel'].includes(framework)) fail(`--framework must be plain or laravel, got: ${framework}`);
	const dir = resolve(process.cwd(), name);
	if (existsSync(dir) && readdirSync(dir).length > 0) {
		fail(`directory ${name}/ already exists and is not empty`);
	}
	const files = initProject(dir, name, framework, { withR2 });
	console.log(`created ${name}/ (${framework})`);
	for (const f of files) console.log(`  ${f}`);
	console.log('\nnext:');
	console.log(`  cd ${name} && npm install`);
	if (framework === 'laravel') {
		console.log('  composer create-project laravel/laravel . && composer require workersphp/laravel-bridge');
	} else {
		console.log('  php -S localhost:8000   # local dev (storage falls back to ./storage-dev)');
	}
	console.log('  npx wrangler login   # once per machine, or set CLOUDFLARE_API_TOKEN');
	console.log('  skyforge deploy');
}

async function cmdTemplates() {
	let templates;
	try {
		templates = listTemplates();
	} catch (e) {
		fail(e.message);
	}
	if (!templates.length) {
		console.log('no templates installed');
		return;
	}
	for (const t of templates) {
		console.log(`\n${t.name} — ${t.title} [${t.framework}]`);
		console.log(`  ${t.description}`);
		if (t.badges?.length) console.log(`  stack: ${t.badges.join(', ')}`);
		if (t.requirements?.length) console.log(`  needs: ${t.requirements.join('; ')}`);
		console.log(`  skyforge init --template ${t.name} my-app`);
	}
	console.log('');
}

async function cmdDeploy(argv) {
	const noDeploy = argv.includes('--no-deploy');
	const cwd = process.cwd();
	let config;
	try {
		config = loadConfig(cwd);
	} catch (e) {
		fail(e.message);
	}
	if (config.framework === 'laravel' && !existsSync(resolve(cwd, 'artisan'))) {
		console.error('warning: no artisan in this directory — is the Laravel app created yet?');
		console.error('  composer create-project laravel/laravel . && composer require workersphp/laravel-bridge\n');
	}
	const cli = checkCliInstalled({ cwd });
	if (!cli.ok) fail(cli.hint);
	if (!noDeploy) {
		const auth = checkAuth();
		if (!auth.ok) fail(auth.hint);
		console.log(`authenticated via ${auth.method}`);
	}
	try {
		runDeploy({ config, cwd, noDeploy });
	} catch (e) {
		fail(e.message);
	}
	if (!noDeploy) {
		const storeDir = defaultStoreDir();
		const url = config.domain ? `https://${config.domain}` : `https://${config.name}.workers.dev`;
		const meta = gitMeta({ cwd });
		recordDeployment(storeDir, {
			name: config.name,
			framework: config.framework,
			url,
			domain: config.domain,
			d1: config.d1, r2: config.r2, kv: config.kv, queue: config.queue,
			branch: meta.branch, commit: meta.commit, dirty: meta.dirty,
			projectDir: cwd,
		});
		console.log(`\ndeployed: ${url}`);
		console.log('recorded in ~/.skyforge/deployments.json — see it in: skyforge dashboard');
	}
}

async function cmdDashboard(argv) {
	let port = 8788;
	const i = argv.indexOf('--port');
	if (i >= 0) {
		port = Number(argv[i + 1]);
		if (!Number.isInteger(port) || port < 1 || port > 65535) fail('--port needs a number 1-65535');
	}
	const { startDashboard } = await import('../dashboard/server.mjs');
	const storeDir = defaultStoreDir();
	console.log(`skyforge dashboard: http://localhost:${port}`);
	console.log(`reading deployments from ${storeDir}/deployments.json`);
	await startDashboard({ port, storeDir });
}

async function cmdPreview(argv) {
	const storeDir = defaultStoreDir();
	const cwd = process.cwd();
	if (argv[0] === 'list') {
		const previews = activePreviews(readDeployments(storeDir));
		if (!previews.length) {
			console.log('no active previews — run: skyforge preview');
			return;
		}
		for (const p of previews) {
			const e = p.entry;
			console.log(`${e.id}  ${p.project}  ${e.url}  ${(e.branch || '?')}@${(e.commit || '?').slice(0, 8)}  (${(e.at || '').slice(0, 16).replace('T', ' ')})`);
		}
		return;
	}
	if (argv[0] === 'clean') {
		const rest = argv.slice(1);
		const all = rest.includes('--all');
		const ids = rest.filter((a) => a !== '--all');
		if (!all && !ids.length) fail('usage: skyforge preview clean [--all] [<id>...]');
		let results;
		try {
			results = await cleanPreviews({ storeDir, ids, all });
		} catch (e) {
			fail(e.message);
		}
		for (const r of results) {
			console.log(r.ok ? `deleted ${r.workerName} (${r.id})` : `FAILED ${r.workerName}: ${r.error}`);
		}
		if (results.some((r) => !r.ok)) process.exit(1);
		return;
	}
	// skyforge preview [--branch b] [--commit c]
	let branch = null, commit = null;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--branch') branch = argv[++i];
		else if (argv[i] === '--commit') commit = argv[++i];
		else fail(`unknown preview flag: ${argv[i]}\nusage: skyforge preview [--branch <b>] [--commit <c>]`);
	}
	let config;
	try {
		config = loadConfig(cwd);
	} catch (e) {
		fail(e.message);
	}
	try {
		const { id, url } = await doPreview({ config, cwd, storeDir, branch, commit });
		console.log(`\npreview live: ${url}`);
		console.log(`id: ${id} — clean up with: skyforge preview clean ${id.slice(0, 18)}`);
	} catch (e) {
		fail(e.message);
	}
}

async function cmdRollback(argv) {
	const storeDir = defaultStoreDir();
	const cwd = process.cwd();
	let targetId = null;
	let yes = false;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--to') targetId = argv[++i];
		else if (argv[i] === '--yes') yes = true;
		else fail(`unknown rollback flag: ${argv[i]}\nusage: skyforge rollback [--to <id>] [--yes]`);
	}
	let config;
	try {
		config = loadConfig(cwd);
	} catch (e) {
		fail(e.message);
	}
	const candidates = rollbackCandidates(readDeployments(storeDir), config.name);
	let target;
	try {
		target = resolveTarget(candidates, targetId);
	} catch (e) {
		fail(e.message);
	}
	console.log(`will redeploy to production:\n  ${describeTarget(target)}`);
	if (!yes) {
		const ok = await confirmAction('proceed with rollback?');
		if (!ok) {
			console.log('aborted — nothing was deployed');
			return;
		}
	}
	try {
		const { url, entryId } = await doRollback({
			config, cwd, storeDir, targetId: target.id, deps: { loadCfg: loadConfig },
		});
		console.log(`\nrolled back: ${url}`);
		console.log(`recorded as ${entryId} (history preserved — the old entry is still there)`);
	} catch (e) {
		fail(e.message);
	}
}

async function cmdLogs(argv) {
	const storeDir = defaultStoreDir();
	const cwd = process.cwd();
	const follow = argv.includes('--follow');
	const depIdx = argv.indexOf('--deployment');
	const nameIdx = argv.indexOf('--name');
	if (follow) {
		let workerName = nameIdx >= 0 ? argv[nameIdx + 1] : null;
		if (!workerName) {
			try {
				workerName = loadConfig(cwd).name;
			} catch {
				fail('not in a project dir — pass --name <worker>');
			}
		}
		console.log(`tailing ${workerName} — Ctrl-C to stop`);
		try {
			tailLogs({ workerName });
		} catch (e) {
			fail(e.message);
		}
		return;
	}
	if (depIdx >= 0) {
		const id = argv[depIdx + 1];
		if (!id) fail('usage: skyforge logs --deployment <id>');
		let info;
		try {
			info = deploymentLog({ storeDir, deploymentId: id });
		} catch (e) {
			fail(e.message);
		}
		console.log(`${info.project}  ${info.id}  [${info.type}]  ${info.status}`);
		console.log(`url:    ${info.url}`);
		console.log(`at:     ${info.at}`);
		console.log(`commit: ${info.commit || '—'}${info.branch ? ` (${info.branch})` : ''}`);
		if (info.rollbackOf) console.log(`rollback of: ${info.rollbackOf}`);
		console.log(`\n${info.note}`);
		if (info.logTail) {
			console.log('\n--- captured deploy log (tail) ---');
			console.log(info.logTail);
		}
		return;
	}
	fail('usage:\n  skyforge logs --follow [--name <worker>]\n  skyforge logs --deployment <id>');
}

async function main(argv) {
	const [cmd, ...rest] = argv;
	if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
		console.log(HELP);
		return;
	}
	if (cmd === '--version' || cmd === '-v') {
		console.log(VERSION);
		return;
	}
	if (cmd === 'init') return cmdInit(rest);
	if (cmd === 'templates') return cmdTemplates();
	if (cmd === 'deploy') return cmdDeploy(rest);
	if (cmd === 'preview') return cmdPreview(rest);
	if (cmd === 'rollback') return cmdRollback(rest);
	if (cmd === 'logs') return cmdLogs(rest);
	if (cmd === 'dashboard') return cmdDashboard(rest);
	if (cmd === 'projects' || cmd === 'list') {
		// Quiet alias: show recorded deployments without starting the server.
		const list = readDeployments(defaultStoreDir());
		if (!list.length) {
			console.log('no deployments recorded yet — run skyforge deploy in a project first');
			return;
		}
		for (const d of list) {
			console.log(`${d.name}  ${d.framework}  ${d.status}  ${d.url}  (last deploy ${d.lastDeploy})`);
		}
		return;
	}
	fail(`unknown command: ${cmd}\n\n${HELP}`);
}

main(process.argv.slice(2)).catch((e) => {
	console.error(`skyforge: ${e.message}`);
	process.exit(1);
});
