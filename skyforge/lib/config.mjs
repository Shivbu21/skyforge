// Skyforge project config: load and validate skyforge.json.
// Pure functions — no filesystem access except the explicit loaders.
import { readFileSync } from 'node:fs';

export const CONFIG_FILE = 'skyforge.json';

export const DEFAULTS = {
	framework: 'plain',
	d1: null,
	r2: null,
	kv: null,
	queue: null,
	crons: [],
	broadcast: false,
	domain: null,
	bake: false,
	env: {},
};

const NAME_RE = /^[a-z0-9-]+$/;

/**
 * Validate a parsed config object. Returns a list of human-readable errors
 * (empty = valid). Never throws.
 */
export function validateConfig(raw) {
	const errors = [];
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		return ['skyforge.json must be a JSON object'];
	}
	if (typeof raw.name !== 'string' || !NAME_RE.test(raw.name)) {
		errors.push('name: required, lowercase alphanumeric with dashes (e.g. "my-app")');
	}
	if (raw.framework !== undefined && !['plain', 'laravel'].includes(raw.framework)) {
		errors.push('framework: must be "plain" or "laravel"');
	}
	for (const key of ['d1', 'r2', 'kv', 'queue', 'domain']) {
		if (raw[key] !== undefined && raw[key] !== null && typeof raw[key] !== 'string') {
			errors.push(`${key}: must be a string or null`);
		}
	}
	if (raw.r2 !== undefined && raw.r2 !== null && !/^[a-z0-9][a-z0-9-]*$/.test(raw.r2)) {
		errors.push('r2: bucket names must be lowercase alphanumeric with dashes');
	}
	if (raw.domain !== undefined && raw.domain !== null && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(raw.domain)) {
		errors.push('domain: must look like a domain (e.g. "example.com")');
	}
	if (raw.crons !== undefined) {
		if (!Array.isArray(raw.crons) || raw.crons.some((c) => typeof c !== 'string')) {
			errors.push('crons: must be an array of cron strings');
		}
	}
	if (raw.broadcast !== undefined && typeof raw.broadcast !== 'boolean') {
		errors.push('broadcast: must be true or false');
	}
	if (raw.bake !== undefined && typeof raw.bake !== 'boolean') {
		errors.push('bake: must be true or false');
	}
	if (raw.env !== undefined) {
		if (typeof raw.env !== 'object' || raw.env === null || Array.isArray(raw.env)) {
			errors.push('env: must be an object of KEY: value pairs');
		} else if (Object.values(raw.env).some((v) => typeof v !== 'string')) {
			errors.push('env: all values must be strings (use wrangler secrets for real secrets)');
		}
	}
	return errors;
}

/** Merge user config over defaults. Pure. */
export function normalizeConfig(raw) {
	return { ...DEFAULTS, ...raw };
}

/** Load skyforge.json from a directory. Throws with a clear message on failure. */
export function loadConfig(dir) {
	const path = `${dir.replace(/\/$/, '')}/${CONFIG_FILE}`;
	let text;
	try {
		text = readFileSync(path, 'utf8');
	} catch {
		throw new Error(`no ${CONFIG_FILE} in ${dir} — run "skyforge init" first`);
	}
	let raw;
	try {
		raw = JSON.parse(text);
	} catch (e) {
		throw new Error(`${CONFIG_FILE} is not valid JSON: ${e.message}`);
	}
	const errors = validateConfig(raw);
	if (errors.length) {
		throw new Error(`${CONFIG_FILE} has ${errors.length} problem(s):\n  - ${errors.join('\n  - ')}`);
	}
	return normalizeConfig(raw);
}
