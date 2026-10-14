// Tests for skyforge/lib/templates.mjs — template listing, validation,
// and scaffolding. Filesystem work happens in tmp dirs; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	listTemplates, getTemplate, validateManifest, scaffoldTemplate,
	renderName, defaultTemplatesRoot,
} from '../lib/templates.mjs';

const ROOT = defaultTemplatesRoot();

test('default templates root exists and ships three templates', () => {
	assert.ok(existsSync(ROOT), `missing ${ROOT}`);
	const names = listTemplates().map((t) => t.name);
	assert.deepEqual(names, ['hello', 'json-api', 'laravel-starter']);
});

test('every shipped template has a valid manifest and a non-empty file tree', () => {
	for (const t of listTemplates()) {
		assert.ok(t.title.trim(), `${t.name}: title`);
		assert.ok(t.description.trim(), `${t.name}: description`);
		assert.ok(['plain', 'laravel'].includes(t.framework), `${t.name}: framework`);
		assert.ok(Array.isArray(t.badges) && t.badges.length > 0, `${t.name}: badges`);
		const { dir } = getTemplate({}, t.name);
		const hasFiles = readdirSync(dir).some((f) => f !== 'template.json');
		assert.ok(hasFiles, `${t.name}: file tree is empty`);
	}
});

test('hello wires r2 + kv, json-api kv only, laravel-starter d1 + r2 + kv', () => {
	const cfg = (name) => {
		const { dir } = getTemplate({}, name);
		return JSON.parse(renderName(readFileSync(join(dir, 'skyforge.json'), 'utf8'), 'myapp'));
	};
	const hello = cfg('hello');
	assert.equal(hello.framework, 'plain');
	assert.equal(hello.r2, 'myapp-uploads');
	assert.equal(hello.kv, 'myapp-cache');
	assert.equal(hello.d1, null);
	const api = cfg('json-api');
	assert.equal(api.r2, null);
	assert.equal(api.kv, 'myapp-cache');
	const lara = cfg('laravel-starter');
	assert.equal(lara.framework, 'laravel');
	assert.equal(lara.d1, 'myapp-db');
	assert.equal(lara.r2, 'myapp-uploads');
	assert.equal(lara.kv, 'myapp-cache');
});

test('validateManifest rejects bad manifests', () => {
	assert.throws(() => validateManifest({ name: 'x', title: 'T', description: 'D', framework: 'plain' }, 'y'), /does not match directory/);
	assert.throws(() => validateManifest({ name: 'x', title: '', description: 'D', framework: 'plain' }, 'x'), /non-empty "title"/);
	assert.throws(() => validateManifest({ name: 'x', title: 'T', description: 'D', framework: 'django' }, 'x'), /framework must be/);
	assert.throws(() => validateManifest({ name: 'x', title: 'T', description: 'D', framework: 'plain', badges: 'nope' }, 'x'), /must be an array/);
	assert.throws(() => validateManifest(null, 'x'), /must be a JSON object/);
});

test('getTemplate throws on unknown template', () => {
	assert.throws(() => getTemplate({}, 'wordpress'), /unknown template/);
	assert.throws(() => getTemplate({}, '../lib'), /unknown template/);
});

test('listTemplates throws on unreadable root', () => {
	assert.throws(() => listTemplates({ root: join(tmpdir(), 'no-such-dir-xyz') }), /cannot read templates directory/);
});

test('renderName replaces every token', () => {
	assert.equal(renderName('{{name}} and {{name}}', 'x'), 'x and x');
	assert.equal(renderName('no tokens', 'x'), 'no tokens');
});

function fixtureRoot() {
	const root = mkdtempSync(join(tmpdir(), 'tpl-root-'));
	const dir = join(root, 'demo');
	mkdirSync(join(dir, 'lib'), { recursive: true });
	writeFileSync(join(dir, 'template.json'), JSON.stringify({
		name: 'demo', title: 'Demo', description: 'A demo.', framework: 'plain',
		badges: ['PHP'], requirements: [],
	}));
	writeFileSync(join(dir, 'index.php'), '<?php // {{name}} ?>');
	writeFileSync(join(dir, 'lib', 'a.php'), '<?php // {{name}}-{{name}} ?>');
	return root;
}

test('scaffoldTemplate copies files with {{name}} substituted, skipping the manifest', () => {
	const root = fixtureRoot();
	const target = join(tmpdir(), 'tpl-target-' + Date.now());
	const written = scaffoldTemplate({ root }, 'demo', 'my-app', target);
	assert.deepEqual(written, ['index.php', 'lib/a.php']);
	assert.equal(readFileSync(join(target, 'index.php'), 'utf8'), '<?php // my-app ?>');
	assert.equal(readFileSync(join(target, 'lib/a.php'), 'utf8'), '<?php // my-app-my-app ?>');
	assert.ok(!existsSync(join(target, 'template.json')), 'manifest must not be copied');
});

test('scaffoldTemplate refuses a non-empty dir without --force, overwrites with it', () => {
	const root = fixtureRoot();
	const target = mkdtempSync(join(tmpdir(), 'tpl-nonempty-'));
	writeFileSync(join(target, 'existing.txt'), 'keep me');
	assert.throws(
		() => scaffoldTemplate({ root }, 'demo', 'my-app', target),
		/not empty.*--force/,
	);
	const written = scaffoldTemplate({ root }, 'demo', 'my-app', target, { force: true });
	assert.ok(written.includes('index.php'));
	assert.equal(readFileSync(join(target, 'index.php'), 'utf8'), '<?php // my-app ?>');
});

test('scaffoldTemplate validates the project name', () => {
	const root = fixtureRoot();
	const target = join(tmpdir(), 'tpl-badname-' + Date.now());
	assert.throws(() => scaffoldTemplate({ root }, 'demo', 'Bad Name!', target), /lowercase alphanumeric/);
});

test('scaffoldTemplate rejects an empty template', () => {
	const root = mkdtempSync(join(tmpdir(), 'tpl-emptyroot-'));
	const dir = join(root, 'empty');
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'template.json'), JSON.stringify({
		name: 'empty', title: 'Empty', description: 'Nothing here.', framework: 'plain',
	}));
	assert.throws(
		() => scaffoldTemplate({ root }, 'empty', 'my-app', join(tmpdir(), 'tpl-empty-' + Date.now())),
		/is empty/,
	);
});
