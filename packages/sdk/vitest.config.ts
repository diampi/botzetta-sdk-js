import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Os exemplos importam o pacote pelo nome: nos testes, o nome aponta para o código-fonte.
const src = (p: string) => fileURLToPath(new URL(`./src/${p}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@botzetta\/sdk\/express$/, replacement: src("express/index.ts") },
      { find: /^@botzetta\/sdk$/, replacement: src("index.ts") }
    ]
  },
  test: { environment: "node", include: ["tests/**/*.test.ts"] }
});
