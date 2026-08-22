import { spawn } from 'child_process';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import type { ResolvedNodeOptions } from '../interfaces';

export const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

const GRACEFUL_SHUTDOWN_MS = 2000;
const DISABLED_FUNCTIONS = 'exec,shell_exec,system,passthru,popen,proc_open';

export class OutputLimitExceededError extends Error {
	constructor(maxBytes = MAX_OUTPUT_BYTES) {
		super(`Output exceeded maximum allowed size (${Math.round(maxBytes / (1024 * 1024))}MB)`);
		this.name = 'OutputLimitExceededError';
	}
}

export type SpawnFunction = (
	command: string,
	args: readonly string[],
	options: { stdio: ['pipe', 'pipe', 'pipe'] },
) => ChildProcessWithoutNullStreams;

const defaultSpawn = spawn as unknown as SpawnFunction;

export interface PhpSpawnOptions {
	binaryPath: string;
	scriptPath: string;
	args?: string[];
	timeoutMs: number;
	stdinData?: string | null;
	maxOutputBytes?: number;
	spawnFn?: SpawnFunction;
}

export interface PhpProcessResult {
	stdout: string;
	stderr: string;
	exitCode: number | null;
}

export function buildPhpArgs(
	options: Pick<ResolvedNodeOptions, 'safeMode' | 'memoryLimitMb' | 'composerAutoloadPath'>,
	tempDir: string,
): string[] {
	const args: string[] = [];

	if (options.memoryLimitMb !== null) {
		args.push('-d', `memory_limit=${options.memoryLimitMb}M`);
	}
	if (options.safeMode) {
		args.push('-d', `disable_functions=${DISABLED_FUNCTIONS}`);
		args.push('-d', `open_basedir=${tempDir}`);
	}
	if (options.composerAutoloadPath !== null) {
		args.push('-d', `auto_prepend_file=${options.composerAutoloadPath}`);
	}
	return args;
}

export function runPhpProcess(options: PhpSpawnOptions): Promise<PhpProcessResult> {
	const {
		binaryPath,
		scriptPath,
		args = [],
		timeoutMs,
		stdinData = null,
		maxOutputBytes = MAX_OUTPUT_BYTES,
		spawnFn = defaultSpawn,
	} = options;

	return new Promise((resolve, reject) => {
		let settled = false;
		let stdoutSize = 0;
		let stderrSize = 0;
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let graceTimer: NodeJS.Timeout | undefined;

		const php = spawnFn(binaryPath, [...args, scriptPath], {
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		const timeoutTimer = setTimeout(() => {
			if (settled) return;
			php.kill('SIGTERM');
			graceTimer = setTimeout(() => php.kill('SIGKILL'), GRACEFUL_SHUTDOWN_MS);
			fail(new Error(`PHP execution timed out after ${timeoutMs / 1000} s`));
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

		if (stdinData !== null && php.stdin.writable) {
			php.stdin.on('error', () => {});
			php.stdin.write(stdinData);
			php.stdin.end();
		}

		php.on('error', (error: NodeJS.ErrnoException) => {
			const message =
				error.code === 'ENOENT'
					? `PHP binary not found ("${binaryPath}"). Install the PHP CLI or adjust the PHP Binary Path option.`
					: error.message;
			fail(new Error(message));
		});

		php.on('close', (code, signal) => {
			clearTimeout(timeoutTimer);
			clearTimeout(graceTimer);
			if (settled) return;
			settled = true;
			const stdout = Buffer.concat(stdoutChunks).toString('utf8');
			const stderr = Buffer.concat(stderrChunks).toString('utf8');
			if (signal && code === null) {
				reject(new Error(`PHP process was terminated by signal ${signal}`));
				return;
			}
			const exitCode = code ?? -1;
			if (exitCode !== 0) {
				const details = (stderr.trim() || stdout.trim()).slice(0, 4000);
				reject(new Error(`PHP exited with code ${exitCode}${details ? `: ${details}` : ''}`));
				return;
			}
			resolve({ stdout, stderr, exitCode });
		});
	});
}
