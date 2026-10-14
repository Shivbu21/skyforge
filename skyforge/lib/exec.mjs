// Skyforge exec: run a child process, stream its output live to the console,
// and keep a capped tail for the deployment record. Pure-ish: `spawn`
// injectable so tests never launch real processes.
import { spawn } from 'node:child_process';

const MAX_CAPTURE = 200 * 1024; // 200 KB cap on captured output
export const TAIL_LINES = 100;

/**
 * Run cmd/argv, forwarding stdout+stderr live to this process's stdio.
 * Resolves { status, output } where output is the last TAIL_LINES of
 * combined output (capped). Rejects only if the process can't start.
 * `spawnFn` injectable: (cmd, argv, opts) -> ChildProcess.
 */
export function runTee(cmd, argv, { cwd, spawnFn = spawn, env } = {}) {
	return new Promise((resolve, reject) => {
		let child;
		try {
			child = spawnFn(cmd, argv, { cwd, env, stdio: ['inherit', 'pipe', 'pipe'] });
		} catch (e) {
			reject(e);
			return;
		}
		let buf = '';
		const onData = (chunk) => {
			const text = chunk.toString('utf8');
			buf += text;
			if (buf.length > MAX_CAPTURE) buf = buf.slice(-MAX_CAPTURE);
		};
		child.stdout.on('data', (c) => { process.stdout.write(c); onData(c); });
		child.stderr.on('data', (c) => { process.stderr.write(c); onData(c); });
		child.on('error', reject);
		child.on('close', (status) => {
			resolve({ status: status ?? 1, output: buf });
		});
	});
}

/** Last N lines of a captured output string. Pure. */
export function tailLines(output, n = TAIL_LINES) {
	const lines = String(output || '').split('\n');
	return lines.slice(-n).join('\n');
}
