// ESLint (flat config) do monorepo.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", "**/.vite/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Nenhum arquivo acima de 800 linhas.
      "max-lines": ["error", { max: 800, skipBlankLines: false, skipComments: false }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }]
    }
  },
  { files: ["scripts/**/*.mjs", "**/*.config.{js,ts}", "exemplos/**/*.{mjs,ts}", "packages/sdk/**"], languageOptions: { globals: globals.node } },
  { files: ["**/*.cjs"], languageOptions: { globals: globals.node, sourceType: "commonjs" }, rules: { "@typescript-eslint/no-require-imports": "off" } },
  { files: ["packages/*/tests/**"], rules: { "@typescript-eslint/no-explicit-any": "off" } }
);
