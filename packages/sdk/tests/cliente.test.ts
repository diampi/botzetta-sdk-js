import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CATALOGO_ESCOPOS, ESCOPOS, criarCliente, criarClienteBase, NucleoErro, type ArmazenamentoTokens, type ContextoChamada } from "../src";
import { criarNucleoFalso, type NucleoFalso } from "./nucleoFalso";
import { chaveTeste } from "./chaveTeste";

let nucleo: NucleoFalso;
beforeAll(async () => {
  nucleo = await criarNucleoFalso();
});
afterAll(() => nucleo.fechar());
beforeEach(() => nucleo.limpar());

/** Instalação válida por 1 h em qualquer empresa: o token leva a empresa no nome. */
const instalacoes: ArmazenamentoTokens = {
  obter: async companyId => ({
    accessToken: `acesso-empresa-${companyId}`,
    refreshToken: `refresh-${companyId}`,
    expiraEm: new Date(Date.now() + 3_600_000),
    escopos: [],
    companyId,
    instalacaoId: companyId
  }),
  salvar: async () => undefined
};
const cliente = () => criarCliente({ url: nucleo.url, clientId: "c", chave: chaveTeste, timeoutMs: 2000, tokensInstalacao: instalacoes });
const ultima = () => nucleo.chamadas.at(-1)!;
const contatoDeTeste = (id: number, parcial: Record<string, unknown> = {}) => ({ id, nome: `Contato ${id}`, numero: "5511999990000", grupo: false, pessoaId: null, optOut: false, fotoUrl: null, ...parcial });

describe("criarCliente", () => {
  it("envia o token da empresa e o X-Request-Id", async () => {
    nucleo.quando("GET", "/pessoas/:id", req => ({ id: Number(req.params.id), nome: "Ana" }));
    const p = await cliente().empresa(5, { requestId: "r1" }).pessoas.obter(10);
    expect(p).toEqual({ id: 10, nome: "Ana" });
    const ch = nucleo.chamadas.find(c => c.caminho === "/pessoas/10")!;
    expect(ch.headers.authorization).toBe("Bearer acesso-empresa-5");
    expect(ch.headers["x-request-id"]).toBe("r1");
    expect(Object.keys(ch.headers).filter(h => h.startsWith("x-botzetta"))).toEqual([]);
  });

  it("exige tokensInstalacao", () => {
    expect(() => criarCliente({ url: nucleo.url, clientId: "c", chave: chaveTeste } as never)).toThrow(/tokensInstalacao/);
  });

  it("recusa o par renovado de outra empresa sem salvá-lo", async () => {
    const salvos: unknown[] = [];
    nucleo.quando("POST", "/oauth/token", () => ({ access_token: "a2", refresh_token: "r2", expires_in: 3600, escopos: [], companyId: 99, instalacaoId: 1 }));
    const arm: ArmazenamentoTokens = {
      obter: async companyId => ({ accessToken: "a1", refreshToken: "r1", expiraEm: new Date(Date.now() + 1000), escopos: [], companyId, instalacaoId: 1 }),
      salvar: async (_c, t) => void salvos.push(t)
    };
    const c = criarCliente({ url: nucleo.url, clientId: "c", chave: chaveTeste, timeoutMs: 2000, tokensInstalacao: arm });
    await expect(c.empresa(7).filas.listar()).rejects.toMatchObject({ codigo: "ERR_OAUTH_EMPRESA_DIVERGENTE", status: 403, final: true });
    expect(salvos).toEqual([]);
  });

  it("monta consulta de listagem", async () => {
    nucleo.quando("GET", "/pessoas", () => ({ dados: [], pagina: 1, porPagina: 50, total: 0 }));
    await cliente().empresa(1).pessoas.listar({ ids: [1, 2], busca: "jo", pagina: 2 });
    expect(nucleo.chamadas[0]!.consulta).toEqual({ ids: "1,2", busca: "jo", pagina: "2" });
  });

  it("envia Idempotency-Key em mensagens", async () => {
    nucleo.quando("POST", "/mensagens", () => ({ status: 201, corpo: { whatsappMensagemId: "x", status: "enviada" } }));
    await cliente().empresa(1).mensagens.enviar({ whatsappId: 1, destino: { pessoaId: 2 }, conteudo: { texto: "oi" } }, { idempotencyKey: "k1" });
    expect(nucleo.chamadas[0]!.headers["idempotency-key"]).toBe("k1");
  });

  it("1.1: contatos, lista de usuários e envio para contato com ticket e assinatura", async () => {
    nucleo.quando("GET", "/contatos", () => ({ dados: [contatoDeTeste(7, { grupo: true })], pagina: 1, porPagina: 50, total: 1 }));
    nucleo.quando("GET", "/contatos/:id", req => contatoDeTeste(Number(req.params.id)));
    nucleo.quando("GET", "/usuarios", () => ({ dados: [{ id: 3, nome: "Ana", perfil: "user" }] }));
    nucleo.quando("POST", "/mensagens", () => ({ status: 201, corpo: { whatsappMensagemId: "x", status: "enviada", ticketId: 44 } }));
    const e = cliente().empresa(1);
    expect((await e.contatos.listar({ busca: "dir", porPagina: 50 })).dados[0]!.grupo).toBe(true);
    expect(nucleo.chamadas[0]!.consulta).toEqual({ busca: "dir", porPagina: "50" });
    expect((await e.contatos.obter(9)).id).toBe(9);
    expect((await e.usuarios.listar({ busca: "an" })).dados[0]!.nome).toBe("Ana");
    const r = await e.mensagens.enviar(
      { whatsappId: 1, destino: { contatoId: 9 }, conteudo: { texto: "oi" }, ticket: { abrir: true, filaId: 2, status: "closed" }, assinarComoUsuarioId: 3 },
      { idempotencyKey: "agendav1-1-0" }
    );
    expect(r.ticketId).toBe(44);
    expect(nucleo.chamadas.at(-1)!.corpo).toMatchObject({ destino: { contatoId: 9 }, ticket: { abrir: true }, assinarComoUsuarioId: 3 });
  });

  it("tenta de novo em 5xx quando repetível", async () => {
    let n = 0;
    nucleo.quando("GET", "/filas", () => (++n < 2 ? { status: 503, corpo: { error: "ERR_INTERNO", message: "x" } } : { dados: [] }));
    expect(await cliente().empresa(1).filas.listar()).toEqual({ dados: [] });
    expect(n).toBe(2);
  });

  it("não repete POST não idempotente e converte erro em NucleoErro", async () => {
    let n = 0;
    nucleo.quando("POST", "/realtime/eventos", () => {
      n++;
      return { status: 500, corpo: { error: "ERR_INTERNO", message: "falhou" } };
    });
    const e = await cliente().empresa(1).realtime.emitir("x", {}).catch(err => err);
    expect(e).toBeInstanceOf(NucleoErro);
    expect(e.codigo).toBe("ERR_INTERNO");
    expect(e.tentarDeNovo).toBe(true);
    expect(n).toBe(1);
  });

  it("repassa erro 4xx com código do núcleo", async () => {
    nucleo.quando("GET", "/pessoas/:id", () => ({ status: 404, corpo: { error: "ERR_NAO_ENCONTRADO", message: "Recurso não encontrado." } }));
    const e = await cliente().empresa(1).pessoas.obter(1).catch(err => err);
    expect(e).toMatchObject({ codigo: "ERR_NAO_ENCONTRADO", status: 404, tentarDeNovo: false });
  });

  it("assinatura vencida: erro final com assinaturaBloqueada", async () => {
    nucleo.quando("POST", "/mensagens", () => ({ status: 403, corpo: { error: "ERR_ASSINATURA_VENCIDA", message: "Assinatura vencida." } }));
    const e = await cliente()
      .empresa(1)
      .mensagens.enviar({ whatsappId: 1, destino: { pessoaId: 1 }, conteudo: { texto: "oi" } }, { idempotencyKey: "k" })
      .catch(err => err);
    expect(e).toBeInstanceOf(NucleoErro);
    expect(e).toMatchObject({ codigo: "ERR_ASSINATURA_VENCIDA", status: 403, final: true, assinaturaBloqueada: true });
  });
});

describe("escopos 1.6", () => {
  it("tem os 6 escopos novos com rótulo e risco (mensagens:ler é alto)", () => {
    for (const e of ["pessoas:escrever", "crm:ler", "crm:escrever", "tickets:ler", "tickets:escrever", "mensagens:ler"] as const) {
      expect(ESCOPOS).toContain(e);
      expect(CATALOGO_ESCOPOS[e].rotulo.length).toBeGreaterThan(3);
    }
    expect(CATALOGO_ESCOPOS["mensagens:ler"].risco).toBe("alto");
  });
});

describe("criarCliente: API 1.6", () => {
  it("pessoas: criar exige Idempotency-Key; atualizar/tags/campos/opt-out usam o método certo", async () => {
    nucleo.quando("POST", "/pessoas", () => ({ status: 201, corpo: { id: 1 } }));
    nucleo.quando("PATCH", "/pessoas/:id", req => ({ id: Number(req.params.id) }));
    nucleo.quando("PUT", "/pessoas/:id/tags", () => ({ tags: [] }));
    nucleo.quando("PUT", "/pessoas/:id/campos", () => ({ campos: [] }));
    nucleo.quando("POST", "/pessoas/:id/opt-out", req => ({ id: Number(req.params.id), optOut: true }));
    const p = cliente().empresa(3).pessoas;

    await p.criar({ natureza: "PF", nome: "Ana", contatos: [{ tipo: "whatsapp", valor: "5511999990000" }] }, { idempotencyKey: "lead-1" });
    expect(ultima().headers["idempotency-key"]).toBe("lead-1");
    expect(ultima().corpo).toMatchObject({ nome: "Ana", contatos: [{ tipo: "whatsapp" }] });

    await p.atualizar(1, { nome: "Ana B" });
    expect([ultima().metodo, ultima().caminho]).toEqual(["PATCH", "/pessoas/1"]);
    await p.definirTags(1, [4, 5]);
    expect(ultima().corpo).toEqual({ tags: [4, 5] });
    await p.salvarCampos(1, [{ campoId: 9, valor: "x" }]);
    expect(ultima().corpo).toEqual({ campos: [{ campoId: 9, valor: "x" }] });
    expect((await p.optOut(1)).optOut).toBe(true);
    expect(ultima().headers["idempotency-key"]).toBeUndefined();
  });

  it("crm: pipelines, oportunidades e ações de resultado", async () => {
    nucleo.quando("GET", "/pipelines", () => ({ dados: [] }));
    nucleo.quando("GET", "/oportunidades", () => ({ dados: [], pagina: 1, porPagina: 50, total: 0 }));
    nucleo.quando("POST", "/oportunidades", () => ({ status: 201, corpo: { id: 7 } }));
    nucleo.quando("POST", "/oportunidades/:id/perder", req => ({ id: Number(req.params.id), resultado: "perdida" }));
    nucleo.quando("POST", "/oportunidades/:id/mover", req => ({ id: Number(req.params.id) }));
    const crm = cliente().empresa(3).crm;

    await crm.pipelines.listar();
    await crm.oportunidades.listar({ pipelineId: 2, resultado: "aberta" });
    expect(ultima().consulta).toEqual({ pipelineId: "2", resultado: "aberta" });
    await crm.oportunidades.criar({ pessoaId: 1, pipelineId: 2, estagioId: 3, tipoId: 4, titulo: "Venda" }, { idempotencyKey: "op-1" });
    expect(ultima().headers["idempotency-key"]).toBe("op-1");
    await crm.oportunidades.mover(7, { estagioId: 5 });
    expect(ultima().corpo).toEqual({ estagioId: 5 });
    expect((await crm.oportunidades.perder(7, { motivoPerdaId: 2 })).resultado).toBe("perdida");
  });

  it("tickets: nota, transferir e fechar com Idempotency-Key", async () => {
    nucleo.quando("POST", "/tickets/:id/notas", () => ({ status: 201, corpo: { id: 1 } }));
    nucleo.quando("POST", "/tickets/:id/transferir", req => ({ id: Number(req.params.id) }));
    nucleo.quando("POST", "/tickets/:id/fechar", req => ({ status: 200, corpo: { id: Number(req.params.id), status: "closed" } }));
    const t = cliente().empresa(3).tickets;
    await t.anotar(8, "ligar amanhã", { idempotencyKey: "n1" });
    expect(ultima().corpo).toEqual({ texto: "ligar amanhã" });
    await t.transferir(8, { filaId: 2 }, { idempotencyKey: "t1" });
    expect(ultima().headers["idempotency-key"]).toBe("t1");
    expect((await t.fechar(8, {}, { idempotencyKey: "f1" })).status).toBe("closed");
  });

  it("histórico: repassa o cursor e o iterador segue até proximoCursor = null", async () => {
    nucleo.quando("GET", "/tickets/:id/mensagens", req => {
      const cursor = req.consulta.cursor;
      if (!cursor) return { dados: [{ id: 3 }, { id: 2 }], proximoCursor: "c1" };
      if (cursor === "c1") return { dados: [{ id: 1 }], proximoCursor: null };
      return { status: 400, corpo: { error: "ERR_VALIDACAO", message: "cursor" } };
    });
    const h = cliente().empresa(3).historico;
    const pg = await h.doTicket(8, { limite: 2 });
    expect(pg.proximoCursor).toBe("c1");
    expect(ultima().consulta).toEqual({ limite: "2" });
    const ids: number[] = [];
    for await (const m of h.percorrerTicket(8, { limite: 2 })) ids.push(m.id);
    expect(ids).toEqual([3, 2, 1]);
  });
});

describe("criarClienteBase (ponto de extensão)", () => {
  interface Ctx extends ContextoChamada {
    marca?: string;
  }

  it("usa o obtentor de token, os cabeçalhos extras e força a renovação após 401", async () => {
    let n = 0;
    nucleo.quando("GET", "/filas", () => (++n === 1 ? { status: 401, corpo: { error: "ERR_TOKEN_INVALIDO", message: "x" } } : { dados: [] }));
    const pedidos: [number, string | undefined, boolean][] = [];
    const c = criarClienteBase<Ctx>({
      url: nucleo.url,
      timeoutMs: 2000,
      obterToken: async (ctx, forcar) => {
        pedidos.push([ctx.companyId, ctx.marca, forcar]);
        return forcar ? "novo" : "velho";
      },
      cabecalhos: ctx => ({ "X-Extra": `m-${ctx.marca}`, Authorization: "ignorado", "x-request-id": "ignorado" })
    });
    await c.empresa(4, { marca: "a", requestId: "rq" }).filas.listar();
    expect(pedidos).toEqual([
      [4, "a", false],
      [4, "a", true]
    ]);
    const ch = ultima();
    expect(ch.headers.authorization).toBe("Bearer novo");
    expect(ch.headers["x-extra"]).toBe("m-a");
    expect(ch.headers["x-request-id"]).toBe("rq");
  });
});
