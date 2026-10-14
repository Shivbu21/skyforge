<?php
// {{name}} — JSON REST API in plain PHP on Cloudflare Workers
// (Skyforge template: json-api).
//
// Notes CRUD over KV. KV is eventually consistent and schemaless: great
// for a starter API, caches, and feature flags. When you need relational
// queries or strong consistency, switch to the laravel-starter template
// (D1 via the Laravel bridge).
require __DIR__ . '/lib/kv.php';

header('Content-Type: application/json');
// Permissive CORS is for local dev; tighten this before production.
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    return;
}

$kv = new SkyforgeKV();

function json_body(): array {
    $raw = file_get_contents('php://input');
    if ($raw === '' || $raw === false) return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function respond(mixed $data, int $status = 200): void {
    http_response_code($status);
    echo json_encode($data);
}

function note_key(string $id): string { return 'note:' . $id; }

function note_index(SkyforgeKV $kv): array {
    $raw = $kv->get('note:index');
    $ids = $raw ? json_decode($raw, true) : [];
    return is_array($ids) ? array_values($ids) : [];
}

function note_index_save(SkyforgeKV $kv, array $ids): void {
    $kv->put('note:index', json_encode(array_values($ids)));
}

function note_get(SkyforgeKV $kv, string $id): ?array {
    $raw = $kv->get(note_key($id));
    if ($raw === null) return null;
    $note = json_decode($raw, true);
    return is_array($note) ? $note : null;
}

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];

// GET /api/notes — list all (newest first)
if ($path === '/api/notes' && $method === 'GET') {
    $notes = [];
    foreach (array_reverse(note_index($kv)) as $id) {
        $note = note_get($kv, $id);
        if ($note !== null) $notes[] = $note;
    }
    respond(['notes' => $notes, 'backend' => $kv->backend()]);
    return;
}

// POST /api/notes — create {title, body?} -> 201
if ($path === '/api/notes' && $method === 'POST') {
    $input = json_body();
    $title = trim((string) ($input['title'] ?? ''));
    if ($title === '') {
        respond(['error' => 'title is required'], 422);
        return;
    }
    $id = bin2hex(random_bytes(8));
    $note = [
        'id' => $id,
        'title' => mb_substr($title, 0, 200),
        'body' => mb_substr((string) ($input['body'] ?? ''), 0, 5000),
        'created_at' => date('c'),
    ];
    $kv->put(note_key($id), json_encode($note));
    $ids = note_index($kv);
    $ids[] = $id;
    note_index_save($kv, $ids);
    respond($note, 201);
    return;
}

// /api/notes/{id}
if (preg_match('#^/api/notes/([0-9a-f]{16})$#', $path, $m)) {
    $id = $m[1];
    $note = note_get($kv, $id);

    if ($method === 'GET') {
        if ($note === null) { respond(['error' => 'not found'], 404); return; }
        respond($note);
        return;
    }

    if ($method === 'PUT') {
        if ($note === null) { respond(['error' => 'not found'], 404); return; }
        $input = json_body();
        if (array_key_exists('title', $input)) {
            $title = trim((string) $input['title']);
            if ($title === '') { respond(['error' => 'title cannot be empty'], 422); return; }
            $note['title'] = mb_substr($title, 0, 200);
        }
        if (array_key_exists('body', $input)) {
            $note['body'] = mb_substr((string) $input['body'], 0, 5000);
        }
        $note['updated_at'] = date('c');
        $kv->put(note_key($id), json_encode($note));
        respond($note);
        return;
    }

    if ($method === 'DELETE') {
        if ($note === null) { respond(['error' => 'not found'], 404); return; }
        $kv->delete(note_key($id));
        note_index_save($kv, array_values(array_filter(
            note_index($kv), fn($x) => $x !== $id
        )));
        http_response_code(204);
        return;
    }
}

// GET / — small usage doc
if ($path === '/' && $method === 'GET') {
    respond([
        'app' => '{{name}}',
        'backend' => $kv->backend(),
        'endpoints' => [
            'GET    /api/notes' => 'list notes',
            'POST   /api/notes' => 'create note {title, body?}',
            'GET    /api/notes/{id}' => 'fetch one',
            'PUT    /api/notes/{id}' => 'update {title?, body?}',
            'DELETE /api/notes/{id}' => 'delete',
        ],
    ]);
    return;
}

respond(['error' => 'not found'], 404);
