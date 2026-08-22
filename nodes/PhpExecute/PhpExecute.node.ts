import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeConnectionTypes,
	NodeOperationError,
} from 'n8n-workflow';
import { access } from 'fs/promises';
import type { PhpMetrics } from './helpers/bootstrap';
import { buildInjectedCode } from './helpers/bootstrap';
import { sha256, TtlCache } from './helpers/cache';
import { buildNonZeroExitError, buildPhpArgs, runPhpProcess } from './helpers/phpProcess';
import { parsePhpElements, throwIfFatal, toExecutionData, type ParsedPhpOutput } from './helpers/outputParser';
import {
	buildOpenBasedir,
	prepareSandbox,
	resolveIsolation,
} from './helpers/sandbox';
import { assertNoRestrictedPatterns } from './helpers/staticAnalysis';
import { validateNodeOptions } from './helpers/validation';
import {
	DATA_INJECTION_METHODS,
	type DataInjectionMethod,
	type N8nContextInfo,
	type PhpExecuteOptions,
	type ValidatedNodeOptions,
} from './interfaces';

const DEFAULT_CODE =
	'<?php\necho json_encode(["status" => "success", "input" => $n8nInput]);';

interface CachePayload {
	parsed: ParsedPhpOutput;
	metrics: PhpMetrics | null;
}

const resultCache = new TtlCache(100);

async function existingFile(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function normalizeAdditionalFiles(raw: unknown): Array<{ name: string; content: string }> {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
	const files = (raw as Record<string, unknown>).files;
	if (!Array.isArray(files)) return [];
	return files
		.filter((file): file is Record<string, unknown> => typeof file === 'object' && file !== null)
		.map((file) => ({ name: String(file.name ?? ''), content: String(file.content ?? '') }))
		.filter((file) => file.name.trim() !== '');
}

function safely<T>(fn: () => T, fallback: T): T {
	try {
		return fn();
	} catch {
		return fallback;
	}
}

function buildContextInfo(ctx: IExecuteFunctions): N8nContextInfo {
	const node = ctx.getNode();
	const workflow = safely(() => ctx.getWorkflow(), undefined);
	const executionId = safely(() => ctx.getExecutionId(), undefined);
	const mode = safely(() => ctx.getMode(), undefined as unknown as string);
	const runIndex = safely(() => ctx.getExecuteData()?.runIndex, undefined);
	return {
		nodeName: node.name,
		nodeId: node.id ?? '',
		workflowId: workflow?.id ? String(workflow.id) : '',
		workflowName: workflow?.name ?? '',
		runIndex: runIndex ?? 0,
		executionId: executionId ?? '',
		mode: mode === undefined ? '' : String(mode),
	};
}

function pairOutputs(
	parsed: ParsedPhpOutput,
	sourceIndex: number,
	inputCount: number,
	isBatch: boolean,
): INodeExecutionData[] {
	const items = toExecutionData(parsed, sourceIndex);
	if (!isBatch || inputCount === 0 || parsed.kind !== 'json') {
		return items;
	}
	if (items.length === inputCount) {
		return items.map((item, index) => ({ ...item, pairedItem: { item: index } }));
	}
	return items.map((item) => ({ ...item, pairedItem: { item: 0 } }));
}

export class PhpExecute implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'PHP Execute',
		name: 'phpExecute',
		icon: { light: 'file:../../icons/php.svg', dark: 'file:../../icons/php-dark.svg' },
		group: ['transform'],
		version: 2,
		subtitle: 'Run custom PHP code in-memory',
		description:
			'Executes arbitrary PHP code via the local PHP CLI. Code is piped straight to STDIN — no temp files',
		defaults: {
			name: 'PHP Execute',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			{
				displayName: 'PHP Code',
				name: 'phpCode',
				type: 'string',
				typeOptions: {
					rows: 10,
					editor: 'codeNodeEditor',
				},
				default: DEFAULT_CODE,
				description:
					'The PHP code to execute. It is piped to the interpreter via STDIN. Incoming data is available in the $n8nInput variable (first item), all items in $n8nItems and workflow metadata in $n8nContext.',
			},
			{
				displayName: 'Data Injection Method',
				name: 'dataInjectionMethod',
				type: 'options',
				default: 'stdin',
				options: [
					{
						name: 'Handlebars (Legacy)',
						value: DATA_INJECTION_METHODS.HANDLEBARS,
						description:
							'Interpolate item fields into the code with n8n expressions before execution',
					},
					{
						name: 'Payload Variable ($n8nInput)',
						value: DATA_INJECTION_METHODS.STDIN,
						description:
							'Pass item data out-of-band on a dedicated pipe; read it in your script via the pre-decoded $n8nInput variable',
					},
				],
				description: 'How the incoming item data is made available to the PHP script',
			},
			{
				displayName: 'Execution Mode',
				name: 'executionMode',
				type: 'options',
				default: 'item-by-item',
			options: [
				{
					name: 'Run Once for All Items',
					value: 'batch',
					description:
						'Spawn a single PHP process for all items; iterate over $n8nItems and echo an array of results',
				},
				{
					name: 'Run Once for Each Item',
					value: 'item-by-item',
					description:
						'Spawn one PHP process per incoming item; $n8nInput holds the current item JSON',
				},
			],
				description:
					'Batch mode amortizes interpreter startup across all items but requires you to loop inside PHP',
			},
			{
				displayName: 'Additional Files',
				name: 'additionalFiles',
				placeholder: 'Add File',
				type: 'fixedCollection',
				default: {},
				typeOptions: {
					multipleValues: true,
					multipleValueButtonText: 'Add File',
				},
				options: [
					{
						name: 'files',
						displayName: 'File',
						values: [
							{
								displayName: 'File Name',
								name: 'name',
								type: 'string',
								default: '',
								placeholder: 'helpers.php',
								description:
									'File name written into the sandbox directory (letters, digits, dots, dashes, underscores)',
							},
							{
								displayName: 'Content',
								name: 'content',
								type: 'string',
								typeOptions: {
									rows: 6,
									editor: 'codeNodeEditor',
								},
								default: '',
								description: 'PHP source of this file',
							},
						],
					},
				],
				description:
					'Extra files (classes, configs) written into the sandbox directory before execution; load them with require_once "name"',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
			options: [
				{
					displayName: 'Composer Autoload Path',
					name: 'composerAutoloadPath',
					type: 'string',
					default: '',
					placeholder: '/var/www/app/vendor/autoload.php',
					description:
						'Path to a Composer vendor/autoload.php, prepended via auto_prepend_file. A warning is logged when the file does not exist.',
				},
				{
					displayName: 'Memory Limit (MB)',
					name: 'memoryLimit',
					type: 'number',
					typeOptions: {
						minValue: 1,
						maxValue: 4096,
						numberPrecision: 0,
					},
					default: 128,
					description: 'PHP memory_limit in megabytes applied to the executed script',
				},
				{
					displayName: 'PHP Binary Path',
					name: 'phpBinaryPath',
					type: 'string',
					default: 'php',
					description: 'Path to the PHP CLI binary, e.g. /usr/bin/php8.3',
				},
				{
					displayName: 'Result Cache TTL (Seconds)',
					name: 'resultCacheTtlSeconds',
					type: 'number',
					typeOptions: {
						minValue: 0,
						maxValue: 86400,
						numberPrecision: 0,
					},
					default: 0,
					description:
						'Cache identical executions for this many seconds, keyed by a SHA-256 hash of code + input payload (0 disables caching)',
				},
				{
					displayName: 'Security Level',
					name: 'securityLevel',
					type: 'options',
					default: 'restricted',
					options: [
						{
							name: 'Restricted',
							value: 'restricted',
							description:
								'Disables shell/process/env functions, remote URL wrappers, restricts file access to the sandbox (open_basedir), runs a static code scan before execution and drops privileges to nobody when n8n runs as root',
						},
						{
							name: 'Unrestricted',
							value: 'unrestricted',
							description:
								'No hardening at all: full function set, no open_basedir, no static analysis, no privilege drop. Only for fully trusted scripts.',
						},
					],
					description: 'How aggressively the executed code is sandboxed',
				},
				{
					displayName: 'Strict JSON Mode',
					name: 'strictJsonMode',
					type: 'boolean',
					default: false,
					description:
						'Whether to fail when the output is not valid JSON instead of returning it wrapped as { output }',
				},
				{
					displayName: 'Timeout (Seconds)',
					name: 'timeout',
					type: 'number',
					typeOptions: {
						minValue: 1,
						maxValue: 3600,
						numberPrecision: 0,
					},
					default: 30,
					description:
						'Maximum execution time before the PHP process receives SIGTERM (followed by SIGKILL after 2 s)',
				},
			],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		if (items.length === 0) {
			return [[]];
		}
		const returnData: INodeExecutionData[] = [];
		const inputJsons = items.map((item) => item.json ?? {});

		const rawOptions = this.getNodeParameter('options', 0, {}) as PhpExecuteOptions;
		let options: ValidatedNodeOptions;
		try {
			options = validateNodeOptions({
				...rawOptions,
				additionalFiles: normalizeAdditionalFiles(
					this.getNodeParameter('additionalFiles', 0, {}),
				),
			});
		} catch (error) {
			throw new NodeOperationError(this.getNode(), error as Error);
		}

		const restricted = options.securityLevel === 'restricted';
		const isBatch = options.executionMode === 'batch';
		if (restricted) {
			try {
				assertNoRestrictedPatterns(String(this.getNodeParameter('phpCode', 0, '')));
			} catch (error) {
				throw new NodeOperationError(this.getNode(), error as Error);
			}
		}

		let composerAutoloadPath: string | null = null;
		const composerCandidate = options.composerAutoloadPath.trim();
		if (composerCandidate !== '') {
			if (await existingFile(composerCandidate)) {
				composerAutoloadPath = composerCandidate;
			} else {
				this.logger.warn(
					`[PHP Execute] Composer autoload path is set, but the file does not exist: ${composerCandidate}. Continuing without it.`,
				);
			}
		}

		const isolation = resolveIsolation(restricted);
		const sandboxDir = await prepareSandbox(options.additionalFiles, isolation.uid !== undefined);
		const processIsolation = { ...isolation, cwd: sandboxDir };
		const args = buildPhpArgs({
			memoryLimitMb: options.memoryLimitMb,
			restricted,
			composerAutoloadPath,
			openBasedir: restricted ? buildOpenBasedir(composerAutoloadPath) : null,
		});

		const contextInfo = buildContextInfo(this);
		const indices = isBatch ? [0] : items.map((_, index) => index);

		for (const itemIndex of indices) {
			let metrics: PhpMetrics | null = null;
			try {
				const phpCode = String(this.getNodeParameter('phpCode', itemIndex, ''));
				const injectionMethod = this.getNodeParameter(
					'dataInjectionMethod',
					itemIndex,
					DATA_INJECTION_METHODS.STDIN,
				) as DataInjectionMethod;
				const payloadJson =
					injectionMethod === DATA_INJECTION_METHODS.STDIN
						? JSON.stringify({
								items: isBatch ? inputJsons : [inputJsons[itemIndex] ?? {}],
								context: contextInfo,
							})
						: null;

				const cacheKey = sha256(
					phpCode,
					payloadJson ?? '',
					options.binaryPath,
					String(options.memoryLimitMb),
					options.securityLevel,
					composerAutoloadPath ?? '',
					JSON.stringify(options.additionalFiles),
					String(options.strictJsonMode),
				);

				const runFresh = async (): Promise<CachePayload> => {
					const result = await runPhpProcess({
						binaryPath: options.binaryPath,
						args,
						injectedCode: buildInjectedCode(phpCode),
						timeoutMs: options.timeoutMs,
						payloadJson,
						isolation: processIsolation,
					});
					const runMetrics: PhpMetrics = { ...(result.metrics ?? {}), exitCode: result.exitCode };
					this.logger.debug('[PHP Execute] metrics', runMetrics);
					metrics = runMetrics;
					throwIfFatal(result.stdout, result.stderr, options.memoryLimitMb);
					if (result.exitCode !== 0) {
						throw buildNonZeroExitError(result.exitCode, result.stderr, result.stdout);
					}
					return {
						parsed: parsePhpElements(result.stdout, {
							strictJsonMode: options.strictJsonMode,
						}),
						metrics: runMetrics,
					};
				};

				let cachePayload: CachePayload | undefined;
				if (options.resultCacheTtlSeconds > 0) {
					cachePayload = resultCache.get(cacheKey) as CachePayload | undefined;
				}
				if (!cachePayload) {
					cachePayload = await runFresh();
					if (options.resultCacheTtlSeconds > 0) {
						resultCache.set(cacheKey, cachePayload, options.resultCacheTtlSeconds * 1000);
					}
				} else {
					this.logger.debug('[PHP Execute] served result from cache');
				}
				metrics = cachePayload.metrics;

				returnData.push(...pairOutputs(cachePayload.parsed, itemIndex, items.length, isBatch));
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: (error as Error).message,
							...(metrics ? { _phpMetrics: metrics } : {}),
						},
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}
		return [returnData];
	}
}
