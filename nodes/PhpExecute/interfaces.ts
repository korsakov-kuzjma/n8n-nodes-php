import type { IDataObject } from 'n8n-workflow';

export type DataInjectionMethod = 'stdin' | 'handlebars';

export const DATA_INJECTION_METHODS: Record<'STDIN' | 'HANDLEBARS', DataInjectionMethod> = {
	STDIN: 'stdin',
	HANDLEBARS: 'handlebars',
};

export interface PhpExecuteOptions extends IDataObject {
	timeout?: number;
	phpBinaryPath?: string;
	strictJsonMode?: boolean;
	composerAutoloadPath?: string;
	safeMode?: boolean;
	memoryLimit?: number;
}

export interface ResolvedNodeOptions {
	phpCode: string;
	injectionMethod: DataInjectionMethod;
	binaryPath: string;
	timeoutMs: number;
	strictJsonMode: boolean;
	composerAutoloadPath: string | null;
	safeMode: boolean;
	memoryLimitMb: number | null;
}

export interface PhpRunResult {
	stdout: string;
	stderr: string;
	exitCode: number | null;
}

export interface SpawnPhpOptions {
	filePath: string;
	args: string[];
	binaryPath: string;
	timeoutMs: number;
	stdinData: string | null;
	maxOutputBytes: number;
}
