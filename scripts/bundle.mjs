import { build } from 'esbuild';

await build({
	entryPoints: ['dist/nodes/PhpExecute/PhpExecute.node.js'],
	outfile: 'dist/nodes/PhpExecute/PhpExecute.node.js',
	allowOverwrite: true,
	bundle: true,
	platform: 'node',
	target: 'node22',
	format: 'cjs',
	external: ['n8n-workflow'],
	sourcemap: true,
	minify: false,
	logLevel: 'info',
});
