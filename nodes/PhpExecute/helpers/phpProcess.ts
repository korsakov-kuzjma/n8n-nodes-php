import { spawn } from 'child_process';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import {
	PhpBinaryNotFoundError,
	PhpNodeError,
	PhpProcessError,
	PhpTimeoutError,
	OutputLimitExceededError,
} from './errors';
import type { PhpMetrics } from './bootstrap';
import { parseMetricsFromStderr } from './bootstrap';

export const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

const GRACEFUL_SHUTDOWN_MS = 2000;

export const EXTENDED_DISABLED_FUNCTIONS =
	'exec,shell_exec,system,passthru,popen,proc_open,pcntl_exec,dl,putenv,posix_kill,proc_nice';

export interface ProcessIsolation {
	uid?: number;
	gid?: number;
	cwd?: string;
}

export type SpawnFunction = (
	command: string,
	args: readonly string[],
	options: { stdio: ['pipe', 'pipe', 'pipe', 'pipe']; uid?: number; gid?: number; cwd?: string },
) => ChildProcessWithoutNullStreams;

const defaultSpawn = spawn as unknown as SpawnFunction;

export interface PhpSpawnOptions {
	binaryPath: string;
	args?: string[];
	injectedCode: string;
	timeoutMs: number;
	payloadJson?: string | null;
	maxOutputBytes?: number;
	isolation?: ProcessIsolation;
	spawnFn?: SpawnFunction;
}

export interface PhpProcessResult {
	stdout: string;
	stderr: string;
	exitCode: number;
	metrics: PhpMetrics | null;
}

export function buildPhpArgs(options: {
	memoryLimitMb: number;
	restricted: boolean;
	composerAutoloadPath: string | null;
	openBasedir?: string | null;
}): string[] {
	const args: string[] = [
		'-d',
		`memory_limit=${options.memoryLimitMb}M`,
		'-d',
		'display_errors=stderr',
	];

	if (options.restricted) {
		args.push('-d', `disable_functions=${EXTENDED_DISABLED_FUNCTIONS}`);
		args.push('-d', 'allow_url_fopen=0');
		args.push('-d', 'allow_url_include=0');
		if (options.openBasedir) {
			args.push('-d', `open_basedir=${options.openBasedir}`);
		}
	}
	if (options.composerAutoloadPath !== null) {
		args.push('-d', `auto_prepend_file=${options.composerAutoloadPath}`);
	}
	return args;
}

function stripMetricsLines(text: string): string {
	return text
		.split('\n')
		.filter((line) => !line.startsWith('__N8N_METRICS__'))
		.join('\n');
}

export function runPhpProcess(options: PhpSpawnOptions): Promise<PhpProcessResult> {
	const {
		binaryPath,
		args = [],
		injectedCode,
		timeoutMs,
		payloadJson = null,
		maxOutputBytes = MAX_OUTPUT_BYTES,
		isolation = {},
		spawnFn = defaultSpawn,
	} = options;

	return new Promise((resolve, reject) => {
		let settled = false;
		let stdoutSize = 0;
		let stderrSize = 0;
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let graceTimer: NodeJS.Timeout | undefined;

		const php = spawnFn(binaryPath, args, {
			stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
			uid: isolation.uid,
			gid: isolation.gid,
			cwd: isolation.cwd,
		});

		const timeoutTimer = setTimeout(() => {
			if (settled) return;
			php.kill('SIGTERM');
			graceTimer = setTimeout(() => php.kill('SIGKILL'), GRACEFUL_SHUTDOWN_MS);
			fail(new PhpTimeoutError(timeoutMs));
		}, timeoutMs);

		const fail = (error: Error): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutTimer);
			reject(error);
		};

		const collect = (stream: NodeJS.ReadableStream, chunks: Buffer[], isStdout: boolean) => {
			stream.on('data', (chunk: Buffer) => {
				const size = isStdout ? stdoutSize : stderrSize;
				if (size + chunk.length > maxOutputBytes) {
					php.stdout.destroy();
					php.stderr.destroy();
					php.kill('SIGKILL');
					fail(new OutputLimitExceededError(maxOutputBytes));
					return;
				}
				chunks.push(chunk);
				if (isStdout) stdoutSize += chunk.length;
				else stderrSize += chunk.length;
			});
		};
		collect(php.stdout, stdoutChunks, true);
		collect(php.stderr, stderrChunks, false);

		php.stdin.on('error', () => {});
		php.stdin.end(injectedCode);

		const payloadStream = php.stdio[3] as unknown as NodeJS.WritableStream | undefined;
		if (payloadStream && typeof payloadStream.end === 'function') {
			payloadStream.on('error', () => {});
			if (payloadJson !== null) {
				payloadStream.write(payloadJson);
			}
			payloadStream.end();
		}

		php.on('error', (error: NodeJS.ErrnoException) => {
			fail(
				error.code === 'ENOENT'
					? new PhpBinaryNotFoundError(binaryPath)
					: new PhpProcessError(error.message, null),
			);
		});

		php.on('close', (code, signal) => {
			clearTimeout(timeoutTimer);
			clearTimeout(graceTimer);
			const stdout = Buffer.concat(stdoutChunks).toString('utf8');
			const stderr = Buffer.concat(stderrChunks).toString('utf8');
			const metrics = parseMetricsFromStderr(stderr);
			const exitCode = code ?? -1;
			if (signal && code === null) {
				fail(
					new PhpProcessError(`PHP process was terminated by signal ${signal}`, exitCode),
				);
				return;
			}
			if (settled) return;
			settled = true;
			resolve({ stdout, stderr, exitCode, metrics });
		});
	});
}

export function buildNonZeroExitError(
	exitCode: number,
	stderr: string,
	stdout: string,
): PhpNodeError {
	const details = (stripMetricsLines(stderr).trim() || stdout.trim()).slice(0, 4000);
	return new PhpProcessError(
		`PHP exited with code ${exitCode}${details ? `: ${details}` : ''}`,
		exitCode,
	);
}
