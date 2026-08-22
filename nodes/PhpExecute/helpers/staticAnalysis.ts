import { PhpSafeModeViolationError } from './errors';

interface StaticPattern {
	label: string;
	regex: RegExp;
}

const CALL = '(?<![\\w$>:])';

const STATIC_PATTERNS: StaticPattern[] = [
	{
		label: 'backtick shell operator',
		regex: /`/,
	},
	{
		label: 'shell execution function (exec)',
		regex: new RegExp(`${CALL}exec\\s*\\(`, 'i'),
	},
	{
		label: 'shell execution function (shell_exec)',
		regex: new RegExp(`${CALL}shell_exec\\s*\\(`, 'i'),
	},
	{
		label: 'shell execution function (system)',
		regex: new RegExp(`${CALL}system\\s*\\(`, 'i'),
	},
	{
		label: 'shell execution function (passthru)',
		regex: new RegExp(`${CALL}passthru\\s*\\(`, 'i'),
	},
	{
		label: 'process handle function (popen)',
		regex: new RegExp(`${CALL}popen\\s*\\(`, 'i'),
	},
	{
		label: 'process control function (proc_open)',
		regex: new RegExp(`${CALL}proc_open\\s*\\(`, 'i'),
	},
	{
		label: 'process control function (pcntl_exec)',
		regex: new RegExp(`${CALL}pcntl_exec\\s*\\(`, 'i'),
	},
	{
		label: 'dynamic extension loader (dl)',
		regex: new RegExp(`${CALL}dl\\s*\\(`, 'i'),
	},
	{
		label: 'environment manipulation (putenv)',
		regex: new RegExp(`${CALL}putenv\\s*\\(`, 'i'),
	},
	{
		label: 'signal function (posix_kill)',
		regex: new RegExp(`${CALL}posix_kill\\s*\\(`, 'i'),
	},
	{
		label: 'priority function (proc_nice)',
		regex: new RegExp(`${CALL}proc_nice\\s*\\(`, 'i'),
	},
	{
		label: 'remote code fetch via file_get_contents',
		regex: /\bfile_get_contents\s*\(\s*['"](?:https?|ftp|php|data|expect|phar|zlib):\/\//i,
	},
	{
		label: 'remote code fetch via fopen',
		regex: /\bfopen\s*\(\s*['"](?:https?|ftp|php|data|expect|phar|zlib):\/\//i,
	},
	{
		label: 'remote include',
		regex:
			/\b(?:include|include_once|require|require_once)\s*\(?\s*['"](?:https?|ftp|data|expect|phar):\/\//i,
	},
	{
		label: 'network socket function (fsockopen)',
		regex: new RegExp(`${CALL}fsockopen\\s*\\(`, 'i'),
	},
];

export const RESTRICTED_PATTERN_LABELS = STATIC_PATTERNS.map((pattern) => pattern.label);

export function findRestrictedPatterns(code: string): string[] {
	const violations = new Set<string>();
	for (const { label, regex } of STATIC_PATTERNS) {
		if (regex.test(code)) violations.add(label);
	}
	return [...violations];
}

export function assertNoRestrictedPatterns(code: string): void {
	const violations = findRestrictedPatterns(code);
	if (violations.length > 0) {
		throw new PhpSafeModeViolationError(violations);
	}
}
