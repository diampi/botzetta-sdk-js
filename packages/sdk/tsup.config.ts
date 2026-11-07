import { defineConfig, type Options } from "tsup";

// ESM + CJS para Node 22+. `splitting` também no CJS: a raiz e o "/express" compartilham o mesmo
// código (AppError/NucleoErro são a mesma classe nos dois, e o `instanceof` do tratarErros funciona).
// Sourcemap só no ESM: com splitting, o mapa do CJS sai com o caminho absoluto da máquina do build.
// A pasta dist/ é limpa pelo script "build" (as duas configurações rodam em paralelo).
const base: Options = {
  entry: { index: "src/index.ts", "express/index": "src/express/index.ts", catalogos: "src/catalogos.ts" },
  dts: true,
  splitting: true,
  target: "node22",
  external: ["express"]
};

export default defineConfig([
  { ...base, format: ["esm"], sourcemap: true },
  { ...base, format: ["cjs"], sourcemap: false }
]);
