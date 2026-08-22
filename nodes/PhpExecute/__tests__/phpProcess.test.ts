import { execFileSync } from 'child_process';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import { readFile, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
	buildPhpArgs,
	OutputLimitExceededError,
	runPhpProcess,
} from '../helpers/phpProcess';

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

async function createScript(code: string): Promise<{ dir: string; path: string }> {
	const dir = await mkdtemp(join(tmpdir(), 'n8n-php-test-'));
	const path = join(dir, 'script.php');
	await writeFile(path, code, 'utf8');
	return { dir, path };
}

async function removeDir(dir: string): Promise<void> {
	await rm(dir, { recursive: true, force: true });
}

async function readMarkerWhenReady(path: string, timeoutMs = 3000): Promise<string | undefined> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		try {
			return await readFile(path, 'utf8');
		} catch {
			if (Date.now() > deadline) {
				return undefined;
			}
			await sleep(25);
		}
	}
}

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

interface FakeChild {
	child: ChildProcessWithoutNullStreams;
	raw: EventEmitter;
	kill: jest.Mock;
}

function createFakeChild(): FakeChild {
	const raw = new EventEmitter();
	const kill = jest.fn();
	const stdout = createFakeStream();
	const stderr = createFakeStream();
	const stdin = {
		writable: true,
		on: jest.fn(),
		write: jest.fn(),
		end: jest.fn(),
	};
	const child = Object.assign(raw, { stdout, stderr, stdin, kill }) as unknown as ChildProcessWithoutNullStreams;
	return { child, raw, kill };
}

describe('buildPhpArgs', () => {
	it('returns an empty array by default', () => {
		expect(buildPhpArgs({ safeMode: false, memoryLimitMb: null, composerAutoloadPath: null }, '/tmp/x')).toEqual([]);
	});

	it('adds the memory limit flag', () => {
		expect(buildPhpArgs({ safeMode: false, memoryLimitMb: 256, composerAutoloadPath: null }, '/tmp/x')).toEqual([
			'-d',
			'memory_limit=256M',
		]);
	});

	it('adds disabled functions and open_basedir in safe mode', () => {
		const args = buildPhpArgs({ safeMode: true, memoryLimitMb: null, composerAutoloadPath: null }, '/tmp/box');
		expect(args).toContain('-d');
		expect(args).toContain(
			'disable_functions=exec,shell_exec,system,passthru,popen,proc_open',
		);
		expect(args).toContain('-d');
		expect(args).toContain('open_basedir=/tmp/box');
	});

	it('adds the composer autoload prepend flag', () => {
		const args = buildPhpArgs(
			{ safeMode: false, memoryLimitMb: null, composerAutoloadPath: '/app/vendor/autoload.php' },
			'/tmp/x',
		);
		expect(args).toContain('auto_prepend_file=/app/vendor/autoload.php');
	});
});

describe('runPhpProcess (integration)', () => {
	it('runs a PHP script and captures its JSON output', async () => {
		const { dir, path } = await createScript('<?php echo json_encode(["ok" => true]);');

		try {
			const result = await runPhpProcess({ binaryPath: 'php', scriptPath: path, timeoutMs: 10000 });

			expect(result.exitCode).toBe(0);
			expect(JSON.parse(result.stdout)).toEqual({ ok: true });
		} finally {
			await removeDir(dir);
		}
	}, 15000);

	it('passes data to the script via STDIN', async () => {
		const { dir, path } = await createScript('<?php echo stream_get_contents(STDIN);');

		try {
			const result = await runPhpProcess({
				binaryPath: 'php',
				scriptPath: path,
				timeoutMs: 10000,
				stdinData: '{"email":"a@b.c"}',
			});

			expect(result.stdout).toBe('{"email":"a@b.c"}');
		} finally {
			await removeDir(dir);
		}
	}, 15000);

	it('applies ini settings passed as CLI args before the script path', async () => {
		const { dir, path } = await createScript("<?php echo ini_get('memory_limit');");

		try {
			const result = await runPhpProcess({
				binaryPath: 'php',
				scriptPath: path,
				args: ['-d', 'memory_limit=256M'],
				timeoutMs: 10000,
			});

			expect(result.stdout.trim()).toBe('256M');
		} finally {
			await removeDir(dir);
		}
	}, 15000);

	it('enforces safe mode restrictions via CLI args', async () => {
		const { dir, path } = await createScript(
			"<?php echo ini_get('disable_functions'), '|', ini_get('open_basedir');",
		);
		const args = buildPhpArgs({ safeMode: true, memoryLimitMb: null, composerAutoloadPath: null }, dir);

		try {
			const result = await runPhpProcess({ binaryPath: 'php', scriptPath: path, args, timeoutMs: 10000 });
			const [disabled, basedir] = result.stdout.trim().split('|');

			expect(disabled?.split(',')).toEqual(
				expect.arrayContaining(['exec', 'shell_exec', 'system', 'passthru', 'popen', 'proc_open']),
			);
			expect(basedir).toBe(dir);
		} finally {
			await removeDir(dir);
		}
	}, 15000);

	it('prepends the composer autoload file when provided', async () => {
		const { dir, path } = await createScript('<?php echo "APP";');
		const bootstrapPath = join(dir, 'autoload.php');
		await writeFile(bootstrapPath, '<?php echo "BOOT\\n";', 'utf8');

		try {
			const result = await runPhpProcess({
				binaryPath: 'php',
				scriptPath: path,
				args: ['-d', `auto_prepend_file=${bootstrapPath}`],
				timeoutMs: 10000,
			});

			expect(result.stdout).toBe('BOOT\nAPP');
		} finally {
			await removeDir(dir);
		}
	}, 15000);

	it('rejects with a friendly message when the binary does not exist (ENOENT)', async () => {
		await expect(
			runPhpProcess({
				binaryPath: 'n8n-missing-php-binary',
				scriptPath: join(tmpdir(), 'script.php'),
				timeoutMs: 5000,
			}),
		).rejects.toThrow(/PHP binary not found/);
	}, 15000);

	it('rejects with stderr details on a non-zero exit code', async () => {
		const { dir, path } = await createScript("<?php fwrite(STDERR, 'boom'); exit(3);");

		try {
			await expect(
				runPhpProcess({ binaryPath: 'php', scriptPath: path, timeoutMs: 10000 }),
			).rejects.toThrow('PHP exited with code 3: boom');
		} finally {
			await removeDir(dir);
		}
	}, 15000);

	it('rejects quickly when the timeout is exceeded', async () => {
		const { dir, path } = await createScript('<?php sleep(30);');
		const startedAt = Date.now();

		try {
			await expect(
				runPhpProcess({ binaryPath: 'php', scriptPath: path, timeoutMs: 400 }),
			).rejects.toThrow('PHP execution timed out after 0.4 s');
			expect(Date.now() - startedAt).toBeLessThan(3000);
		} finally {
			await removeDir(dir);
		}
	}, 15000);

	(hasPcntl ? it : it.skip)(
		'sends SIGTERM first on timeout so the script can shut down gracefully',
		async () => {
			const dir = await mkdtemp(join(tmpdir(), 'n8n-php-test-'));
			const markerPath = join(dir, 'sigterm-marker');
			const path = join(dir, 'script.php');
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
			await writeFile(path, script, 'utf8');

			try {
				await expect(
					runPhpProcess({ binaryPath: 'php', scriptPath: path, timeoutMs: 300 }),
				).rejects.toThrow(/timed out/);

				expect(await readMarkerWhenReady(markerPath)).toBe('sigterm received');
			} finally {
				await removeDir(dir);
			}
		},
		15000,
	);

	it('kills the process and reports an error when output exceeds the limit', async () => {
		const { dir, path } = await createScript(
			'<?php echo str_repeat("a", 11 * 1024 * 1024);',
		);

		try {
			await expect(
				runPhpProcess({ binaryPath: 'php', scriptPath: path, timeoutMs: 10000 }),
			).rejects.toThrow(OutputLimitExceededError);
			await expect(
				runPhpProcess({ binaryPath: 'php', scriptPath: path, timeoutMs: 10000 }),
			).rejects.toThrow('Output exceeded maximum allowed size (10MB)');
		} finally {
			await removeDir(dir);
		}
	}, 30000);
});

describe('runPhpProcess signal handling (injected fake process)', () => {
	it('escalates from SIGTERM to SIGKILL once the grace period elapses', async () => {
		const { child, kill } = createFakeChild();
		const promise = runPhpProcess({
			binaryPath: 'php',
			scriptPath: 'script.php',
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

	it('writes the payload to stdin and closes the stream', async () => {
		const { child, raw } = createFakeChild();
		const promise = runPhpProcess({
			binaryPath: 'php',
			scriptPath: 'script.php',
			timeoutMs: 5000,
			stdinData: '{"x":1}',
			spawnFn: () => child,
		});

		await sleep(20);
		expect(child.stdin.write).toHaveBeenCalledWith('{"x":1}');
		expect(child.stdin.end).toHaveBeenCalledTimes(1);

		raw.emit('close', 0, null);
		await expect(promise).resolves.toMatchObject({ exitCode: 0 });
	});

	it('does not touch stdin when no payload is given', async () => {
		const { child, raw } = createFakeChild();
		const promise = runPhpProcess({
			binaryPath: 'php',
			scriptPath: 'script.php',
			timeoutMs: 5000,
			spawnFn: () => child,
		});

		raw.emit('close', 0, null);
		await promise;

		expect(child.stdin.write).not.toHaveBeenCalled();
		expect(child.stdin.end).not.toHaveBeenCalled();
	});

	it('collects streamed chunks from stdout and resolves on clean exit', async () => {
		const { child, raw } = createFakeChild();
		const promise = runPhpProcess({
			binaryPath: 'php',
			scriptPath: 'script.php',
			timeoutMs: 5000,
			spawnFn: () => child,
		});

		child.stdout.emit('data', Buffer.from('{"a":'));
		child.stdout.emit('data', Buffer.from('1}'));

		raw.emit('close', 0, null);
		await expect(promise).resolves.toEqual({ stdout: '{"a":1}', stderr: '', exitCode: 0 });
	});

	it('reports the terminating signal when killed externally', async () => {
		const { child, raw } = createFakeChild();
		const promise = runPhpProcess({
			binaryPath: 'php',
			scriptPath: 'script.php',
			timeoutMs: 5000,
			spawnFn: () => child,
		});

		raw.emit('close', null, 'SIGKILL');
		await expect(promise).rejects.toThrow('PHP process was terminated by signal SIGKILL');
	});
});
