import {
	parsePhpElements,
	parsePhpOutput,
	throwIfFatal,
	toExecutionData,
} from '../helpers/outputParser';
import { PhpFatalError, PhpMemoryLimitError, PhpOutputParseError } from '../helpers/errors';

describe('parsePhpOutput', () => {
	describe('valid JSON object', () => {
		it('returns a single item with the parsed object as json', () => {
			const items = parsePhpOutput('{"status":"ok","count":2}', { itemIndex: 3 });

			expect(items).toHaveLength(1);
			expect(items[0].json).toEqual({ status: 'ok', count: 2 });
		});
	});

	describe('valid JSON array', () => {
		it('splits an array of objects into one item per element', () => {
			const items = parsePhpOutput('[{"a":1},{"a":2}]', { itemIndex: 5 });

			expect(items).toHaveLength(2);
			expect(items[0].json).toEqual({ a: 1 });
			expect(items[1].json).toEqual({ a: 2 });
		});

		it('wraps scalar array elements in an output field', () => {
			const items = parsePhpOutput('[1,"two",null,true]', { itemIndex: 0 });

			expect(items).toHaveLength(4);
			expect(items[0].json).toEqual({ output: 1 });
			expect(items[1].json).toEqual({ output: 'two' });
			expect(items[2].json).toEqual({ output: null });
			expect(items[3].json).toEqual({ output: true });
		});
	});

	describe('plain text output', () => {
		it('wraps the raw text into an output field', () => {
			const items = parsePhpOutput('Hello <world> & "friends"', { itemIndex: 0 });

			expect(items).toHaveLength(1);
			expect(items[0].json).toEqual({ output: 'Hello <world> & "friends"' });
		});
	});

	describe('empty output', () => {
		it('returns an empty string as output', () => {
			const items = parsePhpOutput('', { itemIndex: 0 });
			const itemsWhitespace = parsePhpOutput('   \n\t ', { itemIndex: 0 });

			expect(items[0].json).toEqual({ output: '' });
			expect(itemsWhitespace[0].json).toEqual({ output: '' });
		});
	});

	describe('scalar JSON roots', () => {
		it.each([
			['42', { output: 42 }],
			['"quoted"', { output: 'quoted' }],
			['true', { output: true }],
			['null', { output: null }],
		])('parses %s into typed output data', (stdout, expected) => {
			const items = parsePhpOutput(stdout, { itemIndex: 0 });

			expect(items[0].json).toEqual(expected);
		});
	});

	describe('broken JSON with Strict JSON Mode enabled', () => {
		it('throws a PhpOutputParseError mentioning strict mode', () => {
			expect(() =>
				parsePhpOutput('{not json', { itemIndex: 0, strictJsonMode: true }),
			).toThrow(PhpOutputParseError);

			expect(() =>
				parsePhpOutput('{not json', { itemIndex: 0, strictJsonMode: true }),
			).toThrow(/Strict JSON Mode/);
		});

		it('throws on empty output as well', () => {
			expect(() => parsePhpOutput('', { itemIndex: 0, strictJsonMode: true })).toThrow(
				PhpOutputParseError,
			);
		});
	});

	describe('broken JSON without Strict JSON Mode', () => {
		it('falls back to wrapping the raw output', () => {
			const items = parsePhpOutput('{not json', { itemIndex: 0 });

			expect(items).toHaveLength(1);
			expect(items[0].json).toEqual({ output: '{not json' });
		});
	});

	describe('pairedItem', () => {
		it('sets pairedItem to the given index on every returned item', () => {
			const objectItems = parsePhpOutput('{"a":1}', { itemIndex: 7 });
			const arrayItems = parsePhpOutput('[{"a":1},{"b":2}]', { itemIndex: 7 });
			const fallbackItems = parsePhpOutput('plain', { itemIndex: 7 });

			for (const item of [...objectItems, ...arrayItems, ...fallbackItems]) {
				expect(item.pairedItem).toEqual({ item: 7 });
			}
		});
	});
});

describe('parsePhpElements / toExecutionData split', () => {
	it('keeps element parsing independent of the item index', () => {
		const parsed = parsePhpElements('[{"a":1},{"a":2}]', {});

		expect(parsed).toEqual({ kind: 'json', values: [{ a: 1 }, { a: 2 }] });
		const first = toExecutionData(parsed, 0);
		const second = toExecutionData(parsed, 1);

		expect(first.map((item) => item.json)).toEqual(second.map((item) => item.json));
		expect(first[1].pairedItem).toEqual({ item: 0 });
		expect(second[1].pairedItem).toEqual({ item: 1 });
	});
});

describe('throwIfFatal', () => {
	it('maps the injected fatal envelope to PhpFatalError', () => {
		const stdout =
			'{"__php_fatal_error":true,"message":"Call to undefined function boom()","file":"Standard input code","line":42}\n';

		expect(() => throwIfFatal(stdout, '', 128)).toThrow(PhpFatalError);
		expect(() => throwIfFatal(stdout, '', 128)).toThrow(/boom.*Standard input code:42/s);
	});

	it('extracts the envelope when user output preceded the fatal error', () => {
		const stdout = '{"partial":true}\n{"__php_fatal_error":true,"message":"oops","file":"","line":9}\n';

		expect(() => throwIfFatal(stdout, '', 128)).toThrow(PhpFatalError);
		try {
			throwIfFatal(stdout, '', 128);
		} catch (error) {
			expect((error as PhpFatalError).message).toContain('oops');
			expect((error as PhpFatalError).line).toBe(9);
		}
	});

	it('detects memory exhaustion from stderr and reports the configured limit', () => {
		const stderr =
			'PHP Fatal error:  Allowed memory size of 134217728 bytes exhausted (tried to allocate 20480 bytes)\n';

		expect(() => throwIfFatal('', stderr, 128)).toThrow(PhpMemoryLimitError);
		expect(() => throwIfFatal('', stderr, 128)).toThrow(/128 MB/);
	});

	it('detects memory exhaustion from the envelope message as well', () => {
		const stdout =
			'{"__php_fatal_error":true,"message":"Allowed memory size of 67108864 bytes exhausted","file":"-","line":1}';

		expect(() => throwIfFatal(stdout, '', 64)).toThrow(PhpMemoryLimitError);
	});

	it('passes normal output through untouched', () => {
		expect(() => throwIfFatal('{"ok":true}', '', 128)).not.toThrow();
	});
});
