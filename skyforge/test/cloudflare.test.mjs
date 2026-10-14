// Tests for skyforge/lib/cloudflare.mjs — pure builders/parsers plus the
// API client with an injected fake fetch. No real network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
	verifyToken, listR2Buckets, listD1Databases,
	buildR2StorageQuery, parseR2StorageUsage, formatBytes,
} from '../lib/cloudflare.mjs';

const okJson = (body, status = 200) => async () => ({
	status,
	json: async () => body,
});

test('verifyToken returns account on success', async () => {
	let n = 0;
	const fetchImpl = async (url) => {
		n++;
		if (url.endsWith('/user/tokens/verify')) return okJson({ success: true, result: { id: 't' } })();
		return okJson({ success: true, result: [{ id: 'acc-1', name: 'Acme' }] })();
	};
	const r = await verifyToken('tok', { fetchImpl });
	assert.deepEqual(r, { ok: true, accountId: 'acc-1', accountName: 'Acme' });
	assert.equal(n, 2);
});

test('verifyToken reports rejection cleanly', async () => {
	const fetchImpl = okJson({ success: false, errors: [{ message: 'invalid token' }] }, 401);
	const r = await verifyToken('bad', { fetchImpl });
	assert.equal(r.ok, false);
	assert.match(r.error, /invalid token/);
});

test('verifyToken reports network failure cleanly', async () => {
	const r = await verifyToken('tok', { fetchImpl: async () => { throw new Error('dns fail'); } });
	assert.equal(r.ok, false);
	assert.match(r.error, /network error/);
});

test('verifyToken rejects empty token without network', async () => {
	let called = false;
	const r = await verifyToken('', { fetchImpl: async () => { called = true; } });
	assert.equal(r.ok, false);
	assert.equal(called, false);
});

test('listR2Buckets maps the REST shape', async () => {
	const fetchImpl = okJson({ success: true, result: [{ name: 'b1', creation_date: '2026-01-01' }] });
	const r = await listR2Buckets('acc', 'tok', { fetchImpl });
	assert.deepEqual(r, { ok: true, buckets: [{ name: 'b1', created: '2026-01-01' }] });
});

test('listD1Databases maps the REST shape', async () => {
	const fetchImpl = okJson({ success: true, result: [{ name: 'db', uuid: 'u1', file_size_bytes: 1234 }] });
	const r = await listD1Databases('acc', 'tok', { fetchImpl });
	assert.deepEqual(r, { ok: true, databases: [{ name: 'db', uuid: 'u1', sizeBytes: 1234 }] });
});

test('buildR2StorageQuery is pure and well-formed', () => {
	const { query, variables } = buildR2StorageQuery('acc-tag', 7);
	assert.match(query, /r2StorageAdaptiveGroups/);
	assert.match(query, /\$accountTag/);
	assert.equal(variables.accountTag, 'acc-tag');
	assert.ok(new Date(variables.end) - new Date(variables.start) === 7 * 24 * 3600 * 1000);
});

test('parseR2StorageUsage sums payload + metadata per bucket', () => {
	const body = {
		data: { viewer: { accounts: [{ r2StorageAdaptiveGroups: [
			{ dimensions: { bucketName: 'a' }, sum: { payloadSize: 100, metadataSize: 10 } },
			{ dimensions: { bucketName: 'b' }, sum: { payloadSize: 5, metadataSize: null } },
		] }] } },
	};
	const r = parseR2StorageUsage(body);
	assert.deepEqual(r, { ok: true, usage: [{ bucket: 'a', bytes: 110 }, { bucket: 'b', bytes: 5 }] });
});

test('parseR2StorageUsage reports GraphQL errors', () => {
	const r = parseR2StorageUsage({ errors: [{ message: 'boom' }] });
	assert.equal(r.ok, false);
	assert.match(r.error, /boom/);
});

test('formatBytes renders human sizes', () => {
	assert.equal(formatBytes(0), '0 B');
	assert.equal(formatBytes(512), '512 B');
	assert.equal(formatBytes(2048), '2.0 KB');
	assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
	assert.equal(formatBytes(null), '—');
});
