<?php
// Minimal KV helper.
//
// On Cloudflare Workers, cf_bindings_call with kind 'kv' talks to the
// CACHE binding (wired by skyforge deploy from skyforge.json -> kv).
// In local dev the extension is absent and values persist in
// ./storage-dev/kv.json on disk. Same API both ways.
//
// KV is eventually consistent: perfect for counters, flags, and caches —
// reach for D1 (the laravel-starter template) when you need strong
// consistency or relational queries.

class SkyforgeKV {
    private string $mode;
    private string $file;

    public function __construct() {
        $this->mode = function_exists('cf_bindings_call') ? 'kv' : 'local';
        $this->file = __DIR__ . '/../storage-dev/kv.json';
    }

    public function backend(): string {
        return $this->mode === 'kv' ? 'kv' : 'local-dev';
    }

    private function call(string $op, array $args): mixed {
        $response = json_decode(cf_bindings_call(json_encode([
            'kind' => 'kv', 'op' => $op, 'args' => $args,
        ])), true);
        if (!is_array($response) || !($response['ok'] ?? false)) {
            throw new RuntimeException('kv.' . $op . ' failed: ' . ($response['error'] ?? 'malformed response'));
        }
        return $response['value'];
    }

    private function localRead(): array {
        if (!is_file($this->file)) return [];
        $data = json_decode(file_get_contents($this->file), true);
        return is_array($data) ? $data : [];
    }

    private function localWrite(array $data): void {
        $dir = dirname($this->file);
        if (!is_dir($dir)) mkdir($dir, 0777, true);
        file_put_contents($this->file, json_encode($data));
    }

    public function get(string $key): ?string {
        if ($this->mode !== 'kv') {
            $data = $this->localRead();
            return array_key_exists($key, $data) ? (string) $data[$key] : null;
        }
        $value = $this->call('get', ['key' => $key]);
        return $value === null ? null : (string) $value;
    }

    public function put(string $key, string $value, ?int $ttl = null): void {
        if ($this->mode !== 'kv') {
            $data = $this->localRead();
            $data[$key] = $value;
            $this->localWrite($data);
            return;
        }
        $args = ['key' => $key, 'value' => $value];
        if ($ttl !== null) $args['ttl'] = $ttl;
        $this->call('put', $args);
    }

    public function delete(string $key): void {
        if ($this->mode !== 'kv') {
            $data = $this->localRead();
            unset($data[$key]);
            $this->localWrite($data);
            return;
        }
        $this->call('delete', ['key' => $key]);
    }
}
