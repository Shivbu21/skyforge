// Cloudflare API client for the Skyforge dashboard.
// All request construction is pure; `fetchImpl` is injectable so tests
// never touch the network. The token is always caller-supplied and is
// never written to disk by this module.

const API = 'https://api.cloudflare.com/client/v4';

function headers(token) {
	return {
		Authorization: `Bearer ${token}`,
		'Content-Type': 'application/json',
	};
}

async function get(path, { token, fetchImpl = fetch }) {
	const res = await fetchImpl(API + path, { headers: headers(token) });
	let body = null;
	try { body = await res.json(); } catch { /* non-JSON error body */ }
	return { status: res.status, body };
}

/** Verify a token; returns { ok, accountId?, accountName?, error? }. */
export async function verifyToken(token, { fetchImpl = fetch } = {}) {
	if (!token) return { ok: false, error: 'no token provided' };
	let res;
	try {
		res = await get('/user/tokens/verify', { token, fetchImpl });
	} catch (e) {
		return { ok: false, error: `network error: ${e.message}` };
	}
	if (res.status !== 200 || !res.body?.success) {
		const msg = res.body?.errors?.[0]?.message || `HTTP ${res.status}`;
		return { ok: false, error: `token rejected: ${msg}` };
	}
	// Tokens/verify does not return the account; fetch the account list.
	const accounts = await get('/accounts', { token, fetchImpl });
	const first = accounts.body?.result?.[0];
	return {
		ok: true,
		accountId: first?.id || null,
		accountName: first?.name || null,
	};
}

/** List R2 buckets for an account. Returns { ok, buckets?, error? }. */
export async function listR2Buckets(accountId, token, { fetchImpl = fetch } = {}) {
	let res;
	try {
		res = await get(`/accounts/${accountId}/r2/buckets`, { token, fetchImpl });
	} catch (e) {
		return { ok: false, error: `network error: ${e.message}` };
	}
	if (res.status !== 200 || !res.body?.success) {
		return { ok: false, error: res.body?.errors?.[0]?.message || `HTTP ${res.status}` };
	}
	return {
		ok: true,
		buckets: (res.body.result || []).map((b) => ({ name: b.name, created: b.creation_date || null })),
	};
}

/** List D1 databases for an account. Returns { ok, databases?, error? }. */
export async function listD1Databases(accountId, token, { fetchImpl = fetch } = {}) {
	let res;
	try {
		res = await get(`/accounts/${accountId}/d1/database`, { token, fetchImpl });
	} catch (e) {
		return { ok: false, error: `network error: ${e.message}` };
	}
	if (res.status !== 200 || !res.body?.success) {
		return { ok: false, error: res.body?.errors?.[0]?.message || `HTTP ${res.status}` };
	}
	return {
		ok: true,
		databases: (res.body.result || []).map((d) => ({
			name: d.name, uuid: d.uuid, sizeBytes: d.file_size_bytes ?? null,
		})),
	};
}

/**
 * Build the GraphQL query for R2 storage usage per bucket over the last
 * `days` days. Pure — returns { query, variables }.
 */
export function buildR2StorageQuery(accountTag, days = 30) {
	const end = new Date();
	const start = new Date(end.getTime() - days * 24 * 3600 * 1000);
	const query = `
query R2Storage($accountTag: string!, $start: Time!, $end: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      r2StorageAdaptiveGroups(
        limit: 100
        filter: { datetime_geq: $start, datetime_leq: $end }
      ) {
        sum { payloadSize metadataSize }
        dimensions { bucketName }
      }
    }
  }
}`.trim();
	return {
		query,
		variables: {
			accountTag,
			start: start.toISOString(),
			end: end.toISOString(),
		},
	};
}

/**
 * Parse the GraphQL storage response into [{ bucket, bytes }].
 * Pure. Returns { ok, usage? , error? }.
 */
export function parseR2StorageUsage(body) {
	try {
		const groups = body?.data?.viewer?.accounts?.[0]?.r2StorageAdaptiveGroups;
		if (!Array.isArray(groups)) {
			const msg = body?.errors?.[0]?.message || 'unexpected GraphQL response shape';
			return { ok: false, error: msg };
		}
		// Multiple day-groups per bucket: take the latest group per bucket.
		const latest = new Map();
		for (const g of groups) {
			const bucket = g?.dimensions?.bucketName;
			if (!bucket) continue;
			const bytes = (g?.sum?.payloadSize || 0) + (g?.sum?.metadataSize || 0);
			latest.set(bucket, bytes); // groups arrive newest-first in practice; last write wins deterministically
		}
		return {
			ok: true,
			usage: [...latest.entries()].map(([bucket, bytes]) => ({ bucket, bytes })),
		};
	} catch (e) {
		return { ok: false, error: e.message };
	}
}

/** Fetch R2 storage usage. Returns { ok, usage?, error? }. */
export async function fetchR2Usage(accountTag, token, { fetchImpl = fetch, days = 30 } = {}) {
	const { query, variables } = buildR2StorageQuery(accountTag, days);
	let res;
	try {
		res = await fetchImpl('https://api.cloudflare.com/graphql', {
			method: 'POST',
			headers: headers(token),
			body: JSON.stringify({ query, variables }),
		});
	} catch (e) {
		return { ok: false, error: `network error: ${e.message}` };
	}
	if (res.status !== 200) return { ok: false, error: `GraphQL HTTP ${res.status}` };
	return parseR2StorageUsage(await res.json());
}

/** Human-readable byte size. Pure. */
export function formatBytes(bytes) {
	if (bytes == null || Number.isNaN(bytes)) return '—';
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB', 'TB'];
	let v = bytes / 1024;
	let u = 0;
	while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
	return `${v.toFixed(v < 10 ? 1 : 0)} ${units[u]}`;
}
