import tsParser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

const obsidianRules = obsidianmd.configs.recommended;

export default defineConfig([
	{
		ignores: ["node_modules/**", "main.js", "*.map", "app.js"],
	},
	{
		files: ["src/**/*.ts", "*.ts"],
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				project: "./tsconfig.json",
			},
			globals: {
				...globals.browser,
				...globals.node,
			},
		},
		plugins: {
			obsidianmd,
		},
		rules: obsidianRules,
	},
]);
