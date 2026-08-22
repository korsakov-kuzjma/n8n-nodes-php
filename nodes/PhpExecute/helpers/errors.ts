export class PhpNodeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PhpNodeError';
	}
}

export class PhpBinaryNotFoundError extends PhpNodeError {
	constructor(binaryPath: string) {
		super(
			`PHP binary not found ("${binaryPath}"). Install the PHP CLI or adjust the PHP Binary Path option.`,
		);
		this.name = 'PhpBinaryNotFoundError';
	}
}

export class PhpTimeoutError extends PhpNodeError {
	constructor(timeoutMs: number) {
		super(`PHP execution timed out after ${timeoutMs / 1000} s and was terminated`);
		this.name = 'PhpTimeoutError';
	}
}

export class PhpMemoryLimitError extends PhpNodeError {
	constructor(memoryLimitMb: number) {
		super(
			`PHP exceeded the memory limit of ${memoryLimitMb} MB. Increase Memory Limit (MB) or optimize the script.`,
		);
		this.name = 'PhpMemoryLimitError';
	}
}

export class PhpSafeModeViolationError extends PhpNodeError {
	constructor(violations: string[]) {
		super(
			`Restricted security level blocked the script before execution. Forbidden patterns detected: ${violations.join(', ')}. Switch Security Level to Unrestricted if you trust this code.`,
		);
		this.name = 'PhpSafeModeViolationError';
	}
}

export class PhpFatalError extends PhpNodeError {
	constructor(
		message: string,
		readonly file: string,
		readonly line: number,
	) {
		super(`PHP fatal error: ${message} (${file}:${line})`);
		this.name = 'PhpFatalError';
	}
}

export class PhpProcessError extends PhpNodeError {
	constructor(
		message: string,
		readonly exitCode: number | null,
	) {
		super(message);
		this.name = 'PhpProcessError';
	}
}

export class OutputLimitExceededError extends PhpNodeError {
	constructor(maxBytes: number) {
		super(`Output exceeded maximum allowed size (${Math.round(maxBytes / (1024 * 1024))}MB)`);
		this.name = 'OutputLimitExceededError';
	}
}

export class PhpOutputParseError extends PhpNodeError {
	constructor(message: string) {
		super(message);
		this.name = 'PhpOutputParseError';
	}
}
