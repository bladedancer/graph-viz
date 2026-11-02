import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
    { ignores: ['client/dist', 'client/src/ds', 'node_modules', '.playwright-mcp'] },
    js.configs.recommended,
    {
        rules: {
            // Component names used only in JSX count as used.
            'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z]', argsIgnorePattern: '^_' }],
        },
    },
    {
        files: ['server/**/*.js', 'scripts/**/*.mjs', '*.js'],
        languageOptions: { globals: globals.node },
    },
    {
        files: ['client/src/**/*.{js,jsx}'],
        languageOptions: { globals: globals.browser, parserOptions: { ecmaFeatures: { jsx: true } } },
        ...reactHooks.configs.flat.recommended,
    },
    {
        // Pure client modules are unit-tested under Node.
        files: ['client/src/**/*.test.js'],
        languageOptions: { globals: globals.node },
    },
];
