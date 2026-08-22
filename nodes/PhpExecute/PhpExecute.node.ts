import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeConnectionTypes,
	NodeOperationError,
} from 'n8n-workflow';
import { access, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildPhpArgs, runPhpProcess } from './helpers/phpProcess';
import { parsePhpOutput } from './helpers/outputParser';
import {
	DATA_INJECTION_METHODS,
	type DataInjectionMethod,
	type PhpExecuteOptions,
} from './interfaces';

const DEFAULT_TIMEOUT_SECONDS = 30;
const DEFAULT_PHP_BINARY = 'php';
const DEFAULT_MEMORY_LIMIT_MB = 128;

function positiveNumber(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

async function existingFile(path: string | undefined): Promise<string | null> {
	if (!path || !path.trim()) return null;
	try {
		await access(path);
		return path;
	} catch {
		return null;
	}
}

export class PhpExecute implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'PHP Execute',
		name: 'phpExecute',
		icon: { light: 'file:../../icons/php.svg', dark: 'file:../../icons/php-dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: 'Run custom PHP code',
		description: 'Executes arbitrary PHP code via the local PHP CLI and returns the result',
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
				default:
					'<?php\n$input = json_decode(file_get_contents("php://stdin"), true);\necho json_encode(["status" => "success", "input" => $input]);',
				description:
					'The PHP code to execute. Use echo to return data to n8n. The current item JSON arrives via STDIN unless another injection method is selected.',
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
							'Interpolate item fields into the code with n8n expressions (e.g. the email field) before execution',
					},
					{
						name: 'STDIN',
						value: DATA_INJECTION_METHODS.STDIN,
						description:
							'Pass the current item data to the PHP process via standard input. Safe for any special characters. Read it from php://stdin in your script',
					},
				],
				description: 'How the incoming item data is made available to the PHP script',
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
							'Path to a Composer vendor/autoload.php, prepended via auto_prepend_file. Ignored if the file does not exist.',
					},
					{
						displayName: 'Memory Limit (MB)',
						name: 'memoryLimit',
						type: 'number',
						typeOptions: {
							minValue: 1,
						},
						default: DEFAULT_MEMORY_LIMIT_MB,
						description: 'PHP memory_limit in megabytes applied to the executed script',
					},
					{
						displayName: 'PHP Binary Path',
						name: 'phpBinaryPath',
						type: 'string',
						default: DEFAULT_PHP_BINARY,
						description: 'Path to the PHP CLI binary, e.g. /usr/bin/php8.3',
					},
					{
						displayName: 'Safe Mode',
						name: 'safeMode',
						type: 'boolean',
						default: false,
						description: 'Whether to disable executable functions (exec, shell_exec, system, passthru, popen, proc_open) and restrict file access to the temporary script directory via open_basedir',
					},
					{
						displayName: 'Strict JSON Mode',
						name: 'strictJsonMode',
						type: 'boolean',
						default: false,
						description: 'Whether to fail when the output is not valid JSON instead of returning it wrapped as { output }',
					},
					{
						displayName: 'Timeout (Seconds)',
						name: 'timeout',
						type: 'number',
						typeOptions: {
							minValue: 1,
						},
						default: DEFAULT_TIMEOUT_SECONDS,
						description: 'Maximum execution time before the PHP process receives SIGTERM (followed by SIGKILL after 2 s)',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const phpCode = this.getNodeParameter('phpCode', i) as string;
				const injectionMethod = this.getNodeParameter(
					'dataInjectionMethod',
					i,
					DATA_INJECTION_METHODS.STDIN,
				) as DataInjectionMethod;
				const options = this.getNodeParameter('options', i, {}) as PhpExecuteOptions;

				const binaryPath =
					typeof options.phpBinaryPath === 'string' && options.phpBinaryPath.trim()
						? options.phpBinaryPath.trim()
						: DEFAULT_PHP_BINARY;
				const timeoutMs =
					positiveNumber(options.timeout, DEFAULT_TIMEOUT_SECONDS) * 1000;
				const strictJsonMode = options.strictJsonMode === true;
				const safeMode = options.safeMode === true;
				const memoryLimitMb = positiveNumber(options.memoryLimit, DEFAULT_MEMORY_LIMIT_MB);
				const composerAutoloadPath = await existingFile(options.composerAutoloadPath);

				const tempDir = await mkdtemp(join(tmpdir(), 'n8n-php-'));
				try {
					const tempFilePath = join(tempDir, 'script.php');
					await writeFile(tempFilePath, phpCode, 'utf-8');
					const args = buildPhpArgs({ safeMode, memoryLimitMb, composerAutoloadPath }, tempDir);
					const stdinData =
						injectionMethod === DATA_INJECTION_METHODS.STDIN
							? JSON.stringify(items[i].json ?? {})
							: null;
					const result = await runPhpProcess({
						binaryPath,
						scriptPath: tempFilePath,
						args,
						timeoutMs,
						stdinData,
					});
					returnData.push(
						...parsePhpOutput(result.stdout, { itemIndex: i, strictJsonMode }),
					);
				} finally {
					await rm(tempDir, { recursive: true, force: true });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}
		return [returnData];
	}
}
