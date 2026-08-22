import {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeConnectionTypes,
	NodeOperationError,
} from 'n8n-workflow';
import { spawn } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const DEFAULT_TIMEOUT_SECONDS = 30;

function isJsonObject(value: unknown): value is IDataObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toOutputItems(stdout: string, itemIndex: number): INodeExecutionData[] {
	let parsed: unknown = undefined;
	try {
		parsed = JSON.parse(stdout) as unknown;
	} catch {
		parsed = undefined;
	}
	if (Array.isArray(parsed)) {
		return parsed.map((element) => ({
			json: isJsonObject(element) ? element : { output: element },
			pairedItem: { item: itemIndex },
		}));
	}
	if (isJsonObject(parsed)) {
		return [{ json: parsed, pairedItem: { item: itemIndex } }];
	}
	return [{ json: { output: stdout }, pairedItem: { item: itemIndex } }];
}

function runPhpProcess(filePath: string, timeoutMs: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const php = spawn('php', [filePath]);
		let stdout = '';
		let stderr = '';
		let settled = false;

		const timer = setTimeout(() => {
			settled = true;
			php.kill('SIGKILL');
			reject(new Error(`PHP execution timed out after ${timeoutMs / 1000} s`));
		}, timeoutMs);

		php.stdout.on('data', (chunk) => {
			stdout += chunk.toString();
		});
		php.stderr.on('data', (chunk) => {
			stderr += chunk.toString();
		});

		php.on('error', (error) => {
			clearTimeout(timer);
			if (settled) return;
			settled = true;
			const message =
				(error as NodeJS.ErrnoException).code === 'ENOENT'
					? 'PHP binary not found. Install the PHP CLI and make sure "php" is available in PATH.'
					: error.message;
			reject(new Error(message));
		});

		php.on('close', (code) => {
			clearTimeout(timer);
			if (settled) return;
			settled = true;
			if (code !== 0) {
				const details = stderr.trim() || stdout.trim();
				reject(new Error(`PHP exited with code ${code}${details ? `: ${details}` : ''}`));
			} else {
				resolve(stdout);
			}
		});
	});
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
					'<?php\n$data = ["status" => "success", "time" => time()];\necho json_encode($data);',
				description: 'The PHP code to execute. Use echo to return data to n8n.',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Timeout (Seconds)',
						name: 'timeout',
						type: 'number',
						typeOptions: {
							minValue: 1,
						},
						default: DEFAULT_TIMEOUT_SECONDS,
						description: 'Maximum execution time before the PHP process is killed',
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
				const options = this.getNodeParameter('options', i, {}) as IDataObject;
				const timeoutSeconds = (options.timeout as number) ?? DEFAULT_TIMEOUT_SECONDS;

				const tempDir = await mkdtemp(join(tmpdir(), 'n8n-php-'));
				try {
					const tempFilePath = join(tempDir, 'script.php');
					await writeFile(tempFilePath, phpCode, 'utf-8');
					const stdout = await runPhpProcess(tempFilePath, timeoutSeconds * 1000);
					returnData.push(...toOutputItems(stdout.trim(), i));
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
