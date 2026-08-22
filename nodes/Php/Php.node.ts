import {
    IExecuteFunctions,
    IDataObject,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    NodeOperationError,
} from 'n8n-workflow';
import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

export class Php implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'PHP Execute',
        name: 'phpExecute',
        icon: { light: 'file:../../icons/php.svg', dark: 'file:../../icons/php.svg' },
        group: ['transform'],
        version: 1,
        description: 'Выполняет произвольный PHP-код и возвращает результат',
        defaults: {
            name: 'PHP Execute',
        },
        inputs: ['main'],
        outputs: ['main'],
        properties: [
            {
                displayName: 'PHP Код',
                name: 'phpCode',
                type: 'string',
                typeOptions: {
                    rows: 10,
                    editor: 'codeNodeEditor',
                },
                default: '<?php\n// Ваш PHP код\n$data = ["status" => "success", "time" => time()];\necho json_encode($data);',
                description: 'Введите PHP-код. Используйте echo для возврата данных в n8n.',
            },
        ],
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const returnData: INodeExecutionData[] = [];

        for (let i = 0; i < items.length; i++) {
            try {
                // Получаем код, введенный пользователем
                const phpCode = this.getNodeParameter('phpCode', i) as string;

                // Генерируем безопасный путь к временному файлу
                const tempFilePath = join(tmpdir(), `n8n-php-${Date.now()}-${i}.php`);

                // Записываем код во временный файл
                await writeFile(tempFilePath, phpCode, 'utf-8');

                // Выполняем PHP через spawn (более безопасно и производительно, чем exec)
                const result = await new Promise<string>((resolve, reject) => {
                    const phpProcess = spawn('php', [tempFilePath]);
                    let stdout = '';
                    let stderr = '';

                    phpProcess.stdout.on('data', (data) => { stdout += data.toString(); });
                    phpProcess.stderr.on('data', (data) => { stderr += data.toString(); });

                    phpProcess.on('close', (code) => {
                        // Гарантированное удаление временного файла
                        unlink(tempFilePath).catch(() => { });

                        if (code !== 0) {
                            reject(new Error(`Ошибка выполнения PHP (код ${code}): ${stderr}`));
                        } else {
                            resolve(stdout);
                        }
                    });
                });

                // Попытка автоматического парсинга JSON
                let parsedResult: unknown;
                try {
                    parsedResult = JSON.parse(result.trim());
                } catch (e) {
                    // Если вывод не является JSON, возвращаем как строку в поле output
                    parsedResult = { output: result.trim() };
                }

                returnData.push({
                    json: parsedResult as IDataObject,
                    pairedItem: { item: i }, // Критически важно для корректной трассировки данных
                });
            } catch (error) {
                // Обработка ошибок в UI n8n
                if (this.continueOnFail()) {
                    returnData.push({
                        json: { error: (error as Error).message },
                        pairedItem: { item: i }
                    });
                    continue;
                }
                throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
            }
        }
        return [returnData];
    }
}