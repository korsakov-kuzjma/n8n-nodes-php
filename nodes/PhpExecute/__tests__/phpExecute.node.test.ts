import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { PhpExecute } from '../PhpExecute.node';
import { runPhpProcess } from '../helpers/phpProcess';
import { METRICS_MARKER } from '../helpers/bootstrap';

jest.mock('../helpers/phpProcess', () => {
	const actual = jest.requireActual('../helpers/phpProcess');
	return {
		...actual,
		runPhpProcess: jest.fn(),
	};
});

const mockedRun = runPhpProcess as jest.Mock;

interface ContextOverrides {
	items?: Array<{ json: Record<string, unknown> }>;
	parameters?: Record<string, unknown>;
	parametersByItem?: Record<number, Record<string, unknown>>;
	continueOnFail?: boolean;
}

function createStubContext(overrides: ContextOverrides = {}): IExecuteFunctions {
	const node = {
		id: 'uuid-1234',
		name: 'PHP Execute 1',
		type: 'n8n-nodes-php.phpExecute',
		typeVersion: 2,
		position: [0, 0] as [number, number],
		parameters: {},
	};
	const logger = {
		debug: jest.fn(),
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
	};
	const parameters = overrides.parameters ?? {};
	const stub = {
		logger,
		getInputData: () => overrides.items ?? [],
		getNodeParameter: (name: string, itemIndex = 0, fallback?: unknown) => {
			const perItem = overrides.parametersByItem?.[itemIndex];
			if (perItem && name in perItem) return perItem[name];
			if (name in parameters) return parameters[name];
			if (fallback !== undefined) return fallback;
			throw new Error(`No parameter configured: ${name}`);
		},
		getNode: () => node,
		getWorkflow: () => ({ id: '1029', name: 'Test Workflow', active: true }),
		getExecutionId: () => 'exec-999',
		getMode: () => 'manual',
		getExecuteData: () => ({ runIndex: 3, data: {}, node, source: null }),
		continueOnFail: () => overrides.continueOnFail ?? false,
	};
	return stub as unknown as IExecuteFunctions;
}

function phpOk(stdout: string) {
	return {
		stdout,
		stderr: `${METRICS_MARKER}{"phpVersion":"8.5.9","executionTimeMs":1.2,"peakMemoryUsageMb":2.5}\n`,
		exitCode: 0,
		metrics: { phpVersion: '8.5.9', executionTimeMs: 1.2, peakMemoryUsageMb: 2.5 },
	};
}

const DEFAULT_CODE = '<?php echo json_encode(["status" => "success", "input" => $n8nInput]);';

describe('PhpExecute.execute (item-by-item)', () => {
	beforeEach(() => {
		mockedRun.mockReset();
	});

	it('spawns one process per item and pipes the per-item payload on fd 3', async () => {
		const items = [{ json: { email: 'a@b.c' } }, { json: { email: 'd@e.f' } }];
		mockedRun.mockImplementation(async ({ payloadJson }: { payloadJson: string | null }) =>
			phpOk(JSON.stringify({ echo: JSON.parse(payloadJson ?? '{}') })),
		);
		const ctx = createStubContext({
			items,
			parameters: { phpCode: DEFAULT_CODE, options: {} },
		});

		const result = await new PhpExecute().execute.call(ctx);

		expect(mockedRun).toHaveBeenCalledTimes(2);
		const firstPayload = JSON.parse(mockedRun.mock.calls[0][0].payloadJson as string);
		expect(firstPayload.items).toEqual([{ email: 'a@b.c' }]);
		expect(firstPayload.context).toMatchObject({
			nodeName: 'PHP Execute 1',
			nodeId: 'uuid-1234',
			workflowId: '1029',
			executionId: 'exec-999',
			runIndex: 3,
			mode: 'manual',
		});
		const secondPayload = JSON.parse(mockedRun.mock.calls[1][0].payloadJson as string);
		expect(secondPayload.items).toEqual([{ email: 'd@e.f' }]);

		expect(result).toEqual([
			[
				{
					json: { echo: { items: [{ email: 'a@b.c' }], context: firstPayload.context } },
					pairedItem: { item: 0 },
				},
				{
					json: { echo: { items: [{ email: 'd@e.f' }], context: secondPayload.context } },
					pairedItem: { item: 1 },
				},
			],
		]);
	});

	it('logs execution metrics for successful runs', async () => {
		mockedRun.mockResolvedValue(phpOk('{"done":true}'));
		const ctx = createStubContext({
			items: [{ json: {} }],
			parameters: { phpCode: DEFAULT_CODE, options: {} },
		});

		await new PhpExecute().execute.call(ctx);

		expect(ctx.logger.debug).toHaveBeenCalledWith(
			'[PHP Execute] metrics',
			expect.objectContaining({
				phpVersion: '8.5.9',
				executionTimeMs: 1.2,
				peakMemoryUsageMb: 2.5,
				exitCode: 0,
			}),
		);
	});
});

describe('PhpExecute.execute (batch mode)', () => {
	beforeEach(() => {
		mockedRun.mockReset();
	});

	it('runs a single process with all items and pairs outputs 1:1 when lengths match', async () => {
		const items = Array.from({ length: 10 }, (_, i) => ({ json: { index: i } }));
		mockedRun.mockImplementation(async () =>
			phpOk(JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ result: `r${i}` })))),
		);
		const ctx = createStubContext({
			items,
			parameters: {
				phpCode: DEFAULT_CODE,
				options: { executionMode: 'batch' },
			},
		});

		const result = await new PhpExecute().execute.call(ctx);

		expect(mockedRun).toHaveBeenCalledTimes(1);
		const payload = JSON.parse(mockedRun.mock.calls[0][0].payloadJson as string);
		expect(payload.items).toHaveLength(10);
		expect(payload.items[7]).toEqual({ index: 7 });

		const outputItems = result[0];
		expect(outputItems).toHaveLength(10);
		outputItems.forEach((item: INodeExecutionData, i: number) => {
			expect(item.json).toEqual({ result: `r${i}` });
			expect(item.pairedItem).toEqual({ item: i });
		});
	});

	it('pairs every output to the first input when the batch length differs', async () => {
		const items = Array.from({ length: 4 }, (_, i) => ({ json: { index: i } }));
		mockedRun.mockImplementation(async () =>
			phpOk(JSON.stringify([{ summary: 'aggregated' }])),
		);
		const ctx = createStubContext({
			items,
			parameters: { phpCode: DEFAULT_CODE, options: { executionMode: 'batch' } },
		});

		const result = await new PhpExecute().execute.call(ctx);

		expect(result[0]).toHaveLength(1);
		expect(result[0][0].pairedItem).toEqual({ item: 0 });
		expect(result[0][0].json).toEqual({ summary: 'aggregated' });
	});

	it('keeps the legacy Handlebars mode working without a payload', async () => {
		mockedRun.mockImplementation(async () => phpOk('{"interpolated":"x"}'));
		const ctx = createStubContext({
			items: [{ json: {} }],
			parameters: {
				phpCode: DEFAULT_CODE,
				dataInjectionMethod: 'handlebars',
				options: {},
			},
		});

		await new PhpExecute().execute.call(ctx);

		expect(mockedRun.mock.calls[0][0].payloadJson).toBeNull();
	});
});

describe('PhpExecute.execute (caching)', () => {
	beforeEach(() => {
		mockedRun.mockReset();
	});

	it('serves repeated identical executions from the TTL cache', async () => {
		mockedRun.mockImplementation(async () => phpOk('{"n":1}'));

		const makeCtx = () =>
			createStubContext({
				items: [{ json: { x: 1 } }],
				parameters: {
					phpCode: '<?php echo json_encode(["n" => 1]);',
					options: { resultCacheTtlSeconds: 60 },
				},
			});

		const first = await new PhpExecute().execute.call(makeCtx());
		const second = await new PhpExecute().execute.call(makeCtx());

		expect(mockedRun).toHaveBeenCalledTimes(1);
		expect(second).toEqual(first);
	});

	it('does not cache when the TTL is zero and distinguishes different payloads', async () => {
		mockedRun.mockImplementation(async ({ payloadJson }: { payloadJson: string | null }) =>
			phpOk(JSON.stringify({ got: JSON.parse(payloadJson ?? '{}').items })),
		);

		const makeCtx = (value: number) =>
			createStubContext({
				items: [{ json: { x: value } }],
				parameters: {
					phpCode: '<?php echo 1;',
					options: { resultCacheTtlSeconds: 0 },
				},
			});

		await new PhpExecute().execute.call(makeCtx(1));
		await new PhpExecute().execute.call(makeCtx(2));

		expect(mockedRun).toHaveBeenCalledTimes(2);
	});

	it('does not cache outputs larger than 1 MB', async () => {
		const big = JSON.stringify({ blob: 'x'.repeat(1024 * 1024 + 16) });
		mockedRun.mockImplementation(async () => phpOk(big));

		const makeCtx = () =>
			createStubContext({
				items: [{ json: { x: 1 } }],
				parameters: {
					phpCode: '<?php echo json_encode(["blob" => str_repeat("x", 1048600)]);',
					options: { resultCacheTtlSeconds: 60 },
				},
			});

		await new PhpExecute().execute.call(makeCtx());
		await new PhpExecute().execute.call(makeCtx());

		expect(mockedRun).toHaveBeenCalledTimes(2);
	});
});

describe('PhpExecute.execute (error handling)', () => {
	beforeEach(() => {
		mockedRun.mockReset();
	});

	it('blocks forbidden patterns before spawning in restricted mode', async () => {
		const ctx = createStubContext({
			items: [{ json: {} }],
			parameters: {
				phpCode: "<?php exec('ls');",
				options: { securityLevel: 'restricted' },
			},
		});

		await expect(new PhpExecute().execute.call(ctx)).rejects.toThrow(NodeOperationError);
		await expect(new PhpExecute().execute.call(ctx)).rejects.toThrow(
			/shell execution function \(exec\)/,
		);
		expect(mockedRun).not.toHaveBeenCalled();
	});

	it('blocks forbidden patterns inside additional files in restricted mode', async () => {
		const ctx = createStubContext({
			items: [{ json: {} }],
			parameters: {
				phpCode: DEFAULT_CODE,
				additionalFiles: {
					files: [{ name: 'helpers.php', content: "<?php system('id');" }],
				},
				options: { securityLevel: 'restricted' },
			},
		});

		await expect(new PhpExecute().execute.call(ctx)).rejects.toThrow(
			/additional file "helpers\.php".*shell execution function \(system\)/s,
		);
		expect(mockedRun).not.toHaveBeenCalled();
	});

	it('allows the same additional files in unrestricted mode', async () => {
		mockedRun.mockResolvedValue(phpOk('{"ok":true}'));
		const ctx = createStubContext({
			items: [{ json: {} }],
			parameters: {
				phpCode: DEFAULT_CODE,
				additionalFiles: {
					files: [{ name: 'helpers.php', content: "<?php system('id');" }],
				},
				options: { securityLevel: 'unrestricted' },
			},
		});

		await expect(new PhpExecute().execute.call(ctx)).resolves.toBeDefined();
	});

	it('scans the phpCode resolved for every item, not only the first one', async () => {
		mockedRun.mockResolvedValue(phpOk('{"i":0}'));
		const ctx = createStubContext({
			items: [{ json: { n: 1 } }, { json: { n: 2 } }],
			parameters: { options: {} },
			parametersByItem: {
				0: { phpCode: '<?php echo json_encode(["i" => 0]);' },
				1: { phpCode: "<?php shell_exec('whoami');" },
			},
		});

		await expect(new PhpExecute().execute.call(ctx)).rejects.toThrow(
			/shell execution function \(shell_exec\)/,
		);
		expect(mockedRun).toHaveBeenCalledTimes(1);
	});

	it('allows the same code in unrestricted mode', async () => {
		mockedRun.mockResolvedValue(phpOk('{"shelled":true}'));
		const ctx = createStubContext({
			items: [{ json: {} }],
			parameters: {
				phpCode: "<?php echo json_encode(['shelled' => true]);",
				options: { securityLevel: 'unrestricted' },
			},
		});

		await expect(new PhpExecute().execute.call(ctx)).resolves.not.toThrow();
	});

	it('maps memory exhaustion to a readable error honoring continueOnFail', async () => {
		mockedRun.mockResolvedValue({
			stdout:
				'{"__php_fatal_error":true,"message":"Allowed memory size of 134217728 bytes exhausted","file":"","line":1}\n',
			stderr: `${METRICS_MARKER}{"peakMemoryUsageMb":128,"exitCode":255}\n`,
			exitCode: 255,
			metrics: { peakMemoryUsageMb: 128 },
		});
		const failingCtx = createStubContext({
			items: [{ json: {} }],
			parameters: { phpCode: DEFAULT_CODE, options: { memoryLimit: 128 } },
		});

		await expect(new PhpExecute().execute.call(failingCtx)).rejects.toThrow(
			/memory limit of 128 MB/,
		);

		const resilientCtx = createStubContext({
			items: [{ json: {} }],
			parameters: { phpCode: DEFAULT_CODE, options: { memoryLimit: 128 } },
			continueOnFail: true,
		});
		const result = await new PhpExecute().execute.call(resilientCtx);

		expect(result[0][0].json.error).toMatch(/memory limit of 128 MB/);
		expect(result[0][0].json._phpMetrics).toMatchObject({ peakMemoryUsageMb: 128 });
		expect(result[0][0].pairedItem).toEqual({ item: 0 });
	});

	it('reports non-zero exits with stderr details through NodeOperationError', async () => {
		mockedRun.mockResolvedValue({
			stdout: '',
			stderr: 'PHP Notice:  oops\n',
			exitCode: 255,
			metrics: null,
		});
		const ctx = createStubContext({
			items: [{ json: {} }],
			parameters: { phpCode: DEFAULT_CODE, options: {} },
		});

		await expect(new PhpExecute().execute.call(ctx)).rejects.toThrow(
			/PHP exited with code 255/,
		);
	});

	it('rejects invalid option values with a readable message instead of silent defaults', async () => {
		const ctx = createStubContext({
			items: [{ json: {} }],
			parameters: {
				phpCode: DEFAULT_CODE,
				options: { timeout: 'not-a-number' },
			},
		});

		await expect(new PhpExecute().execute.call(ctx)).rejects.toThrow(
			/Invalid PHP Execute options.*timeout/s,
		);
		expect(mockedRun).not.toHaveBeenCalled();
	});
});
