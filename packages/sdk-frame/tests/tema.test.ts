// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../tema.css", import.meta.url), "utf8");

const variaveis = (seletor: string) => {
  const bloco = css.match(new RegExp(`(^|\\n)${seletor.replace(".", "\\.")} \\{([^}]*)\\}`))?.[2] ?? "";
  return [...new Set([...bloco.matchAll(/(--[a-z0-9-]+):/g)].map(m => m[1]))].sort();
};

describe("tema.css", () => {
  it("claro (:root) e escuro (.dark) definem as mesmas variáveis do host", () => {
    const claro = variaveis(":root");
    expect(claro).toContain("--background");
    expect(claro).toContain("--primary");
    expect(claro.length).toBeGreaterThan(30);
    // --spacing e --tracking-normal só existem no :root do host (não mudam com o tema).
    expect(variaveis(".dark")).toEqual(claro.filter(v => v !== "--spacing" && v !== "--tracking-normal"));
  });

  it("cobre todos os tokens usados pelo mapeamento Tailwind do Botzetta (tests/fixtures/tailwind-tema.css)", () => {
    const mapa = readFileSync(new URL("./fixtures/tailwind-tema.css", import.meta.url), "utf8");
    const usados = new Set([...mapa.matchAll(/var\((--[a-z0-9-]+)\)/g)].map(m => m[1]));
    const definidos = new Set(variaveis(":root"));
    expect([...usados].filter(v => !definidos.has(v))).toEqual([]);
  });
});
