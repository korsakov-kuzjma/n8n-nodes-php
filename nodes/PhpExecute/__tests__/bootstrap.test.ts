import { execFileSync } from 'child_process';
import { METRICS_MARKER, buildInjectedCode, parseMetricsFromStderr } from '../helpers/bootstrap';

const hasPhp = (() => {
	try {
		execFileSync('php', ['-v']);
		return true;
	} catch {
		return false;
	}
})();

describe('buildInjectedCode', () => {
	const injected = buildInjectedCode('<?php echo json_encode(["ok" => true]);');

	it('prepends a bootstrap that registers the fatal error shutdown handler', () => {
		expect(injected.startsWith('<?php')).toBe(true);
		expect(injected).toContain('register_shutdown_function');
		expect(injected).toContain("'__php_fatal_error' => true");
		expect(injected).toContain('E_COMPILE_ERROR');
	});

	it('reads the payload from file descriptor 3 and exposes $n8nItems/$n8nContext/$n8nInput', () => {
		expect(injected).toContain("fopen('php://fd/3', 'rb')");
		expect(injected).toContain('$n8nItems');
		expect(injected).toContain('$n8nContext');
		expect(injected).toContain('$n8nInput');
		expect(injected).toContain(METRICS_MARKER);
	});

	it('closes the bootstrap PHP block so user code keeps its own opening tag', () => {
		expect(injected.endsWith('?>\n<?php echo json_encode(["ok" => true]);')).toBe(true);
	});

	(hasPhp ? it : it.skip)('produces code that passes php -l syntax validation', () => {
		const output = execFileSync('php', ['-l'], { input: injected }).toString();

		expect(output).toMatch(/No syntax errors/);
	});
});

describe('parseMetricsFromStderr', () => {
	it('returns null when no metrics marker is present', () => {
		expect(parseMetricsFromStderr('plain stderr output\n')).toBeNull();
		expect(parseMetricsFromStderr('')).toBeNull();
	});

	it('parses the JSON payload following the marker', () => {
		const stderr = `${METRICS_MARKER}{"phpVersion":"8.3.0","executionTimeMs":12.4,"peakMemoryUsageMb":2.5}\n`;

		expect(parseMetricsFromStderr(stderr)).toEqual({
			phpVersion: '8.3.0',
			executionTimeMs: 12.4,
			peakMemoryUsageMb: 2.5,
		});
	});

	it('uses the last marker line and ignores everything before it', () => {
		const first = `${METRICS_MARKER}{"executionTimeMs":1}\n`;
		const second = `${METRICS_MARKER}{"executionTimeMs":9,"peakMemoryUsageMb":1}\n`;
		const stderr = `some noise\n${first}${second}`;

		expect(parseMetricsFromStderr(stderr)).toEqual({
			executionTimeMs: 9,
			peakMemoryUsageMb: 1,
		});
	});

	it('returns null for malformed or non-object payloads', () => {
		expect(parseMetricsFromStderr(`${METRICS_MARKER}{broken\n`)).toBeNull();
		expect(parseMetricsFromStderr(`${METRICS_MARKER}[1,2]\n`)).toBeNull();
		expect(parseMetricsFromStderr(`${METRICS_MARKER}"text"\n`)).toBeNull();
	});
});
