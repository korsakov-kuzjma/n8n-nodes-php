import type { IDataObject } from 'n8n-workflow';

export type DataInjectionMethod = 'stdin' | 'handlebars';

export const DATA_INJECTION_METHODS: Record<'STDIN' | 'HANDLEBARS', DataInjectionMethod> = {
	STDIN: 'stdin',
	HANDLEBARS: 'handlebars',
};

export type ExecutionMode = 'item-by-item' | 'batch';

export type SecurityLevel = 'restricted' | 'unrestricted';

export interface PhpExecuteOptions extends IDataObject {
	timeout?: number;
	phpBinaryPath?: string;
	strictJsonMode?: boolean;
	composerAutoloadPath?: string;
	safeMode?: boolean;
	memoryLimit?: number;
	executionMode?: ExecutionMode;
	securityLevel?: SecurityLevel;
	resultCacheTtlSeconds?: number;
	additionalFiles?: Array<{ name: string; content: string }>;
}

export interface ValidatedNodeOptions {
	binaryPath: string;
	timeoutMs: number;
	memoryLimitMb: number;
	executionMode: ExecutionMode;
	securityLevel: SecurityLevel;
	strictJsonMode: boolean;
	composerAutoloadPath: string;
	resultCacheTtlSeconds: number;
	additionalFiles: Array<{ name: string; content: string }>;
}

export interface N8nContextInfo {
	nodeName: string;
	nodeId: string;
	workflowId: string;
	workflowName: string;
	runIndex: number;
	executionId: string;
	mode: string;
}

export interface PayloadDescriptor {
	itemsJson: string;
	contextJson: string;
	cacheKeySeed: string;
}
