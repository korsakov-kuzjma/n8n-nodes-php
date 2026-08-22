import { chmod, mkdir, rename, stat, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { PhpNodeError } from './errors';
import type { ProcessIsolation } from './phpProcess';

export const SANDBOX_DIR = join(tmpdir(), 'n8n-php-sandbox');

export const NOBODY_UID = 65534;
export const NOBODY_GID = 65534;

export function resolveIsolation(restricted: boolean): ProcessIsolation {
	if (!restricted) return {};
	if (process.platform === 'win32') return {};
	if (typeof process.getuid !== 'function' || typeof process.getgid !== 'function') return {};
	if (process.getuid() !== 0) return {};
	return { uid: NOBODY_UID, gid: NOBODY_GID };
}

export function buildOpenBasedir(composerAutoloadPath: string | null): string {
	const parts = [SANDBOX_DIR];
	if (composerAutoloadPath) {
		parts.push(dirname(composerAutoloadPath));
	}
	return [...new Set(parts)].join(process.platform === 'win32' ? ';' : ':');
}

const FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function assertValidAdditionalFileName(name: string): void {
	if (!FILE_NAME_PATTERN.test(name)) {
		throw new PhpNodeError(
			`Invalid additional file name "${name}". Use letters, digits, dots, dashes and underscores only.`,
		);
	}
}

export async function prepareSandbox(
	additionalFiles: Array<{ name: string; content: string }>,
	needsWorldAccess: boolean,
): Promise<string> {
	await mkdir(SANDBOX_DIR, { recursive: true });
	if (needsWorldAccess) {
		const stats = await stat(SANDBOX_DIR);
		if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) {
			throw new PhpNodeError(
				`Sandbox directory ${SANDBOX_DIR} is owned by another user (uid ${stats.uid}). Remove it and rerun the workflow.`,
			);
		}
		await chmod(SANDBOX_DIR, 0o777).catch(() => {});
	}
	for (const file of additionalFiles) {
		assertValidAdditionalFileName(file.name);
		const target = join(SANDBOX_DIR, file.name);
		const tempTarget = join(
			SANDBOX_DIR,
			`${file.name}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
		);
		let failure: Error | undefined;
		try {
			await writeFile(tempTarget, file.content, { encoding: 'utf-8', flag: 'wx' });
			if (needsWorldAccess) {
				await chmod(tempTarget, 0o666).catch(() => {});
			}
			await rename(tempTarget, target);
		} catch (error) {
			failure = error as Error;
		}
		if (failure) {
			await unlink(tempTarget).catch(() => {});
			throw new PhpNodeError(
				`Failed to write additional file "${file.name}" into the sandbox: ${failure.message}`,
			);
		}
	}
	return SANDBOX_DIR;
}
