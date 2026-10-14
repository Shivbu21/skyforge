// Skyforge template gallery: curated starter apps as on-disk directories.
// Each template lives in skyforge/templates/<name>/ with a template.json
// manifest plus the file tree to copy. {{name}} in file contents is
// replaced with the project name at scaffold time.
//
// Pure-ish: every function takes an explicit root dir (tests use tmp dirs).
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const MANIFEST = 'template.json';
const TOKEN = '{{name}}';
const VALID_FRAMEWORKS = ['plain', 'laravel'];

/** Default templates root: skyforge/templates/ next to this file. */
export function defaultTemplatesRoot() {
	return join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');
}

function readManifest(dir, name) {
	const path = join(dir, name, MANIFEST);
	let raw;
	try {
		raw = readFileSync(path, 'utf8');
	} catch {
		throw new Error(`template "${name}" has no ${MANIFEST} (${path})`);
	}
	let manifest;
	try {
		manifest = JSON.parse(raw);
	} catch (e) {
		throw new Error(`template "${name}": ${MANIFEST} is not valid JSON: ${e.message}`);
	}
	validateManifest(manifest, name);
	return manifest;
}

/** Validate a parsed manifest. Throws with a plain-English reason. */
export function validateManifest(manifest, dirName) {
	if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
		throw new Error(`template "${dirName}": ${MANIFEST} must be a JSON object`);
	}
	if (manifest.name !== dirName) {
		throw new Error(`template "${dirName}": manifest name "${manifest.name}" does not match directory`);
	}
	for (const field of ['title', 'description']) {
		if (typeof manifest[field] !== 'string' || manifest[field].trim() === '') {
			throw new Error(`template "${dirName}": ${MANIFEST} needs a non-empty "${field}"`);
		}
	}
	if (!VALID_FRAMEWORKS.includes(manifest.framework)) {
		throw new Error(`template "${dirName}": framework must be ${VALID_FRAMEWORKS.join('|')}, got "${manifest.framework}"`);
	}
	for (const field of ['badges', 'requirements']) {
		if (manifest[field] !== undefined && !Array.isArray(manifest[field])) {
			throw new Error(`template "${dirName}": "${field}" must be an array of strings`);
		}
	}
	return manifest;
}

/** List all valid templates in root, sorted by name. Throws if root is unreadable. */
export function listTemplates({ root = defaultTemplatesRoot() } = {}) {
	let entries;
	try {
		entries = readdirSync(root, { withFileTypes: true });
	} catch (e) {
		throw new Error(`cannot read templates directory ${root}: ${e.message}`);
	}
	const out = [];
	for (const e of entries) {
		if (!e.isDirectory()) continue;
		out.push(readManifest(root, e.name));
	}
	out.sort((a, b) => a.name.localeCompare(b.name));
	return out;
}

/** Get one template's manifest. Throws if missing or invalid. */
export function getTemplate({ root = defaultTemplatesRoot() } = {}, name) {
	if (!/^[a-z0-9-]+$/.test(name || '')) {
		throw new Error(`unknown template: ${name}`);
	}
	const dir = join(root, name);
	if (!existsSync(dir) || !statSync(dir).isDirectory()) {
		throw new Error(`unknown template: ${name} (run "skyforge templates" to list)`);
	}
	return { manifest: readManifest(root, name), dir };
}

/** Replace every {{name}} token. Pure. */
export function renderName(content, name) {
	return content.split(TOKEN).join(name);
}

function walkFiles(dir) {
	const out = [];
	const walk = (d) => {
		for (const e of readdirSync(d, { withFileTypes: true })) {
			const full = join(d, e.name);
			if (e.isDirectory()) walk(full);
			else if (e.isFile()) out.push(full);
		}
	};
	walk(dir);
	return out;
}

/**
 * Scaffold a template into targetDir. Pure-ish (injectable root).
 * - Validates the template (manifest + non-empty file tree).
 * - Refuses a non-empty targetDir unless force is set.
 * - Copies every file except template.json, applying {{name}} substitution.
 * Returns the list of written relative paths.
 */
export function scaffoldTemplate({ root = defaultTemplatesRoot() } = {}, templateName, projectName, targetDir, { force = false } = {}) {
	if (!/^[a-z0-9-]+$/.test(projectName || '')) {
		throw new Error(`project name must be lowercase alphanumeric with dashes, got: ${projectName}`);
	}
	const { dir } = getTemplate({ root }, templateName);
	const files = walkFiles(dir).filter((f) => basename(f) !== MANIFEST);
	if (!files.length) {
		throw new Error(`template "${templateName}" is empty — nothing to scaffold`);
	}
	if (existsSync(targetDir)) {
		const existing = readdirSync(targetDir);
		if (existing.length > 0 && !force) {
			throw new Error(`directory ${targetDir} already exists and is not empty (use --force to overwrite)`);
		}
	}
	const written = [];
	for (const full of files) {
		const rel = relative(dir, full);
		const dest = join(targetDir, rel);
		mkdirSync(dirname(dest), { recursive: true });
		const content = readFileSync(full, 'utf8');
		writeFileSync(dest, renderName(content, projectName));
		written.push(rel);
	}
	written.sort();
	return written;
}
