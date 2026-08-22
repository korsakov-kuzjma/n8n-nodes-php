import type { IDataObject, INodeExecutionData } from 'n8n-workflow';

export class PhpOutputParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PhpOutputParseError';
	}
}

function isJsonObject(value: unknown): value is IDataObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface ParsePhpOutputOptions {
	itemIndex: number;
	strictJsonMode?: boolean;
}

export function parsePhpOutput(
	stdout: string,
	options: ParsePhpOutputOptions,
): INodeExecutionData[] {
	const { itemIndex, strictJsonMode = false } = options;
	const output = stdout.trim();

	let parsed: unknown;
	let parseError: SyntaxError | undefined;
	try {
		parsed = JSON.parse(output) as unknown;
	} catch (error) {
		parseError = error as SyntaxError;
	}

	if (!parseError) {
		if (Array.isArray(parsed)) {
			return parsed.map((element) => ({
				json: isJsonObject(element) ? element : { output: element },
				pairedItem: { item: itemIndex },
			}));
		}
		if (isJsonObject(parsed)) {
			return [{ json: parsed, pairedItem: { item: itemIndex } }];
		}
	} else if (strictJsonMode) {
		throw new PhpOutputParseError(
			`Strict JSON Mode is enabled, but the PHP output is not valid JSON (${parseError.message}). Return valid JSON via json_encode() or disable Strict JSON Mode.`,
		);
	}

	return [{ json: { output }, pairedItem: { item: itemIndex } }];
}
