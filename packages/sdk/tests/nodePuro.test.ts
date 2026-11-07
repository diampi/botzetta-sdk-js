// CA2: um backend com node:http e só a raiz do pacote valida um webhook assinado e um token "usuario".
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { limparCacheSessao } from "../src";
import { criarNucleoFalso, type NucleoFalso } from "./nucleoFalso";
import { chaveTeste } from "./chaveTeste";
// @ts-expect-error exemplo em JavaScript puro, sem tipos
import { criarServidor } from "../../../exemplos/node-puro/servidor.mjs";

let nucleo: NucleoFalso;
let servidor: Server;
let base = "";
const eventos: { id: string }[] = [];

beforeAll(async () => {
  nucleo = await criarNucleoFalso();
  servidor = criarServidor({ slug: "meuapp", nucleoUrl: nucleo.url, chave: chaveTeste, aoEvento: (e: { id: string }) => eventos.push(e) });
  await new Promise<void>(r => servidor.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>(r => servidor.close(() => r()));
  await nucleo.fechar();
  limparCacheSessao();
});

const corpo = JSON.stringify({ id: "evt_1", evento: "pessoa.criada", versao: "1", companyId: 7, recurso: { tipo: "pessoa", id: 42 }, ocorridoEm: "2026-11-07T12:00:00.000Z" });
const webhook = async (c: string, assinatura: string) =>
  fetch(`${base}/botzetta/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "Botzetta-Assinatura": assinatura }, body: c });

describe("exemplo Node puro (sem Express)", () => {
  it("webhook assinado: 204 e entrega única; corpo adulterado ou assinatura de outro app: 401", async () => {
    const assinatura = await nucleo.assinarWebhook({ corpo, slug: "meuapp" });
    expect((await webhook(corpo, assinatura)).status).toBe(204);
    expect((await webhook(corpo, await nucleo.assinarWebhook({ corpo, slug: "meuapp" }))).status).toBe(204);
    expect(eventos.map(e => e.id)).toEqual(["evt_1"]);

    const adulterado = await webhook(corpo.replace('"id":42', '"id":43'), assinatura);
    expect(adulterado.status).toBe(401);
    expect(await adulterado.json()).toMatchObject({ error: "ERR_WEBHOOK_ASSINATURA_INVALIDA" });
    expect((await webhook(corpo, await nucleo.assinarWebhook({ corpo, slug: "outroapp" }))).status).toBe(401);
  });

  it("token usuario: 200 com a empresa do token; sem token, de outra chave ou de outro app: 401", async () => {
    const token = await nucleo.emitirTokenUsuario({ slug: "meuapp", companyId: 7, userId: 3, perfil: "admin" });
    const r = await fetch(`${base}/api/eu`, { headers: { Authorization: `Bearer ${token}` } });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ usuarioId: 3, companyId: 7, perfil: "admin" });

    const invalidos = [
      "",
      `Bearer ${await nucleo.emitirTokenInvalido({ slug: "meuapp", companyId: 7, userId: 3 })}`,
      `Bearer ${await nucleo.emitirTokenUsuario({ slug: "outroapp", companyId: 7, userId: 3 })}`,
      `Bearer ${await nucleo.emitirTokenDeOutroTipo({ slug: "meuapp", companyId: 7 })}`
    ];
    for (const auth of invalidos) {
      const x = await fetch(`${base}/api/eu`, { headers: auth ? { Authorization: auth } : {} });
      expect(x.status).toBe(401);
    }
  });

  it("publica só a chave pública do app", async () => {
    const r = await fetch(`${base}/.well-known/jwks.json`);
    expect(r.headers.get("cache-control")).toBe("public, max-age=300");
    const { keys } = (await r.json()) as { keys: Record<string, unknown>[] };
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ kid: chaveTeste.kid, use: "sig" });
    expect(keys[0]).not.toHaveProperty("d");
  });
});
