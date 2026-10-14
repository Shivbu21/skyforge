<?php
// Skyforge storage helper (R2).
//
// On Cloudflare Workers the cfbindings extension is compiled into the PHP
// binary, so R2 calls are synchronous. In local dev (plain `php -S`) the
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
