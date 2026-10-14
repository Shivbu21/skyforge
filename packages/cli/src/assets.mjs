// Static asset publishing: the app's public/ tree plus vendor-served JS
// discovered at bake time. Requests these can satisfy never boot PHP.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { LIVEWIRE_CANONICAL_PREFIX } from '../../laravel/src/index.mjs';
import { log } from './constants.mjs';

export function publishAssets({ appDir, deployDir, framework = 'laravel' }) {
	log('publishing static assets');
	if (framework === 'plain') {
		// Plain PHP: the app dir is the docroot. Publish it as-is; the
		// runtime never serves *.php statically (see static.mjs), and
		// index.php is the worker entrypoint from the zip. Project
		// metadata stays out of the published assets.
		execFileSync('bash', ['-c',
			`cd '${appDir}' && tar -c` +
			` --exclude ./node_modules --exclude ./.git --exclude ./skyforge.json` +
			` --exclude ./package.json --exclude ./package-lock.json --exclude ./README.md` +
			` --exclude ./.gitignore --exclude ./composer.json --exclude ./composer.lock` +
			` --exclude ./deployments --exclude ./storage-dev` +
			` -f - . | tar -x -f - -C '${deployDir}/assets'`,
		]);
		return;
	}
	// tar, not `install -D`: BSD install has different -D semantics and the old
	// find -exec form failed silently on macOS (find exits 0 either way).
	execFileSync('bash', ['-c',
		`cd '${appDir}/public' && tar -c --exclude ./index.php --exclude ./.htaccess -f - . | tar -x -f - -C '${deployDir}/assets'`,
	]);

	const manifestPath = appDir + '/.bake-asset-manifest.json';
	if (existsSync(manifestPath)) {
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
		for (const [urlPath, file] of Object.entries(manifest)) {
			// Livewire's endpoint prefix hashes APP_KEY, which differs between the
			// bake's dummy key and the deployed secret. Publish under a stable path;
			// the runtime rewrites incoming /livewire-<hash>/ script requests to it.
			const canonical = urlPath.replace(/^\/livewire-[0-9a-f]+\//, LIVEWIRE_CANONICAL_PREFIX);
			const target = deployDir + '/assets' + canonical;
			mkdirSync(dirname(target), { recursive: true });
			copyFileSync(file.replace(/^\/app/, appDir), target);
		}
		log(`extracted ${Object.keys(manifest).length} vendor asset(s)`);
	}
}
