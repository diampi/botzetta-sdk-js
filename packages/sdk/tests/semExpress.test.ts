// CA3: importar a raiz (ESM e CJS) do pacote GERADO não carrega o express. Roda num processo
// separado em que resolver "express" falha, como numa instalação sem ele. Requer o build (dist/).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pacote = fileURLToPath(new URL("..", import.meta.url));
const bloqueio = fileURLToPath(new URL("./fixtures/sem-express.cjs", import.meta.url));
const temDist = existsSync(`${pacote}/dist/index.js`) && existsSync(`${pacote}/dist/index.cjs`);

/** Roda `codigo` com o express bloqueado; devolve stdout ou lança com stderr. */
const rodar = (codigo: string, tipo: "module" | "commonjs") =>
  execFileSync(process.execPath, ["--require", bloqueio, `--input-type=${tipo}`, "-e", codigo], { cwd: pacote, encoding: "utf8", stdio: "pipe" });

describe.skipIf(!temDist)("raiz sem express instalado (dist)", () => {
  it("import da raiz (ESM) funciona", () => {
    expect(rodar('const m = await import("./dist/index.js"); console.log(typeof m.verificarWebhook)', "module").trim()).toBe("function");
  });

  it("require da raiz (CJS) funciona", () => {
    expect(rodar('console.log(typeof require("./dist/index.cjs").criarCliente)', "commonjs").trim()).toBe("function");
  });

  it("o bloqueio funciona: import e require do express falham", () => {
    expect(() => rodar('await import("express")', "module")).toThrow(/express bloqueado/);
    expect(() => rodar('require("express")', "commonjs")).toThrow(/express bloqueado/);
  });
});

it.runIf(!temDist && process.env.CI)("o CI roda o build antes dos testes", () => {
  throw new Error("dist/ ausente: rode npm run build antes de npm test");
});
