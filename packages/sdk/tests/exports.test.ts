// CA4: a superfície pública é exatamente esta lista, e o pacote não manda cabeçalho próprio
// X-Botzetta-* nem pede token por client_credentials (só o fluxo de instalação).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as raiz from "../src";
import * as catalogos from "../src/catalogos";
import * as rotasExpress from "../src/express";

const RAIZ_EXPORTS = [
  "ASSERTION_TTL_MAX_SEGUNDOS",
  "AppError",
  "CABECALHO_ASSINATURA",
  "CABECALHO_ENTREGA",
  "CABECALHO_EVENTO",
  "CATALOGO_ESCOPOS",
  "CATALOGO_EVENTOS",
  "ERROS_ASSINATURA",
  "ESCOPOS",
  "EVENTOS",
  "EVENTOS_APP",
  "EVENTO_TESTE_WEBHOOK",
  "NucleoErro",
  "PLATAFORMA_ISS",
  "PREFIXO_API",
  "TIPO_CLIENT_ASSERTION",
  "TOLERANCIA_WEBHOOK_SEGUNDOS",
  "TYP_ASSINATURA_WEBHOOK",
  "camposAssertion",
  "criarChaveApp",
  "criarCliente",
  "criarClienteBase",
  "criarVerificadorUsuario",
  "escritaBloqueada",
  "gerarChaveApp",
  "gerarPkce",
  "gerarState",
  "hashCorpoWebhook",
  "limparCacheSessao",
  "montarUrlInstalacao",
  "renovarToken",
  "revogarToken",
  "servirJwks",
  "tokenDoCabecalho",
  "trocarCodigo",
  "urlTokenEndpoint",
  "verificarUsuario",
  "verificarWebhook"
];

const EXPRESS_EXPORTS = ["autenticarUsuario", "contextoUsuario", "servirJwks", "tratarErros"];

/** Nada disto pode aparecer no código ou no pacote gerado. */
const PROIBIDOS = [/x-botzetta-/i, /client_credentials/];

const arquivos = (pasta: string): string[] => {
  try {
    return readdirSync(pasta).flatMap(n => {
      const p = join(pasta, n);
      return statSync(p).isDirectory() ? arquivos(p) : [p];
    });
  } catch {
    return [];
  }
};

describe("superfície pública", () => {
  it("raiz exporta exatamente a lista documentada", () => {
    expect(Object.keys(raiz).sort()).toEqual([...RAIZ_EXPORTS].sort());
  });

  it("/express exporta exatamente os middlewares documentados", () => {
    expect(Object.keys(rotasExpress).sort()).toEqual(EXPRESS_EXPORTS);
  });

  it("/catalogos é um subconjunto da raiz", () => {
    for (const nome of Object.keys(catalogos)) expect(RAIZ_EXPORTS).toContain(nome);
  });

  it("src e dist não mandam cabeçalho X-Botzetta-* nem usam client_credentials", () => {
    const pacote = fileURLToPath(new URL("..", import.meta.url));
    const alvos = [...arquivos(join(pacote, "src")), ...arquivos(join(pacote, "dist"))].filter(a => /\.(ts|js|cjs|cts|map)$/.test(a));
    expect(alvos.length).toBeGreaterThan(5);
    const achados = alvos.flatMap(a => {
      const texto = readFileSync(a, "utf8");
      return PROIBIDOS.filter(re => re.test(texto)).map(re => `${a}: ${re}`);
    });
    expect(achados).toEqual([]);
  });
});
