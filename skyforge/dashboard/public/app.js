// Skyforge dashboard client. No build step, no dependencies.
const $ = (id) => document.getElementById(id);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (res.status === 401) return { connected: false };
  return res.json();
}

function renderConn(state) {
  const el = $('conn');
  if (state.connected) {
    el.innerHTML = `<span class="pill on">connected${state.account?.name ? ' · ' + esc(state.account.name) : ''}</span>` +
      `<button class="link" id="disconnect">disconnect</button>`;
    $('disconnect').onclick = async () => {
      await api('/api/disconnect', { method: 'POST' });
      location.reload();
    };
    $('connect-panel').classList.add('hidden');
  } else {
    el.innerHTML = `<span class="pill off">not connected</span>`;
    $('connect-panel').classList.remove('hidden');
  }
}

function renderDeployments(list) {
  const el = $('deployments');
  $('deploy-count').textContent = list.length ? `${list.length} project${list.length > 1 ? 's' : ''}` : '';
  if (!list.length) {
    el.innerHTML = `<p class="muted">No deployments recorded yet.<br>Run <span class="mono">skyforge deploy</span> in a project, then come back.</p>`;
    return;
  }
  el.innerHTML = `<table><thead><tr>
    <th>Project</th><th>URL</th><th>Last deploy</th><th>Status</th><th>Resources</th>
  </tr></thead><tbody>` + list.map((d) => {
    const res = d.resources || {};
    const badges = ['d1', 'r2', 'kv', 'queue']
      .filter((k) => res[k]).map((k) => `<span class="badge">${k}: ${esc(res[k])}</span>`).join('');
    return `<tr>
      <td><strong>${esc(d.name)}</strong><br><span class="muted">${esc(d.framework || '')}</span></td>
      <td><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.domain || d.url.replace(/^https?:\/\//, ''))}</a></td>
      <td>${esc((d.lastDeploy || '').slice(0, 16).replace('T', ' '))}</td>
      <td><span class="status ${esc(d.status)}">${esc(d.status)}</span></td>
      <td>${badges || '<span class="muted">—</span>'}</td>
    </tr>`;
  }).join('') + `</tbody></table>`;
}

function fmtWhen(iso) {
  return (iso || '').slice(0, 16).replace('T', ' ');
}

function typeBadge(t) {
  return `<span class="type ${esc(t || 'production')}">${esc(t || 'production')}</span>`;
}

async function pollJob(jobId, label, done) {
  const el = $('job-status');
  el.classList.remove('hidden');
  el.textContent = `${label}… running`;
  const tick = async () => {
    const r = await api(`/api/jobs/${jobId}`).catch(() => ({}));
    const job = r.job;
    if (!job) { el.textContent = `${label}… lost track of job`; return; }
    if (job.status === 'running') { setTimeout(tick, 2000); return; }
    if (job.status === 'done') {
      el.textContent = `${label}… done`;
      done && done();
    } else {
      el.innerHTML = `<span class="error">${esc(label)} failed: ${esc(job.error || 'unknown error')}</span>`;
    }
  };
  tick();
}

function renderPreviews(previews) {
  const el = $('previews');
  if (!previews.length) {
    el.innerHTML = `<p class="muted">No active previews.<br>Run <span class="mono">skyforge preview</span> in a project to get a unique preview URL.</p>`;
    return;
  }
  el.innerHTML = `<table><thead><tr>
    <th>Preview</th><th>Project</th><th>Commit</th><th>Created</th><th></th>
  </tr></thead><tbody>` + previews.map((p) => {
    const e = p.entry;
    return `<tr>
      <td><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.url.replace(/^https?:\/\//, ''))}</a><br>
        <span class="muted mono">${esc(e.id)}</span></td>
      <td>${esc(p.project)}</td>
      <td class="mono">${esc((e.commit || '?').slice(0, 8))}${e.branch ? `<br><span class="muted">${esc(e.branch)}</span>` : ''}</td>
      <td>${esc(fmtWhen(e.at))}</td>
      <td class="row-actions"><button class="danger" data-clean="${esc(e.id)}">clean</button></td>
    </tr>`;
  }).join('') + `</tbody></table>`;
  el.querySelectorAll('[data-clean]').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('Delete this preview worker?')) return;
      btn.disabled = true;
      const r = await api('/api/preview-clean', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: btn.dataset.clean }),
      }).catch((e) => ({ ok: false, error: e.message }));
      if (!r.ok) { alert('clean failed: ' + (r.error || 'unknown')); btn.disabled = false; return; }
      pollJob(r.job, 'Cleaning preview', () => boot());
    };
  });
}

async function loadHistory(project) {
  const el = $('history');
  if (!project) { el.innerHTML = `<p class="muted">pick a project to see its release history.</p>`; return; }
  const r = await api(`/api/history?project=${encodeURIComponent(project)}`).catch(() => ({}));
  const list = (r && r.history) || [];
  if (!list.length) { el.innerHTML = `<p class="muted">No releases recorded for ${esc(project)} yet.</p>`; return; }
  el.innerHTML = `<table><thead><tr>
    <th>Release</th><th>When</th><th>Commit</th><th>Status</th><th></th>
  </tr></thead><tbody>` + list.map((h) => {
    const canRollback = (h.type === 'production' || h.type === 'rollback') && h.commit && h.status !== 'failed';
    return `<tr>
      <td>${typeBadge(h.type)}<span class="mono">${esc(h.id)}</span>
        ${h.rollbackOf ? `<br><span class="muted">rollback of ${esc(h.rollbackOf)}</span>` : ''}</td>
      <td>${esc(fmtWhen(h.at))}</td>
      <td class="mono">${esc((h.commit || '—').slice(0, 8))}${h.branch ? `<br><span class="muted">${esc(h.branch)}</span>` : ''}${h.dirty ? ' <span class="badge">dirty</span>' : ''}</td>
      <td><span class="status">${esc(h.status)}</span></td>
      <td class="row-actions">${canRollback ? `<button class="ghost" data-rollback="${esc(h.id)}" data-project="${esc(project)}">roll back to this</button>` : ''}</td>
    </tr>`;
  }).join('') + `</tbody></table>`;
  el.querySelectorAll('[data-rollback]').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm(`Roll back ${btn.dataset.project} to ${btn.dataset.rollback}? Production will be redeployed from that commit.`)) return;
      btn.disabled = true;
      const r = await api('/api/rollback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: btn.dataset.project, targetId: btn.dataset.rollback }),
      }).catch((e) => ({ ok: false, error: e.message }));
      if (!r.ok) { alert('rollback failed to start: ' + (r.error || 'unknown')); btn.disabled = false; return; }
      pollJob(r.job, 'Rolling back', () => boot());
    };
  });
}

async function loadLog(deploymentId, deployments) {
  const el = $('log-view');
  if (!deploymentId) { el.innerHTML = `<p class="muted">pick a deployment to view its recorded log.</p>`; return; }
  const r = await api(`/api/log?deployment=${encodeURIComponent(deploymentId)}`).catch(() => ({}));
  if (!r || !r.ok) { el.innerHTML = `<p class="error">${esc((r && r.error) || 'could not load log')}</p>`; return; }
  el.innerHTML = `<p>${typeBadge(r.type)}<strong class="mono">${esc(r.id)}</strong>
    <span class="muted">${esc(r.project)} · ${esc(fmtWhen(r.at))} · ${esc((r.commit || '—').slice(0, 8))}</span></p>
    <p class="muted">${esc(r.note)}</p>` +
    (r.logTail ? `<pre class="log">${esc(r.logTail)}</pre>` : '');
}

function fillLogSelect(deployments) {
  const sel = $('log-deploy');
  const entries = [];
  for (const d of deployments) {
    for (const h of (d.history || [])) entries.push({ project: d.name, h });
  }
  entries.sort((a, b) => (a.h.at < b.h.at ? 1 : -1));
  const recent = entries.slice(0, 30);
  sel.innerHTML = `<option value="">— pick a deployment —</option>` + recent.map(({ project, h }) =>
    `<option value="${esc(h.id)}">${esc(project)} · ${esc(h.type)} · ${esc(fmtWhen(h.at))}</option>`).join('');
  sel.onchange = () => loadLog(sel.value, deployments);
}

function renderR2(data) {
  const el = $('r2');
  if (!data || data.connected === false) {
    el.innerHTML = `<p class="muted">connect your account to see live usage.</p>`;
    return;
  }
  if (!data.ok) {
    el.innerHTML = `<p class="error">couldn't load buckets: ${esc(data.error)}</p>`;
    return;
  }
  if (!data.buckets.length) {
    el.innerHTML = `<p class="muted">No R2 buckets in this account yet. <span class="mono">skyforge deploy</span> creates one per project.</p>`;
    return;
  }
  el.innerHTML = `<div class="grid">` + data.buckets.map((b) =>
    `<div class="tile"><div class="name">${esc(b.name)}</div>
     <div class="big">${esc(b.display)}</div>
     <div class="sub">stored objects${data.usageOk ? '' : ' · usage unavailable: ' + esc(data.usageError || '')}</div>
    </div>`).join('') + `</div>`;
}

function renderD1(data) {
  const el = $('d1');
  if (!data || data.connected === false) {
    el.innerHTML = `<p class="muted">connect your account to see live databases.</p>`;
    return;
  }
  if (!data.ok) {
    el.innerHTML = `<p class="error">couldn't load databases: ${esc(data.error)}</p>`;
    return;
  }
  if (!data.databases.length) {
    el.innerHTML = `<p class="muted">No D1 databases in this account yet.</p>`;
    return;
  }
  el.innerHTML = `<div class="grid">` + data.databases.map((d) =>
    `<div class="tile"><div class="name">${esc(d.name)}</div>
     <div class="big">${esc(d.display)}</div>
     <div class="sub mono">${esc(d.uuid.slice(0, 8))}…</div>
    </div>`).join('') + `</div>`;
}

function renderTemplates(templates) {
  const el = $('templates');
  if (!templates.length) {
    el.innerHTML = '<p class="muted">no templates installed.</p>';
    return;
  }
  el.innerHTML = '<div class="grid">' + templates.map((t) => {
    const cmd = `skyforge init --template ${t.name} my-app`;
    const badges = (t.badges || []).map((b) => `<span class="badge">${esc(b)}</span>`).join('');
    const reqs = (t.requirements || []).map((r) => `<li>${esc(r)}</li>`).join('');
    return `<div class="tile tpl">
      <div class="name">${esc(t.title)}</div>
      <div class="sub mono">${esc(t.name)} · ${esc(t.framework)}</div>
      <p class="tpl-desc">${esc(t.description)}</p>
      <div>${badges}</div>
      ${reqs ? `<ul class="tpl-reqs">${reqs}</ul>` : ''}
      <div class="cmd"><span class="mono">${esc(cmd)}</span>
        <button class="ghost" data-cmd="${esc(cmd)}">copy</button></div>
    </div>`;
  }).join('') + '</div>';
  el.querySelectorAll('button[data-cmd]').forEach((btn) => {
    btn.onclick = async () => {
      const cmd = btn.getAttribute('data-cmd');
      try {
        await navigator.clipboard.writeText(cmd);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = cmd; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove();
      }
      btn.textContent = 'copied';
      setTimeout(() => { btn.textContent = 'copy'; }, 1500);
    };
  });
}

async function boot() {
  const state = await api('/api/state').catch(() => ({}));
  renderConn(state);
  renderDeployments(state.deployments || []);
  renderPreviews(state.previews || []);
  const tpl = await api('/api/templates').catch(() => ({ templates: [] }));
  renderTemplates(tpl.templates || []);
  const projects = (state.deployments || []).map((d) => d.name);
  const hsel = $('history-project');
  hsel.innerHTML = `<option value="">— pick a project —</option>` +
    projects.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
  hsel.onchange = () => loadHistory(hsel.value);
  fillLogSelect(state.deployments || []);
  if (state.connected) {
    renderR2({ connected: false });
    renderD1({ connected: false });
    const [r2, d1] = await Promise.all([
      api('/api/r2').catch((e) => ({ ok: false, error: e.message })),
      api('/api/d1').catch((e) => ({ ok: false, error: e.message })),
    ]);
    renderR2(r2);
    renderD1(d1);
  } else {
    renderR2(null);
    renderD1(null);
  }
}

$('connect-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = $('token').value.trim();
  if (!token) return;
  const res = await api('/api/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  }).catch((err) => ({ ok: false, error: err.message }));
  if (res.ok) {
    location.reload();
  } else {
    const err = $('connect-error');
    err.textContent = res.error || 'connection failed';
    err.classList.remove('hidden');
  }
});

boot();
