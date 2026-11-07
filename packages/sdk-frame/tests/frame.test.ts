import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErroFrame, iniciarFrame, PROTOCOLO, type ContextoFrame } from "../src";

const HOST = "https://app.botzetta.com.br";

const contexto = (extra: Partial<ContextoFrame> = {}): ContextoFrame => ({
  protocolo: PROTOCOLO,
  token: "tok-1",
  expiraEm: new Date(Date.now() + 10 * 60_000).toISOString(),
  app: { slug: "notafacil", versao: "1.0.0" },
  empresa: { id: 3, nome: "Empresa 3" },
  usuario: { id: 7, nome: "Ana" },
  tema: "escuro",
  rota: "notas",
  ...extra
});

let pai: Window;
let enviados: { msg: any; origem: string }[];

beforeEach(() => {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  pai = iframe.contentWindow as Window;
  enviados = [];
  vi.spyOn(pai, "postMessage").mockImplementation(((msg: unknown, origem: string) => {
    enviados.push({ msg, origem });
  }) as typeof pai.postMessage);
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

/** Simula uma mensagem chegando na página. */
const chegar = (data: unknown, origin = HOST, source: Window | null = pai) =>
  window.dispatchEvent(new MessageEvent("message", { data, origin, source }));

const envelope = (tipo: string, dados?: unknown, id?: string) => ({ botzetta: PROTOCOLO, tipo, dados, id });

async function conectar(ctx = contexto()) {
  const p = iniciarFrame({ origensHost: [HOST, "https://outro.botzetta.com.br/"] }, { janela: window, pai });
  chegar(envelope("contexto", ctx));
  return p;
}

/** Responde ao último pedido enviado. */
const responder = (dados: unknown) => {
  const pedido = enviados.filter(e => e.msg.tipo === "pedido").at(-1)!;
  chegar(envelope("resposta", dados, pedido.msg.id));
  return pedido.msg;
};

describe("iniciarFrame", () => {
  it("exige origensHost e estar dentro de um iframe", async () => {
    expect(() => iniciarFrame({ origensHost: [] }, { janela: window, pai })).toThrow(ErroFrame);
    expect(() => iniciarFrame({ origensHost: ["não é url"] }, { janela: window, pai })).toThrow(/origem inválida/);
    await expect(iniciarFrame({ origensHost: [HOST] }, { janela: window, pai: window })).rejects.toMatchObject({ codigo: "ERR_FRAME_FORA_DO_HOST" });
  });

  it("envia pronto a cada origem permitida, com targetOrigin exato (nunca *)", async () => {
    await conectar();
    const prontos = enviados.filter(e => e.msg.tipo === "pronto");
    expect(prontos.map(e => e.origem)).toEqual([HOST, "https://outro.botzetta.com.br"]);
    expect(prontos[0]!.msg).toMatchObject({ botzetta: PROTOCOLO, dados: { versaoSdk: expect.any(String) } });
  });

  it("CA1: obterContexto devolve o token usuario e o contexto do host; o tema é aplicado antes de resolver", async () => {
    const cliente = await conectar();
    expect(cliente.obterContexto()).toMatchObject({ token: "tok-1", empresa: { id: 3 }, usuario: { id: 7 }, rota: "notas" });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("CA2: ignora contexto de origem fora de origensHost, de outra janela ou fora do envelope", async () => {
    vi.useFakeTimers();
    const p = iniciarFrame({ origensHost: [HOST], timeoutMs: 1000 }, { janela: window, pai });
    chegar(envelope("contexto", contexto()), "https://evil.example");
    chegar(envelope("contexto", contexto()), "https://app.botzetta.com.br.evil.example");
    chegar(envelope("contexto", contexto()), HOST, window); // outra janela
    chegar({ tipo: "contexto", dados: contexto() }); // sem envelope
    chegar({ ...envelope("contexto", contexto()), botzetta: "frame/0" });
    const resultado = p.catch(e => e);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await resultado).toMatchObject({ codigo: "ERR_FRAME_TIMEOUT" });
  });

  it("CA2: depois do handshake, só a origem que respondeu é aceita", async () => {
    const cliente = await conectar();
    const pedido = cliente.toast("oi");
    const id = enviados.at(-1)!.msg.id;
    chegar(envelope("resposta", { ok: false, erro: { codigo: "ERR_FRAME_LIMITE" } }, id), "https://outro.botzetta.com.br");
    chegar(envelope("resposta", { ok: true }, id));
    await expect(pedido).resolves.toBeUndefined();
  });

  it("recusa host com protocolo diferente de frame/1", async () => {
    const p = iniciarFrame({ origensHost: [HOST] }, { janela: window, pai });
    chegar(envelope("contexto", { ...contexto(), protocolo: "frame/2" }));
    await expect(p).rejects.toMatchObject({ codigo: "ERR_FRAME_PROTOCOLO" });
  });
});

describe("pedidos", () => {
  it("navegar, abrirPessoa, toast, informarRota, redimensionar e fechar viram pedidos para a origem do host", async () => {
    const cliente = await conectar();
    const casos: [() => Promise<unknown>, string, unknown][] = [
      [() => cliente.navegar("/pessoas/1"), "navegar", { caminho: "/pessoas/1" }],
      [() => cliente.abrirPessoa(42), "abrirPessoa", { id: 42 }],
      [() => cliente.toast("Nota emitida", "sucesso"), "toast", { mensagem: "Nota emitida", tipo: "sucesso" }],
      [() => cliente.informarRota("notas/2"), "informarRota", { caminho: "notas/2" }],
      [() => cliente.redimensionar(300), "redimensionar", { altura: 300 }],
      [() => cliente.fechar(), "fechar", undefined]
    ];
    for (const [chamar, metodo, args] of casos) {
      const promessa = chamar();
      const msg = responder({ ok: true });
      expect(msg.dados).toEqual({ metodo, args });
      await promessa;
    }
    expect(enviados.filter(e => e.msg.tipo === "pedido").every(e => e.origem === HOST)).toBe(true);
  });

  it("CA7: confirmar devolve o boolean do host; erro do host vira ErroFrame com o código", async () => {
    const cliente = await conectar();
    const sim = cliente.confirmar({ titulo: "Cancelar nota?", mensagem: "A nota 123 será cancelada." });
    responder({ ok: true, valor: true });
    await expect(sim).resolves.toBe(true);
    const nao = cliente.confirmar({ titulo: "x", mensagem: "y" });
    responder({ ok: true, valor: false });
    await expect(nao).resolves.toBe(false);
    const ruim = cliente.navegar("//evil.com");
    responder({ ok: false, erro: { codigo: "ERR_FRAME_PARAMETRO", mensagem: "caminho inválido" } });
    await expect(ruim).rejects.toMatchObject({ codigo: "ERR_FRAME_PARAMETRO", message: "caminho inválido" });
  });

  it("pedido sem resposta em 30 s é rejeitado (confirmar espera o usuário)", async () => {
    const cliente = await conectar();
    vi.useFakeTimers();
    const t = cliente.toast("x").catch(e => e);
    let confirmou = false;
    void cliente.confirmar({ titulo: "a", mensagem: "b" }).then(() => (confirmou = true));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await t).toMatchObject({ codigo: "ERR_FRAME_TIMEOUT" });
    expect(confirmou).toBe(false);
  });

  it("encerrar rejeita os pendentes e ignora novas mensagens", async () => {
    const cliente = await conectar();
    const t = cliente.toast("x");
    cliente.encerrar();
    await expect(t).rejects.toMatchObject({ codigo: "ERR_FRAME_ENCERRADO" });
    await expect(cliente.toast("y")).rejects.toMatchObject({ codigo: "ERR_FRAME_ENCERRADO" });
  });
});

describe("eventos", () => {
  it("CA8: evento token atualiza o contexto; obterToken pede ao host quando está para vencer", async () => {
    const cliente = await conectar(contexto({ expiraEm: new Date(Date.now() + 10_000).toISOString() }));
    const renovados: string[] = [];
    cliente.aoRenovarToken(t => renovados.push(t));
    const token = cliente.obterToken();
    const msg = responder({ ok: true, valor: { token: "tok-2", expiraEm: new Date(Date.now() + 600_000).toISOString() } });
    expect(msg.dados.metodo).toBe("token");
    await expect(token).resolves.toBe("tok-2");
    chegar(envelope("evento", { nome: "token", valor: { token: "tok-3", expiraEm: new Date(Date.now() + 600_000).toISOString() } }));
    await expect(cliente.obterToken()).resolves.toBe("tok-3");
    expect(renovados).toEqual(["tok-2", "tok-3"]);
  });

  it("CA11: evento tema aplica/remove .dark e avisa os ouvintes; evento de outra origem é ignorado", async () => {
    const cliente = await conectar(contexto({ tema: "claro" }));
    const temas: string[] = [];
    const cancelar = cliente.aoMudarTema(t => temas.push(t));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    chegar(envelope("evento", { nome: "tema", valor: "escuro" }), "https://evil.example");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    chegar(envelope("evento", { nome: "tema", valor: "escuro" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    cancelar();
    chegar(envelope("evento", { nome: "tema", valor: "claro" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(temas).toEqual(["escuro"]);
    expect(cliente.obterContexto().tema).toBe("claro");
  });
});
