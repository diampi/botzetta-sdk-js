// Endurecimentos pedidos na revisão de segurança da F2.
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  criarCliente,
  criarVerificadorUsuario,
  montarUrlInstalacao,
  NucleoErro,
  revogarToken,
  trocarCodigo,
  verificarWebhook,
  type ArmazenamentoTokens
} from "../src";
import { tratarErros } from "../src/express";
import { criarNucleoFalso, type NucleoFalso } from "./nucleoFalso";
import { chaveTeste } from "./chaveTeste";

let nucleo: NucleoFalso;
beforeAll(async () => {
  nucleo = await criarNucleoFalso();
});
afterAll(() => nucleo.fechar());

const semTokens: ArmazenamentoTokens = { obter: async () => null, salvar: async () => undefined };

describe("https obrigatório (http só para localhost)", () => {
  it("recusa URLs http fora do localhost", async () => {
    expect(() => criarVerificadorUsuario({ slug: "a", nucleoUrl: "http://api.exemplo.com" })).toThrow(/https/);
    expect(() => criarVerificadorUsuario({ slug: "a", jwksUrl: "http://api.exemplo.com/plataforma/v1/.well-known/jwks.json" })).toThrow(/https/);
    expect(() => criarCliente({ url: "http://api.exemplo.com", clientId: "a", chave: chaveTeste, tokensInstalacao: semTokens })).toThrow(/https/);
    expect(() => montarUrlInstalacao({ urlHost: "http://app.exemplo.com", clientId: "a", redirectUri: "https://x/cb", state: "s", codeChallenge: "c" })).toThrow(/https/);
    await expect(trocarCodigo({ url: "http://api.exemplo.com", clientId: "a", chave: chaveTeste }, { code: "c", redirectUri: "r", codeVerifier: "v" })).rejects.toThrow(/https/);
    await expect(verificarWebhook({ corpo: "{}", assinatura: "a.b.c", slug: "a", jwksUrl: "http://api.exemplo.com/jwks.json" })).rejects.toThrow(/https/);
  });

  it("aceita https e http local", () => {
    expect(() => criarVerificadorUsuario({ slug: "a", nucleoUrl: "https://api.exemplo.com" })).not.toThrow();
    expect(() => criarVerificadorUsuario({ slug: "a", nucleoUrl: "http://localhost:8080" })).not.toThrow();
    expect(() => criarCliente({ url: "http://127.0.0.1:8080", clientId: "a", chave: chaveTeste, tokensInstalacao: semTokens })).not.toThrow();
  });
});

describe("webhook", () => {
  it("recusa corpo já interpretado (objeto) com 401, sem TypeError", async () => {
    await expect(verificarWebhook({ corpo: { id: 1 } as never, assinatura: "a.b.c", slug: "a", jwksUrl: nucleo.jwksUrl })).rejects.toMatchObject({
      codigo: "ERR_WEBHOOK_ASSINATURA_INVALIDA",
      status: 401
    });
  });
});

describe("tokens de instalação", () => {
  it("recusa par guardado de outra empresa", async () => {
    const arm: ArmazenamentoTokens = {
      obter: async () => ({ accessToken: "a", refreshToken: "r", expiraEm: new Date(Date.now() + 3_600_000), escopos: [], companyId: 8, instalacaoId: 1 }),
      salvar: async () => undefined
    };
    const c = criarCliente({ url: nucleo.url, clientId: "c", chave: chaveTeste, tokensInstalacao: arm });
    await expect(c.empresa(7).filas.listar()).rejects.toMatchObject({ codigo: "ERR_OAUTH_EMPRESA_DIVERGENTE", final: true });
  });

  it("recusa resposta de token sem companyId inteiro", async () => {
    nucleo.quando("POST", "/oauth/token", () => ({ access_token: "a", refresh_token: "r", expires_in: 60, companyId: "7", instalacaoId: 1 }));
    await expect(trocarCodigo({ url: nucleo.url, clientId: "c", chave: chaveTeste }, { code: "c", redirectUri: "r", codeVerifier: "v" })).rejects.toBeInstanceOf(NucleoErro);
  });

  it("revogarToken informa se o Botzetta aceitou", async () => {
    nucleo.quando("POST", "/oauth/revogar", () => ({ status: 200, corpo: {} }));
    expect(await revogarToken({ url: nucleo.url, clientId: "c", chave: chaveTeste }, "r")).toBe(true);
    expect(await revogarToken({ url: "http://127.0.0.1:1", clientId: "c", chave: chaveTeste, timeoutMs: 500 }, "r")).toBe(false);
  });
});

describe("tratarErros", () => {
  const app = express();
  app.get("/401", () => {
    throw new NucleoErro("ERR_TOKEN_INVALIDO", "detalhe do upstream", 401);
  });
  app.get("/404", () => {
    throw new NucleoErro("ERR_NAO_ENCONTRADO", "Recurso não encontrado.", 404);
  });
  app.post("/corpo", express.json({ limit: "10b" }), (_req, res) => {
    res.json({});
  });
  app.use(tratarErros());

  it("401 do token da instalação vira 502 genérico (não parece sessão expirada)", async () => {
    const r = await request(app).get("/401");
    expect([r.status, r.body]).toEqual([502, { error: "ERR_TOKEN_INVALIDO", message: expect.not.stringContaining("upstream") }]);
  });

  it("4xx de negócio é repassado", async () => {
    expect((await request(app).get("/404")).status).toBe(404);
  });

  it("corpo grande demais é 413, não 500", async () => {
    const r = await request(app).post("/corpo").set("Content-Type", "application/json").send(JSON.stringify({ texto: "x".repeat(100) }));
    expect([r.status, r.body.error]).toEqual([413, "ERR_CORPO_GRANDE"]);
  });
});
