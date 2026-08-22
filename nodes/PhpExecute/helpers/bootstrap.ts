import type { IDataObject } from 'n8n-workflow';

export const METRICS_MARKER = '__N8N_METRICS__';

const BOOTSTRAP = `<?php
if (!defined('N8N_PHP_EXECUTE')) {
define('N8N_PHP_EXECUTE', 1);
$__n8n_start = microtime(true);
register_shutdown_function(static function () use (&$__n8n_start) {
	$__err = error_get_last();
	if (is_array($__err) && in_array($__err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
		while (ob_get_level() > 0) { @ob_end_clean(); }
		fwrite(STDOUT, json_encode([
			'__php_fatal_error' => true,
			'message' => (string) $__err['message'],
			'file' => (string) $__err['file'],
			'line' => (int) $__err['line'],
		]) . "\\n");
	}
	fwrite(STDERR, '${METRICS_MARKER}' . json_encode([
		'phpVersion' => PHP_VERSION,
		'executionTimeMs' => round((microtime(true) - $__n8n_start) * 1000, 1),
		'peakMemoryUsageMb' => round(memory_get_peak_usage(true) / 1048576, 2),
	]) . "\\n");
});
unset($__n8n_start);
$__n8n_stream = @fopen('php://fd/3', 'rb');
if (is_resource($__n8n_stream)) {
	$__n8n_raw = (string) stream_get_contents($__n8n_stream);
	fclose($__n8n_stream);
} else {
	$__n8n_raw = '';
}
$n8nPayload = json_decode($__n8n_raw, true);
if (!is_array($n8nPayload)) { $n8nPayload = []; }
$n8nItems = isset($n8nPayload['items']) && is_array($n8nPayload['items']) ? $n8nPayload['items'] : [];
$n8nContext = isset($n8nPayload['context']) && is_array($n8nPayload['context']) ? $n8nPayload['context'] : [];
$n8nInput = isset($n8nItems[0]) && is_array($n8nItems[0]) ? $n8nItems[0] : [];
unset($__n8n_raw, $__n8n_stream, $n8nPayload);
}
?>`;

export function buildInjectedCode(userCode: string): string {
	return `${BOOTSTRAP}\n${userCode}`;
}

export interface PhpMetrics extends IDataObject {
	phpVersion?: string;
	executionTimeMs?: number;
	peakMemoryUsageMb?: number;
	exitCode?: number;
}

export function parseMetricsFromStderr(stderr: string): PhpMetrics | null {
	const lines = stderr.split('\n').filter((line) => line.startsWith(METRICS_MARKER));
	const last = lines[lines.length - 1];
	if (!last) return null;
	try {
		const parsed = JSON.parse(last.slice(METRICS_MARKER.length)) as unknown;
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
		return parsed as PhpMetrics;
	} catch {
		return null;
	}
}
