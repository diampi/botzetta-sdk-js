import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError, CATALOGO_EVENTOS, CABECALHO_ASSINATURA, EVENTOS_APP, verificarWebhook } from "../src";
import { criarNucleoFalso, type NucleoFalso } from "./nucleoFalso";
const corpo = JSON.stringify({
  id: "evt_1",
  evento: "pessoa.criada",
  versao: "1",
  companyId: 7,
  recurso: { tipo: "pessoa", id: 42 },
  ocorridoEm: "2026-10-27T12:00:00.000Z"
});

let nucleo: NucleoFalso;
beforeAll(async () => {
  nucleo = await criarNucleoFalso();
});
afterAll(() => nucleo.fechar());

const falha = async (p: Promise<unknown>): Promise<AppError> => {
  try {
    await p;
  } catch (e) {
    return e as AppError;
  }
  throw new Error("deveria ter falhado");
};

describe("verificarWebhook (JWS da Plataforma)", () => {
  const verificar = (assinatura: string | undefined, extra: Partial<Parameters<typeof verificarWebhook>[0]> = {}) =>
    verificarWebhook({ corpo, assinatura, slug: "notafacil", jwksUrl: nucleo.jwksUrl, ...extra });

  it("aceita a assinatura do núcleo e devolve o evento (string ou Buffer)", async () => {
    const assinatura = await nucleo.assinarWebhook({ corpo, slug: "notafacil", evento: "pessoa.criada" });
    expect((await verificar(assinatura)).recurso).toEqual({ tipo: "pessoa", id: 42 });
    expect((await verificar(assinatura, { corpo: Buffer.from(corpo) })).id).toBe("evt_1");
  });

  it("devolve entrega e jti da assinatura e confere o cabeçalho Botzetta-Entrega", async () => {
    const assinatura = await nucleo.assinarWebhook({ corpo, slug: "notafacil", entrega: "ent_1" });
    const ev = await verificar(assinatura, { entrega: "ent_1" });
    expect(ev).toMatchObject({ id: "evt_1", entrega: "ent_1", jti: expect.any(String) });
    expect((await falha(verificar(assinatura, { entrega: "ent_2" }))).codigo).toBe("ERR_WEBHOOK_ASSINATURA_INVALIDA");
  });

  it("recusa corpo adulterado (CA4)", async () => {
    const assinatura = await nucleo.assinarWebhook({ corpo, slug: "notafacil" });
    const e = await falha(verificar(assinatura, { corpo: corpo.replace('"id":42', '"id":43') }));
    expect(e.codigo).toBe("ERR_WEBHOOK_ASSINATURA_INVALIDA");
    expect(e.status).toBe(401);
  });

  it("recusa aud de outro app, chave fora do JWKS e token de outro tipo", async () => {
    const deOutro = await nucleo.assinarWebhook({ corpo, slug: "outroapp" });
    expect((await falha(verificar(deOutro))).codigo).toBe("ERR_WEBHOOK_ASSINATURA_INVALIDA");
    const forjada = await nucleo.assinarWebhook({ corpo, slug: "notafacil", outraChave: true });
    expect((await falha(verificar(forjada))).codigo).toBe("ERR_WEBHOOK_ASSINATURA_INVALIDA");
    // Token de outro tipo (mesmo aud app:<slug>, mesma chave) não vale como assinatura de webhook.
    const outroTipo = await nucleo.emitirTokenDeOutroTipo({ slug: "notafacil", companyId: 7 });
    expect((await falha(verificar(outroTipo))).codigo).toBe("ERR_WEBHOOK_ASSINATURA_INVALIDA");
  });

  it("recusa assinatura velha (iat > 5 min) ou do futuro", async () => {
    const agora = Math.floor(Date.now() / 1000);
    const velha = await nucleo.assinarWebhook({ corpo, slug: "notafacil", iat: agora - 400 });
    expect((await falha(verificar(velha))).codigo).toBe("ERR_WEBHOOK_ASSINATURA_INVALIDA");
    const futura = await nucleo.assinarWebhook({ corpo, slug: "notafacil", iat: agora + 120 });
    expect((await falha(verificar(futura))).codigo).toBe("ERR_WEBHOOK_ASSINATURA_INVALIDA");
  });

  it("recusa cabeçalho ausente ou lixo", async () => {
    for (const a of [undefined, "", "lixo", "a.b.c"]) expect((await falha(verificar(a))).codigo).toBe("ERR_WEBHOOK_ASSINATURA_INVALIDA");
  });
});

describe("receptor HTTP com verificarWebhook", () => {
  let servidor: http.Server;
  let url = "";
  beforeAll(async () => {
    servidor = http.createServer((req, res) => {
      const partes: Buffer[] = [];
      req.on("data", c => partes.push(c));
      req.on("end", () => {
        verificarWebhook({ corpo: Buffer.concat(partes), assinatura: req.headers[CABECALHO_ASSINATURA], slug: "notafacil", jwksUrl: nucleo.jwksUrl })
          .then(() => res.writeHead(200).end())
          .catch(() => res.writeHead(401).end());
      });
    });
    await new Promise<void>(r => servidor.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/webhook`;
  });
  afterAll(() => new Promise<void>(r => servidor.close(() => r())));

  const enviar = async (iat?: number) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Botzetta-Assinatura": await nucleo.assinarWebhook({ corpo, slug: "notafacil", iat }) },
      body: corpo
    });

  it("aceita a entrega assinada e recusa uma atrasada", async () => {
    expect((await enviar()).status).toBe(200);
    expect((await enviar(Math.floor(Date.now() / 1000) - 600)).status).toBe(401);
  });
});

describe("catálogo de eventos", () => {
  it("app.* sem escopo; domínio com escopo de leitura", () => {
    expect(EVENTOS_APP).toEqual(["app.instalado", "app.desinstalado", "app.escopos-alterados"]);
    for (const [evento, def] of Object.entries(CATALOGO_EVENTOS)) {
      if (evento.startsWith("app.")) expect(def.escopo).toBeNull();
      else expect(def.escopo).toMatch(/:ler$/);
    }
  });
});
