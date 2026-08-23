import { configWithoutCloudSupport } from '@n8n/node-cli/eslint';

export default [
	...configWithoutCloudSupport,
	{
		files: ['nodes/**/__tests__/**/*.ts'],
		rules: {
			'@n8n/community-nodes/no-dangerous-functions': 'off',
		},
	},
];
