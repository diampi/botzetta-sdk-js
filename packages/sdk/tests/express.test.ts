// CA3 (parte Express): @botzetta/sdk/express funciona com o express 5.
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AppError, limparCacheSessao, NucleoErro } from "../src";
import { autenticarUsuario, contextoUsuario, servirJwks, tratarErros } from "../src/express";
import { criarNucleoFalso, type NucleoFalso } from "./nucleoFalso";
import { chaveTeste } from "./chaveTeste";

let nucleo: NucleoFalso;
let app: express.Express;

beforeAll(async () => {
  nucleo = await criarNucleoFalso();
  app = express();
  app.use(express.json());
  app.get("/.well-known/jwks.json", servirJwks(chaveTeste));
  const api = express.Router();
  api.get("/eu", (req, res) => {
    res.json({ contexto: contextoUsuario(req) });
  });
  api.post("/itens", (_req, res) => {
    res.status(201).json({ ok: true });
  });
  api.get("/falha", () => {
    throw new AppError("ERR_TESTE", "Falhou.", 422);
  });
  api.get("/falha-api", () => {
    throw new NucleoErro("ERR_INDISPONIVEL", "x", 503);
  });
  api.get("/falha-validacao", () => {
    throw Object.assign(new Error("x"), { name: "ZodError", issues: [{ path: ["nome"], message: "obrigatório" }] });
  });
  api.get("/falha-inesperada", () => {
    throw new Error("segredo interno");
  });
  app.use("/api", autenticarUsuario({ slug: "exemplo", jwksUrl: nucleo.jwksUrl }), api);
  app.get("/sem-auth", (req, res) => {
    res.json({ contexto: contextoUsuario(req) });
  });
  app.use(tratarErros());
});

afterAll(() => nucleo.fechar());
afterEach(() => {
  nucleo.limpar();
  limparCacheSessao();
});

const tokenUsuario = (extra: Partial<Parameters<NucleoFalso["emitirTokenUsuario"]>[0]> = {}) =>
  nucleo.emitirTokenUsuario({ slug: "exemplo", companyId: 7, userId: 3, acessos: ["exemplo.itens.view"], ...extra });
const comToken = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("autenticarUsuario", () => {
  it("401 sem token, com token de outra chave, de outro app ou de outro tipo", async () => {
    const r = await request(app).get("/api/eu");
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: "ERR_TOKEN_INVALIDO", message: expect.any(String) });
    for (const t of [
      await nucleo.emitirTokenInvalido({ slug: "exemplo", companyId: 7, userId: 3 }),
      await nucleo.emitirTokenUsuario({ slug: "outro", companyId: 7, userId: 3 }),
      await nucleo.emitirTokenDeOutroTipo({ slug: "exemplo", companyId: 7 })
    ])
      expect((await request(app).get("/api/eu").set(comToken(t))).status).toBe(401);
  });

  it("preenche o contexto com a sessão do Botzetta", async () => {
    const r = await request(app).get("/api/eu").set(comToken(await tokenUsuario()));
    expect(r.status).toBe(200);
    expect(r.body.contexto).toMatchObject({ origem: "usuario", companyId: 7, userId: 3, acessos: ["exemplo.itens.view"], nivel: "nenhum", requestId: expect.any(String) });
    const comId = await request(app).get("/api/eu").set(comToken(await tokenUsuario())).set("X-Request-Id", "abc-123");
    expect(comId.body.contexto.requestId).toBe("abc-123");
    const lixo = await request(app).get("/api/eu").set(comToken(await tokenUsuario())).set("X-Request-Id", "a b<script>");
    expect(lixo.body.contexto.requestId).not.toBe("a b<script>");
  });

  it("bloqueia escrita em paywall e total, libera leitura", async () => {
    const t = await tokenUsuario({ nivel: "paywall" });
    expect((await request(app).get("/api/eu").set(comToken(t))).status).toBe(200);
    const r = await request(app).post("/api/itens").set(comToken(t)).send({});
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("ERR_ASSINATURA_VENCIDA");
    const total = await request(app).post("/api/itens").set(comToken(await tokenUsuario({ userId: 4, nivel: "total" }))).send({});
    expect(total.body.error).toBe("ERR_ASSINATURA_BLOQUEADA");
  });

  it("sessão revogada → 401 ERR_TOKEN_REVOGADO; indisponível sem cache → 503", async () => {
    const t = await tokenUsuario({ userId: 42 });
    nucleo.revogarSessoes(7, 42);
    const r = await request(app).get("/api/eu").set(comToken(t));
    expect([r.status, r.body.error]).toEqual([401, "ERR_TOKEN_REVOGADO"]);
    nucleo.definirSessaoIndisponivel(true);
    const i = await request(app).get("/api/eu").set(comToken(await tokenUsuario({ userId: 43 })));
    expect([i.status, i.body.error]).toEqual([503, "ERR_NUCLEO_INDISPONIVEL"]);
  });

  it("acesso retirado vale depois que o cache vence", async () => {
    const t = await tokenUsuario({ userId: 41 });
    expect((await request(app).get("/api/eu").set(comToken(t))).body.contexto.acessos).toEqual(["exemplo.itens.view"]);
    nucleo.alterarSessao(7, 41, { acessos: [] });
    limparCacheSessao();
    expect((await request(app).get("/api/eu").set(comToken(t))).body.contexto.acessos).toEqual([]);
  });

  it("aceita só nucleoUrl (jwksUrl derivado)", async () => {
    const outro = express();
    outro.get("/eu", autenticarUsuario({ slug: "exemplo", nucleoUrl: nucleo.url }), (req, res) => {
      res.json(contextoUsuario(req));
    });
    outro.use(tratarErros());
    const r = await request(outro).get("/eu").set(comToken(await tokenUsuario()));
    expect([r.status, r.body.companyId]).toEqual([200, 7]);
  });
});

describe("contextoUsuario, servirJwks e tratarErros", () => {
  it("contextoUsuario sem autenticarUsuario → 401", async () => {
    expect((await request(app).get("/sem-auth")).status).toBe(401);
  });

  it("servirJwks publica só a chave pública", async () => {
    const r = await request(app).get("/.well-known/jwks.json");
    expect(r.status).toBe(200);
    expect(r.headers["cache-control"]).toBe("public, max-age=300");
    expect(r.body.keys[0]).toMatchObject({ kid: chaveTeste.kid });
    expect(r.body.keys[0]).not.toHaveProperty("d");
  });

  it("formata AppError, NucleoErro 5xx (502), validação e erro inesperado sem vazar a mensagem", async () => {
    const t = comToken(await tokenUsuario());
    expect((await request(app).get("/api/falha").set(t)).body).toEqual({ error: "ERR_TESTE", message: "Falhou." });
    expect((await request(app).get("/api/falha-api").set(t)).status).toBe(502);
    const v = await request(app).get("/api/falha-validacao").set(t);
    expect([v.status, v.body]).toEqual([400, { error: "ERR_VALIDACAO", message: "nome: obrigatório" }]);
    const x = await request(app).get("/api/falha-inesperada").set(t);
    expect([x.status, x.body]).toEqual([500, { error: "ERR_INTERNO", message: "Erro interno." }]);
  });

  it("JSON inválido → 400", async () => {
    const r = await request(app).post("/api/itens").set(comToken(await tokenUsuario())).set("Content-Type", "application/json").send("{x");
    expect([r.status, r.body.error]).toEqual([400, "ERR_VALIDACAO"]);
  });
});
