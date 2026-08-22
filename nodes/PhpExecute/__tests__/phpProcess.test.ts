import { execFileSync } from 'child_process';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
	buildNonZeroExitError,
	buildPhpArgs,
	runPhpProcess,
} from '../helpers/phpProcess';
import { buildInjectedCode } from '../helpers/bootstrap';
import {
	PhpBinaryNotFoundError,
	PhpProcessError,
	PhpTimeoutError,
	OutputLimitExceededError,
} from '../helpers/errors';

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

const hasPcntl = (() => {
	try {
		return execFileSync('php', ['-m']).toString().split('\n').includes('pcntl');
	} catch {
		return false;
	}
})();

interface FakeStream extends EventEmitter {
	destroy: jest.Mock;
}

function createFakeStream(): FakeStream {
	const stream = new EventEmitter() as unknown as FakeStream;
	stream.destroy = jest.fn();
	return stream;
}

interface FakePayloadStream {
	write: jest.Mock;
	end: jest.Mock;
	on: jest.Mock;
}

interface FakeChild {
	child: ChildProcessWithoutNullStreams;
	raw: EventEmitter;
	kill: jest.Mock;
	payloadStdin: FakePayloadStream;
}

function createFakeChild(): FakeChild {
	const raw = new EventEmitter();
	const kill = jest.fn();
	const stdout = createFakeStream();
	const stderr = createFakeStream();
	const stdin = { writable: true, on: jest.fn(), write: jest.fn(), end: jest.fn() };
	const payloadStdin: FakePayloadStream = { write: jest.fn(), end: jest.fn(), on: jest.fn() };
	const child = Object.assign(raw, {
		stdout,
		stderr,
		stdin,
		stdio: [stdin, stdout, stderr, payloadStdin],
		kill,
	}) as unknown as ChildProcessWithoutNullStreams;
	return { child, raw, kill, payloadStdin };
}

describe('buildPhpArgs', () => {
	it('always sets the memory limit and routes display errors to stderr', () => {
		expect(buildPhpArgs({ memoryLimitMb: 128, restricted: false, composerAutoloadPath: null })).toEqual([
			'-d',
			'memory_limit=128M',
			'-d',
			'display_errors=stderr',
		]);
	});

	it('adds the extended hardening flags in restricted mode', () => {
		const args = buildPhpArgs({
			memoryLimitMb: 256,
			restricted: true,
			composerAutoloadPath: null,
			openBasedir: '/tmp/n8n-php-sandbox',
		});

		expect(args).toContain(
			'disable_functions=exec,shell_exec,system,passthru,popen,proc_open,pcntl_exec,dl,putenv,posix_kill,proc_nice',
		);
		expect(args).toContain('allow_url_fopen=0');
		expect(args).toContain('allow_url_include=0');
		expect(args).toContain('open_basedir=/tmp/n8n-php-sandbox');
	});

	it('omits open_basedir when no directory is given', () => {
		const args = buildPhpArgs({ memoryLimitMb: 128, restricted: true, composerAutoloadPath: null });

		expect(args.some((arg) => arg.startsWith('open_basedir='))).toBe(false);
	});

	it('adds the composer autoload prepend flag when provided', () => {
		const args = buildPhpArgs({
			memoryLimitMb: 128,
			restricted: false,
			composerAutoloadPath: '/app/vendor/autoload.php',
		});

		expect(args).toContain('auto_prepend_file=/app/vendor/autoload.php');
	});
});

describe('runPhpProcess (integration)', () => {
	it('executes code delivered via STDIN without any script file', async () => {
		const result = await runPhpProcess({
			binaryPath: 'php',
			injectedCode: '<?php echo json_encode(["ok" => true]);',
			timeoutMs: 10000,
		});

		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual({ ok: true });
	}, 15000);

	it('delivers the JSON payload on file descriptor 3', async () => {
		const result = await runPhpProcess({
			binaryPath: 'php',
			injectedCode:
				'<?php $f = fopen("php://fd/3", "r"); echo stream_get_contents($f);',
			timeoutMs: 10000,
			payloadJson: '{"items":[{"n":1}],"context":{"nodeName":"PHP"}}',
		});

		expect(JSON.parse(result.stdout)).toEqual({ items: [{ n: 1 }], context: { nodeName: 'PHP' } });
	}, 15000);

	it('emits the metrics marker line on STDERR for successful runs', async () => {
		const result = await runPhpProcess({
			binaryPath: 'php',
			injectedCode: buildInjectedCode('<?php echo "hi";'),
			timeoutMs: 10000,
		});

		expect(result.metrics).not.toBeNull();
		expect(typeof result.metrics?.phpVersion).toBe('string');
		expect(result.metrics?.executionTimeMs).toBeGreaterThanOrEqual(0);
		expect(result.metrics?.peakMemoryUsageMb).toBeGreaterThan(0);
	}, 15000);

	it('applies ini settings passed as CLI args before reading STDIN', async () => {
		const result = await runPhpProcess({
			binaryPath: 'php',
			args: ['-d', 'memory_limit=256M'],
			injectedCode: "<?php echo ini_get('memory_limit');",
			timeoutMs: 10000,
		});

		expect(result.stdout.trim()).toBe('256M');
	}, 15000);

	it('enforces safe mode restrictions via CLI args', async () => {
		const args = buildPhpArgs({ memoryLimitMb: 128, restricted: true, composerAutoloadPath: null });
		const result = await runPhpProcess({
			binaryPath: 'php',
			args,
			injectedCode: "<?php echo ini_get('disable_functions'), '|', ini_get('allow_url_fopen');",
			timeoutMs: 10000,
		});
		const [disabled, allowUrlFopen] = result.stdout.trim().split('|');

		expect(disabled?.split(',')).toEqual(
			expect.arrayContaining([
				'exec',
				'shell_exec',
				'system',
				'passthru',
				'popen',
				'proc_open',
				'pcntl_exec',
				'dl',
				'putenv',
				'posix_kill',
				'proc_nice',
			]),
		);
		expect(allowUrlFopen).toBe('0');
	}, 15000);

	it('rejects with PhpBinaryNotFoundError when the binary does not exist (ENOENT)', async () => {
		await expect(
			runPhpProcess({
				binaryPath: 'n8n-missing-php-binary',
				injectedCode: '<?php echo 1;',
				timeoutMs: 5000,
			}),
		).rejects.toThrow(PhpBinaryNotFoundError);
	}, 15000);

	it('resolves with a non-zero exit code and stderr details instead of throwing', async () => {
		const result = await runPhpProcess({
			binaryPath: 'php',
			injectedCode: "<?php fwrite(STDERR, 'boom'); exit(3);",
			timeoutMs: 10000,
		});

		expect(result.exitCode).toBe(3);
		expect(result.stderr).toContain('boom');
		expect(buildNonZeroExitError(result.exitCode, result.stderr, '').message).toContain(
			'PHP exited with code 3: boom',
		);
	}, 15000);

	it('rejects with PhpTimeoutError and kills the process when the timeout is exceeded', async () => {
		const startedAt = Date.now();

		await expect(
			runPhpProcess({
				binaryPath: 'php',
				injectedCode: '<?php sleep(30);',
				timeoutMs: 400,
			}),
		).rejects.toThrow(PhpTimeoutError);
		expect(Date.now() - startedAt).toBeLessThan(3000);
	}, 15000);

	(hasPcntl ? it : it.skip)(
		'sends SIGTERM first on timeout so the script can shut down gracefully',
		async () => {
			const dir = mkdtempSync(join(tmpdir(), 'n8n-php-test-'));
			const markerPath = join(dir, 'sigterm-marker');
			const script = [
				'<?php',
				`$marker = ${JSON.stringify(markerPath)};`,
				'pcntl_async_signals(true);',
				'pcntl_signal(SIGTERM, function () use ($marker) {',
				"\tfile_put_contents($marker, 'sigterm received');",
				'\texit(42);',
				'});',
				'while (true) { usleep(20000); }',
			].join('\n');

			try {
				await expect(
					runPhpProcess({ binaryPath: 'php', injectedCode: script, timeoutMs: 300 }),
				).rejects.toThrow(/timed out/);

				const deadline = Date.now() + 3000;
				let marker: string | undefined;
				while (Date.now() < deadline) {
					try {
						marker = readFileSync(markerPath, 'utf8');
						break;
					} catch {
						await sleep(25);
					}
				}
				expect(marker).toBe('sigterm received');
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
		15000,
	);

	it('kills the process and reports an error when output exceeds the limit', async () => {
		await expect(
			runPhpProcess({
				binaryPath: 'php',
				injectedCode: '<?php echo str_repeat("a", 11 * 1024 * 1024);',
				timeoutMs: 10000,
			}),
		).rejects.toThrow(OutputLimitExceededError);
		await expect(
			runPhpProcess({
				binaryPath: 'php',
				injectedCode: '<?php echo str_repeat("a", 11 * 1024 * 1024);',
				timeoutMs: 10000,
			}),
		).rejects.toThrow('Output exceeded maximum allowed size (10MB)');
	}, 30000);

	it('reports memory exhaustion through stderr after a fatal error', async () => {
		const result = await runPhpProcess({
			binaryPath: 'php',
			args: ['-d', 'memory_limit=64M'],
			injectedCode: "<?php $a=[]; while(true){$a[]=str_repeat('x',1048576);}",
			timeoutMs: 20000,
		});

		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toMatch(/Allowed memory size of \d+ bytes exhausted/);
	}, 30000);
});

describe('runPhpProcess signal handling (injected fake process)', () => {
	it('escalates from SIGTERM to SIGKILL once the grace period elapses', async () => {
		const { child, kill } = createFakeChild();
		const promise = runPhpProcess({
			binaryPath: 'php',
			injectedCode: '<?php sleep(30);',
			timeoutMs: 50,
			spawnFn: () => child,
		});
		const timeoutExpectation = expect(promise).rejects.toThrow(/timed out/);

		await sleep(150);
		expect(kill.mock.calls.map((call) => call[0])).toEqual(['SIGTERM']);

		await sleep(2100);
		expect(kill.mock.calls.map((call) => call[0])).toEqual(['SIGTERM', 'SIGKILL']);

		await timeoutExpectation;
	}, 10000);

	it('writes the injected code to stdin and closes both streams', async () => {
		const { child, raw, payloadStdin } = createFakeChild();
		const promise = runPhpProcess({
			binaryPath: 'php',
			injectedCode: '<?php echo 1;',
			timeoutMs: 5000,
			payloadJson: '{"items":[]}',
			spawnFn: () => child,
		});

		await sleep(20);
		expect(child.stdin.end).toHaveBeenCalledWith('<?php echo 1;');
		expect(payloadStdin.write).toHaveBeenCalledWith('{"items":[]}');
		expect(payloadStdin.end).toHaveBeenCalledTimes(1);

		raw.emit('close', 0, null);
		await expect(promise).resolves.toMatchObject({ exitCode: 0 });
	});

	it('closes the payload pipe even when there is no payload', async () => {
		const { child, raw, payloadStdin } = createFakeChild();
		const promise = runPhpProcess({
			binaryPath: 'php',
			injectedCode: '<?php echo 1;',
			timeoutMs: 5000,
			payloadJson: null,
			spawnFn: () => child,
		});

		raw.emit('close', 0, null);
		await promise;

		expect(payloadStdin.write).not.toHaveBeenCalled();
		expect(payloadStdin.end).toHaveBeenCalledTimes(1);
	});

	it('collects streamed chunks from stdout and resolves on clean exit', async () => {
		const { child, raw } = createFakeChild();
		const promise = runPhpProcess({
			binaryPath: 'php',
			injectedCode: '<?php echo 1;',
			timeoutMs: 5000,
			spawnFn: () => child,
		});

		child.stdout.emit('data', Buffer.from('{"a":'));
		child.stdout.emit('data', Buffer.from('1}'));

		raw.emit('close', 0, null);
		await expect(promise).resolves.toMatchObject({ stdout: '{"a":1}', exitCode: 0 });
	});

	it('reports the terminating signal when killed externally', async () => {
		const { child, raw } = createFakeChild();
		const promise = runPhpProcess({
			binaryPath: 'php',
			injectedCode: '<?php echo 1;',
			timeoutMs: 5000,
			spawnFn: () => child,
		});

		raw.emit('close', null, 'SIGKILL');
		await expect(promise).rejects.toThrow(PhpProcessError);
		await expect(promise).rejects.toThrow('terminated by signal SIGKILL');
	});
});
