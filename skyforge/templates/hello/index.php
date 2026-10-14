<?php
// {{name}} — plain PHP on Cloudflare Workers (Skyforge template: hello).
// Served by the runtime's vanilla adapter: $_SERVER/$_GET/$_POST are set,
// echo becomes the response body.
require __DIR__ . '/lib/storage.php';
require __DIR__ . '/lib/kv.php';

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$storage = new SkyforgeStorage();
$kv = new SkyforgeKV();

if ($path === '/api/time') {
    header('Content-Type: application/json');
    echo json_encode(['time' => date('c'), 'app' => '{{name}}']);
    return;
}

if ($path === '/api/visits') {
    // KV-backed counter. Eventually consistent — fine for a demo counter,
    // not for money. See the json-api template for CRUD patterns.
    $count = (int) ($kv->get('visits') ?? 0) + 1;
    $kv->put('visits', (string) $count);
    header('Content-Type: application/json');
    echo json_encode(['visits' => $count]);
    return;
}

if ($path === '/files' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    header('Content-Type: application/json');
    echo json_encode(['files' => $storage->list()]);
    return;
}

if ($path === '/upload' && $_SERVER['REQUEST_METHOD'] === 'POST') {
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
<title>{{name}} — on Cloudflare</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<main>
  <h1>{{name}}</h1>
  <p>Plain PHP, running on Cloudflare Workers via Skyforge.</p>
  <p class="muted">Server time: <span id="time">…</span> · Visits: <span id="visits">…</span></p>
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
fetch('/api/time').then(r => r.json()).then(d => document.getElementById('time').textContent = d.time);
fetch('/api/visits').then(r => r.json()).then(d => document.getElementById('visits').textContent = d.visits);
list();
</script>
</body>
</html>
