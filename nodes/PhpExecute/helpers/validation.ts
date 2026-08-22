import { z } from 'zod';
import type { SecurityLevel, ValidatedNodeOptions } from '../interfaces';

const DEFAULT_TIMEOUT_SECONDS = 30;
const DEFAULT_PHP_BINARY = 'php';
const DEFAULT_MEMORY_LIMIT_MB = 128;
const DEFAULT_CACHE_TTL_SECONDS = 0;

const binaryPathPattern = /^[a-zA-Z0-9_\-./\\:() ]+$/;

const booleanOption = z
	.union([z.boolean(), z.literal('true'), z.literal('false'), z.literal(0), z.literal(1)])
	.transform((value) => value === true || value === 'true' || value === 1);

export const phpExecuteOptionsSchema = z.object({
	timeout: z.coerce.number().int().min(1).max(3600).default(DEFAULT_TIMEOUT_SECONDS),
	phpBinaryPath: z
		.string()
		.trim()
		.min(1)
		.regex(binaryPathPattern)
		.default(DEFAULT_PHP_BINARY),
	memoryLimit: z.coerce.number().int().min(1).max(4096).default(DEFAULT_MEMORY_LIMIT_MB),
	executionMode: z.enum(['item-by-item', 'batch']).default('item-by-item'),
	securityLevel: z.enum(['restricted', 'unrestricted']).optional(),
	strictJsonMode: booleanOption.default(false),
	composerAutoloadPath: z.string().trim().default(''),
	resultCacheTtlSeconds: z.coerce.number().int().min(0).max(86400).default(DEFAULT_CACHE_TTL_SECONDS),
	additionalFiles: z
		.array(z.object({ name: z.string().trim().min(1), content: z.string() }))
		.max(50)
		.default([]),
	safeMode: z.boolean().optional(),
});

export type ParsedPhpExecuteOptions = z.infer<typeof phpExecuteOptionsSchema>;

export class PhpOptionsValidationError extends Error {
	constructor(issues: string[]) {
		super(`Invalid PHP Execute options: ${issues.join('; ')}`);
		this.name = 'PhpOptionsValidationError';
	}
}

function legacySecurityLevel(parsed: ParsedPhpExecuteOptions): SecurityLevel {
	if (parsed.securityLevel) return parsed.securityLevel;
	if (typeof parsed.safeMode === 'boolean') {
		return parsed.safeMode ? 'restricted' : 'unrestricted';
	}
	return 'restricted';
}

export function validateNodeOptions(raw: unknown): ValidatedNodeOptions {
	const result = phpExecuteOptionsSchema.safeParse(raw ?? {});
	if (!result.success) {
		throw new PhpOptionsValidationError(
			result.error.issues.map((issue) => `${issue.path.join('.') || 'options'}: ${issue.message}`),
		);
	}
	const parsed = result.data;
	return {
		binaryPath: parsed.phpBinaryPath,
		timeoutMs: parsed.timeout * 1000,
		memoryLimitMb: parsed.memoryLimit,
		executionMode: parsed.executionMode,
		securityLevel: legacySecurityLevel(parsed),
		strictJsonMode: parsed.strictJsonMode,
		composerAutoloadPath: parsed.composerAutoloadPath,
		resultCacheTtlSeconds: parsed.resultCacheTtlSeconds,
		additionalFiles: parsed.additionalFiles,
	};
}
