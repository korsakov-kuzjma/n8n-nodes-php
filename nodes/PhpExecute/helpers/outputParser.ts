import type { GenericValue, IDataObject, INodeExecutionData } from 'n8n-workflow';
import { PhpFatalError, PhpMemoryLimitError, PhpOutputParseError } from './errors';

const MEMORY_EXHAUSTION_PATTERN = /Allowed memory size of \d+ bytes exhausted/;

function isJsonObject(value: unknown): value is IDataObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeJsonString(raw: string): string {
	try {
		return JSON.parse(`"${raw}"`) as string;
	} catch {
		return raw;
	}
}

export function detectFatalEnvelope(stdout: string): PhpFatalError | null {
	const markerAt = stdout.lastIndexOf('{"__php_fatal_error"');
	if (markerAt === -1) return null;
	const tail = stdout.slice(markerAt);
	let parsed: unknown;
	try {
		parsed = JSON.parse(tail.trim());
	} catch {
		parsed = null;
	}
	if (isJsonObject(parsed) && parsed.__php_fatal_error === true) {
		return new PhpFatalError(
			String(parsed.message ?? 'Unknown fatal error'),
			String(parsed.file ?? 'Standard input code'),
			Number(parsed.line ?? 0),
		);
	}
	if (!/"__php_fatal_error"\s*:\s*true/.test(tail)) return null;
	const message = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(tail)?.[1];
	const file = /"file"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(tail)?.[1];
	const line = Number(/"line"\s*:\s*(\d+)/.exec(tail)?.[1] ?? 0);
	return new PhpFatalError(
		message ? decodeJsonString(message) : 'Unknown fatal error',
		file ? decodeJsonString(file) : 'Standard input code',
		line,
	);
}

export function throwIfFatal(stdout: string, stderr: string, memoryLimitMb: number): void {
	if (MEMORY_EXHAUSTION_PATTERN.test(stderr)) {
		throw new PhpMemoryLimitError(memoryLimitMb);
	}
	const fatal = detectFatalEnvelope(stdout);
	if (fatal) {
		if (/Allowed memory size of \d+ bytes exhausted/.test(fatal.message)) {
			throw new PhpMemoryLimitError(memoryLimitMb);
		}
		throw fatal;
	}
}

export type ParsedPhpOutput =
	| { kind: 'json'; values: unknown[] }
	| { kind: 'text'; text: string };

export function parsePhpElements(
	stdout: string,
	options: { strictJsonMode?: boolean },
): ParsedPhpOutput {
	const { strictJsonMode = false } = options;
	const output = stdout.trim();

	let parsed: unknown;
	let parseError: SyntaxError | undefined;
	try {
		parsed = JSON.parse(output) as unknown;
	} catch (error) {
		parseError = error as SyntaxError;
	}

	if (!parseError) {
		if (Array.isArray(parsed)) return { kind: 'json', values: parsed };
		if (isJsonObject(parsed)) return { kind: 'json', values: [parsed] };
		return { kind: 'json', values: [parsed] };
	}
	if (strictJsonMode) {
		throw new PhpOutputParseError(
			`Strict JSON Mode is enabled, but the PHP output is not valid JSON (${parseError.message}). Return valid JSON via json_encode() or disable Strict JSON Mode.`,
		);
	}
	return { kind: 'text', text: output };
}

export function wrapValue(value: unknown): IDataObject {
	return isJsonObject(value) ? value : { output: value as GenericValue };
}

export function toExecutionData(parsed: ParsedPhpOutput, itemIndex: number): INodeExecutionData[] {
	if (parsed.kind === 'text') {
		return [{ json: { output: parsed.text }, pairedItem: { item: itemIndex } }];
	}
	return parsed.values.map((element) => ({
		json: wrapValue(element),
		pairedItem: { item: itemIndex },
	}));
}

export function parsePhpOutput(
	stdout: string,
	options: { itemIndex: number; strictJsonMode?: boolean },
): INodeExecutionData[] {
	return toExecutionData(parsePhpElements(stdout, options), options.itemIndex);
}
