import { parsePhpOutput, PhpOutputParseError } from '../helpers/outputParser';

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
			['42', '42'],
			['"quoted"', '"quoted"'],
			['true', 'true'],
		])('keeps %s as the raw output text', (stdout, expected) => {
			const items = parsePhpOutput(stdout, { itemIndex: 0 });

			expect(items[0].json).toEqual({ output: expected });
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
