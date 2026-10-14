// Skyforge scaffolding: project templates as pure data + a writer.
// Templates are functions of (name) returning { relativePath: content }.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const gitignore = `node_modules/
deployments/
.dev.vars
storage-dev/
*.log
.env
`;

const skyforgeJson = (name, framework, r2) => JSON.stringify({
	name,
	framework,
	d1: framework === 'laravel' ? `${name}-db` : null,
	r2: r2 ? `${name}-uploads` : null,
	kv: `${name}-cache`,
	queue: null,
	crons: [],
	broadcast: false,
	domain: null,
	bake: false,
	env: {},
}, null, 2) + '\n';

const packageJson = (name, framework) => JSON.stringify({
	name,
	private: true,
	version: '0.1.0',
	description: `PHP app deployed on Cloudflare Workers via Skyforge (${framework}).`,
	scripts: {
		deploy: 'skyforge deploy',
		...(framework === 'laravel' ? {} : { dev: 'php -S localhost:8000' }),
	},
	devDependencies: { '@workersphp/cli': '^0.1.0' },
}, null, 2) + '\n';

const plainIndexPhp = (name) => `<?php
// ${name} — plain PHP on Cloudflare Workers (Skyforge).
// Served by the runtime's vanilla adapter: $_SERVER/$_GET/$_POST are set,
// echo becomes the response body. See lib/storage.php for R2 access.
require __DIR__ . '/lib/storage.php';

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$storage = new SkyforgeStorage();

if ($path === '/api/time') {
    header('Content-Type: application/json');
    echo json_encode(['time' => date('c'), 'app' => '${name}']);
    return;
}

if ($path === '/files' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    header('Content-Type: application/json');
    echo json_encode(['files' => $storage->list()]);
    return;
}

if ($path === '/upload' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    // Accepts raw body or a form field named "content".
    $body = $GLOBALS['__raw_body'] ?? '';
    $key = 'uploads/' . date('Ymd-His') . '-' . bin2hex(random_bytes(4)) . '.txt';
    $storage->put($key, $body !== '' ? $body : ($_POST['content'] ?? 'empty'));
    header('Content-Type: application/json');
    echo json_encode(['stored' => $key, 'backend' => $storage->backend()]);
    return;
}
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= htmlspecialchars('${name}') ?> — on Cloudflare</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<main>
  <h1><?= htmlspecialchars('${name}') ?></h1>
  <p>Plain PHP, running on Cloudflare Workers via Skyforge.</p>
  <section>
    <h2>Try the R2-backed file store</h2>
    <form id="upload">
      <textarea name="content" rows="3" placeholder="Type something to store…"></textarea>
      <button type="submit">Store it</button>
    </form>
    <ul id="files"></ul>
  </section>
</main>
<script>
const list = async () => {
  const r = await fetch('/files').then(r => r.json());
  document.getElementById('files').innerHTML =
    r.files.map(f => '<li>' + f.key + ' <small>(' + f.size + ' bytes)</small></li>').join('')
    || '<li><em>nothing stored yet</em></li>';
};
document.getElementById('upload').addEventListener('submit', async (e) => {
  e.preventDefault();
  const content = new FormData(e.target).get('content');
  await fetch('/upload', { method: 'POST', body: content });
  e.target.reset(); list();
});
list();
</script>
</body>
</html>
`;

const storagePhp = `<?php
// Skyforge storage helper.
//
// On Cloudflare Workers the cfbindings extension is compiled into the PHP
// binary, so R2 calls are synchronous. In local dev (plain \`php -S\`) the
// extension is absent and we fall back to ./storage-dev/ on disk.
// Same API both ways — your code never branches.

class SkyforgeStorage {
    private string $mode;
    private string $localDir;

    public function __construct() {
        $this->mode = function_exists('cf_bindings_call') ? 'r2' : 'local';
        $this->localDir = __DIR__ . '/../storage-dev';
    }

    public function backend(): string {
        return $this->mode === 'r2' ? 'r2' : 'local-dev';
    }

    private function call(string $op, array $args = []): mixed {
        $response = json_decode(cf_bindings_call(json_encode([
            'kind' => 'r2', 'op' => $op, 'args' => $args,
        ])), true);
        if (!is_array($response) || !($response['ok'] ?? false)) {
            throw new RuntimeException('r2.' . $op . ' failed: ' . ($response['error'] ?? 'malformed response'));
        }
        return $response['value'];
    }

    public function put(string $key, string $body, ?string $contentType = null): void {
        if ($this->mode !== 'r2') {
            if (!is_dir($this->localDir)) mkdir($this->localDir, 0777, true);
            file_put_contents($this->localDir . '/' . basename($key), $body);
            return;
        }
        $args = ['key' => $key, 'body' => base64_encode($body)];
        if ($contentType !== null) $args['contentType'] = $contentType;
        $this->call('put', $args);
    }

    public function get(string $key): ?string {
        if ($this->mode !== 'r2') {
            $path = $this->localDir . '/' . basename($key);
            return is_file($path) ? file_get_contents($path) : null;
        }
        $value = $this->call('get', ['key' => $key]);
        return $value === null ? null : base64_decode($value['body']);
    }

    /** @return array<int, array{key: string, size: int}> */
    public function list(string $prefix = ''): array {
        if ($this->mode !== 'r2') {
            if (!is_dir($this->localDir)) return [];
            $out = [];
            foreach (scandir($this->localDir) as $f) {
                if ($f === '.' || $f === '..') continue;
                if ($prefix !== '' && !str_starts_with($f, $prefix)) continue;
                $out[] = ['key' => $f, 'size' => filesize($this->localDir . '/' . $f)];
            }
            return $out;
        }
        $value = $this->call('list', ['prefix' => $prefix]);
        return array_map(
            fn($o) => ['key' => $o['key'], 'size' => $o['size']],
            $value['objects'] ?? []
        );
    }

    public function delete(string $key): void {
        if ($this->mode !== 'r2') {
            @unlink($this->localDir . '/' . basename($key));
            return;
        }
        $this->call('delete', ['key' => $key]);
    }
}
`;

const plainStyleCss = `:root { color-scheme: light; }
body { font-family: system-ui, sans-serif; background: #faf9f7; color: #1c1917; margin: 0; }
main { max-width: 640px; margin: 4rem auto; padding: 0 1.5rem; }
h1 { font-size: 2rem; letter-spacing: -0.02em; }
section { background: #fff; border: 1px solid #e7e2da; border-radius: 12px; padding: 1.5rem; margin-top: 2rem; }
textarea { width: 100%; box-sizing: border-box; border: 1px solid #d6d0c4; border-radius: 8px; padding: .75rem; font: inherit; }
button { background: #175cd3; color: #fff; border: 0; border-radius: 8px; padding: .6rem 1.2rem; font: inherit; cursor: pointer; margin-top: .5rem; }
ul { list-style: none; padding: 0; } li { padding: .4rem 0; border-bottom: 1px solid #f0ece5; }
small { color: #78716c; }
`;

const plainReadme = (name) => `# ${name}

Plain-PHP app deployed on Cloudflare Workers with Skyforge.

## Local dev

\`\`\`sh
php -S localhost:8000
\`\`\`

Storage calls fall back to \`./storage-dev/\` on disk when the
\`cfbindings\` extension is absent (i.e. everywhere except the Worker).

## Deploy

\`\`\`sh
npm install          # installs @workersphp/cli
npx wrangler login   # once per machine (or set CLOUDFLARE_API_TOKEN)
skyforge deploy      # or: npm run deploy
\`\`\`

\`skyforge deploy\` provisions the R2 bucket and KV namespace from
\`skyforge.json\`, packs the app, and publishes it. See \`skyforge.json\`
for the knobs (custom domain, env vars, bake mode).

## Compatibility

Plain PHP here means: no outbound HTTP from PHP, no gd/imagick/intl/iconv,
no exec/proc_open. See docs/skyforge-compatibility.md in the Skyforge repo
for the full table.
`;

const laravelReadme = (name) => `# ${name}

Laravel app deployed on Cloudflare Workers with Skyforge.

## Create the Laravel app

\`\`\`sh
composer create-project laravel/laravel .
composer require workersphp/laravel-bridge
npm install          # installs @workersphp/cli
\`\`\`

Wire the bridge in \`config/\` per the Skyforge guide
(docs/skyforge-guide.md): database \`cfd1\`, cache \`kv\`, filesystem \`r2\`.

## Deploy

\`\`\`sh
npx wrangler login   # once per machine (or set CLOUDFLARE_API_TOKEN)
skyforge deploy
\`\`\`

Provisions D1 + R2 + KV from \`skyforge.json\`, packs, bakes and publishes.
Set \`domain\` in \`skyforge.json\` to attach a custom domain.
`;

const laravelEnvExample = `APP_NAME=Laravel
APP_ENV=production
APP_DEBUG=false
# APP_KEY is generated at deploy time and uploaded as a Worker secret.
# Database / cache / storage drivers are selected by skyforge.json;
# the bridge activates them only when configured.
`;

/**
 * Build the file map for a new project. Pure: (name, framework) -> files.
 * Throws on unknown framework.
 */
export function templateFiles(name, framework, { withR2 = true } = {}) {
	if (!/^[a-z0-9-]+$/.test(name)) {
		throw new Error(`project name must be lowercase alphanumeric with dashes, got: ${name}`);
	}
	if (framework === 'plain') {
		return {
			'index.php': plainIndexPhp(name),
			'lib/storage.php': storagePhp,
			'style.css': plainStyleCss,
			'skyforge.json': skyforgeJson(name, 'plain', withR2),
			'package.json': packageJson(name, 'plain'),
			'.gitignore': gitignore,
			'README.md': plainReadme(name),
		};
	}
	if (framework === 'laravel') {
		return {
			'skyforge.json': skyforgeJson(name, 'laravel', withR2),
			'package.json': packageJson(name, 'laravel'),
			'.env.example': laravelEnvExample,
			'.gitignore': gitignore + '.env\n',
			'README.md': laravelReadme(name),
		};
	}
	throw new Error(`unknown framework: ${framework} (expected "plain" or "laravel")`);
}

/** Write the template files into dir. Creates directories as needed. */
export function initProject(dir, name, framework, opts = {}) {
	const files = templateFiles(name, framework, opts);
	for (const [rel, content] of Object.entries(files)) {
		const full = join(dir, rel);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, content);
	}
	return Object.keys(files);
}
