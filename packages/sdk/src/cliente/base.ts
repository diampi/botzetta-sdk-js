import { randomUUID } from "node:crypto";
import { NucleoErro } from "../erros/NucleoErro";
import { PREFIXO_API } from "../constantes";
import { baseSegura } from "../url";
import type {
  Aniversariante, BuscaAniversariantes, CampoPersonalizado, CampoValor, Contato, CriarOportunidade, CriarPessoa,
  DadosOportunidade, DadosPessoa, EnviarMensagem, EnviarMidia, Fila, FiltrosAniversariante, HistoricoParams, ItemSimples,
  ListarContatosParams, ListarOportunidadesParams, ListarPessoasParams, ListarTicketsParams, Mensagem, MensagemEnviada,
  Midia, NotaTicket, Notificacao, Oportunidade, PaginaCursor, Paginado, PessoaDetalhe, PessoaResumo, Pipeline,
  PreviaAniversariantes, Tag, Template, Ticket, TransferirTicket, Usuario, Whatsapp
} from "./tipos";

export interface LoggerCliente {
  debug?: (obj: object, msg?: string) => void;
  warn?: (obj: object, msg?: string) => void;
}

/** Contexto de uma chamada: a empresa e, opcionalmente, o id de correlação (X-Request-Id). */
export interface ContextoChamada {
  companyId: number;
  requestId?: string;
}

/**
 * Opções do cliente base (avançado). Para um app de parceiro use `criarCliente`, que já liga o
 * token da instalação. O cliente base serve para quem precisa trocar a origem do token (ex.: testes
 * ou um cofre de tokens próprio) sem reescrever as chamadas da API.
 */
export interface OpcoesClienteBase<C extends ContextoChamada = ContextoChamada> {
  /** Base do Botzetta, sem /plataforma/v1 (ex.: https://api.botzetta.com.br). */
  url: string;
  /**
   * Access token para a chamada. `forcarRenovacao` = o Botzetta acabou de recusar o token anterior
   * (401 ERR_TOKEN_INVALIDO): obtenha um novo em vez de devolver o mesmo.
   */
  obterToken(ctx: C, forcarRenovacao: boolean): Promise<string>;
  /** Cabeçalhos extras de cada chamada (não sobrescrevem Authorization, X-Request-Id nem Idempotency-Key). */
  cabecalhos?(ctx: C): Record<string, string>;
  /** Timeout por tentativa (padrão 10 s). */
  timeoutMs?: number;
  /** Novas tentativas em 5xx/timeout/rede (padrão 2). */
  novasTentativas?: number;
  logger?: LoggerCliente;
  /** Injetável nos testes. */
  fetch?: typeof fetch;
}

interface OpcoesChamada {
  corpo?: unknown;
  formulario?: FormData;
  consulta?: Record<string, string | number | undefined>;
  idempotencyKey?: string;
  /** Pode repetir em 5xx/timeout sem efeito duplicado? (GET e POST de leitura/idempotentes) */
  repetivel: boolean;
}

const ESPERAS_MS = [500, 1500];
const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));
/** Cabeçalhos que o cliente controla: `cabecalhos()` não os troca. */
const RESERVADOS = new Set(["authorization", "x-request-id", "idempotency-key", "content-type", "cookie", "host"]);

export type ClienteBase<C extends ContextoChamada = ContextoChamada> = ReturnType<typeof criarClienteBase<C>>;
/** Chamadas da API de Plataforma em nome de uma empresa. */
export type ClienteEmpresa = ReturnType<ClienteBase["empresa"]>;

/**
 * Cliente da API de Plataforma com a origem do token injetada (avançado; veja `criarCliente`).
 *
 *   const pessoa = await cliente.empresa(companyId).pessoas.obter(id);
 */
export function criarClienteBase<C extends ContextoChamada = ContextoChamada>(opcoes: OpcoesClienteBase<C>) {
  const url = baseSegura(opcoes.url, "url");
  const timeoutMs = opcoes.timeoutMs ?? 10_000;
  const novasTentativas = opcoes.novasTentativas ?? 2;
  const fetchImpl = opcoes.fetch ?? fetch;

  async function chamar<T>(metodo: string, caminho: string, ctx: C, op: OpcoesChamada): Promise<T> {
    const requestId = ctx.requestId ?? randomUUID();
    const consulta = op.consulta
      ? "?" + new URLSearchParams(Object.entries(op.consulta).filter(([, v]) => v !== undefined).map(([k, v]): [string, string] => [k, String(v)])).toString()
      : "";
    const destino = `${url}${PREFIXO_API}${caminho}${consulta === "?" ? "" : consulta}`;
    let tokenRenovado = false;
    // Força a renovação só na tentativa logo depois do 401 (não a cada nova tentativa por 5xx).
    let forcarRenovacao = false;

    for (let tentativa = 0; ; tentativa++) {
      const token = await opcoes.obterToken(ctx, forcarRenovacao);
      forcarRenovacao = false;
      const headers: Record<string, string> = {};
      for (const [nome, valor] of Object.entries(opcoes.cabecalhos?.(ctx) ?? {})) if (!RESERVADOS.has(nome.toLowerCase())) headers[nome] = valor;
      headers.Authorization = `Bearer ${token}`;
      headers["X-Request-Id"] = requestId;
      if (op.idempotencyKey) headers["Idempotency-Key"] = op.idempotencyKey;
      if (op.corpo !== undefined) headers["Content-Type"] = "application/json";
      let resp: Response;
      try {
        resp = await fetchImpl(destino, {
          method: metodo,
          headers,
          redirect: "error",
          body: op.formulario ?? (op.corpo !== undefined ? JSON.stringify(op.corpo) : undefined),
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch (e) {
        if (op.repetivel && tentativa < novasTentativas) {
          opcoes.logger?.warn?.({ caminho, tentativa, requestId }, "falha de rede ao chamar o núcleo; nova tentativa");
          await dormir(ESPERAS_MS[tentativa] ?? 1500);
          continue;
        }
        throw new NucleoErro("ERR_NUCLEO_INDISPONIVEL", `Núcleo indisponível: ${(e as Error).message}`, 0, requestId);
      }

      if (resp.status === 204) return undefined as T;
      const corpo = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
      if (resp.ok) return corpo as T;

      const codigo = String(corpo.error ?? "ERR_NUCLEO");
      if (resp.status === 401 && codigo === "ERR_TOKEN_INVALIDO" && !tokenRenovado) {
        tokenRenovado = true;
        forcarRenovacao = true;
        continue;
      }
      if (resp.status >= 500 && op.repetivel && tentativa < novasTentativas) {
        await dormir(ESPERAS_MS[tentativa] ?? 1500);
        continue;
      }
      throw new NucleoErro(codigo, String(corpo.message ?? codigo), resp.status, resp.headers.get("X-Request-Id") ?? requestId);
    }
  }

  const lista = (ids?: number[]) => (ids && ids.length ? ids.join(",") : undefined);
  return {
    /** Todas as chamadas de dados são feitas em nome de uma empresa. */
    empresa(companyId: number, extra: Omit<C, "companyId"> = {} as Omit<C, "companyId">) {
      const c = { ...extra, companyId } as C;
      const get = <T>(caminho: string, consulta?: OpcoesChamada["consulta"]) => chamar<T>("GET", caminho, c, { consulta, repetivel: true });
      // Escrita idempotente por natureza (PATCH/PUT e ações de estado): pode repetir em 5xx/timeout.
      const escrever = <T>(metodo: string, caminho: string, corpo?: unknown) => chamar<T>(metodo, caminho, c, { corpo: corpo ?? {}, repetivel: true });
      // POST que cria registro ou envia mensagem: Idempotency-Key obrigatória (repetir a chave nunca duplica).
      const criar = <T>(caminho: string, corpo: unknown, o: { idempotencyKey: string }) =>
        chamar<T>("POST", caminho, c, { corpo, idempotencyKey: o.idempotencyKey, repetivel: true });
      const historico = (base: string) => (p: HistoricoParams = {}) => get<PaginaCursor<Mensagem>>(base, { cursor: p.cursor, limite: p.limite });
      /** Segue o cursor até o fim (mais novas primeiro). */
      async function* percorrer(base: string, p: Omit<HistoricoParams, "cursor"> = {}): AsyncGenerator<Mensagem> {
        let cursor: string | undefined;
        do {
          const pg = await historico(base)({ ...p, cursor });
          yield* pg.dados;
          cursor = pg.proximoCursor ?? undefined;
        } while (cursor);
      }
      return {
        pessoas: {
          listar: (p: ListarPessoasParams = {}) =>
            get<Paginado<PessoaResumo>>("/pessoas", { ids: lista(p.ids), busca: p.busca, tags: lista(p.tags), pagina: p.pagina, porPagina: p.porPagina }),
          /** Inclui tags, campos e statusCadastro. */
          obter: (id: number) => get<PessoaDetalhe>(`/pessoas/${id}`),
          /** pessoas:escrever. Sempre cria (nunca deduplica). */
          criar: (dados: CriarPessoa, o: { idempotencyKey: string }) => criar<PessoaDetalhe>("/pessoas", dados, o),
          atualizar: (id: number, dados: DadosPessoa) => escrever<PessoaDetalhe>("PATCH", `/pessoas/${id}`, dados),
          /** Substitui as tags da pessoa. */
          definirTags: (id: number, tags: number[]) => escrever<{ tags: Tag[] }>("PUT", `/pessoas/${id}/tags`, { tags }),
          salvarCampos: (id: number, campos: { campoId: number; valor: unknown }[]) =>
            escrever<{ campos: CampoValor[] }>("PUT", `/pessoas/${id}/campos`, { campos }),
          /** Só liga o opt-out (desfazer é da própria pessoa ou da tela do núcleo). */
          optOut: (id: number) => escrever<PessoaDetalhe>("POST", `/pessoas/${id}/opt-out`),
          aniversariantes: (b: BuscaAniversariantes) =>
            chamar<{ dados: Aniversariante[]; total: number }>("POST", "/pessoas/aniversariantes", c, { corpo: b, repetivel: true }),
          previaAniversariantes: (b: { filtros?: FiltrosAniversariante } = {}) =>
            chamar<PreviaAniversariantes>("POST", "/pessoas/aniversariantes/previa", c, { corpo: b, repetivel: true })
        },
        contatos: {
          listar: (p: ListarContatosParams = {}) =>
            get<Paginado<Contato>>("/contatos", { ids: lista(p.ids), busca: p.busca, pagina: p.pagina, porPagina: p.porPagina }),
          obter: (id: number) => get<Contato>(`/contatos/${id}`)
        },
        whatsapps: {
          listar: () => get<{ dados: Whatsapp[] }>("/whatsapps"),
          obter: (id: number) => get<Whatsapp>(`/whatsapps/${id}`)
        },
        filas: { listar: () => get<{ dados: Fila[] }>("/filas") },
        tags: { listar: () => get<{ dados: Tag[] }>("/tags") },
        templates: {
          listar: (p: { whatsappId?: number } = {}) => get<{ dados: Template[] }>("/templates", { whatsappId: p.whatsappId }),
          obter: (id: number) => get<Template>(`/templates/${id}`)
        },
        usuarios: {
          obter: (id: number) => get<Usuario>(`/usuarios/${id}`),
          listar: (p: { busca?: string } = {}) => get<{ dados: Usuario[] }>("/usuarios", { busca: p.busca })
        },
        mensagens: {
          /** idempotencyKey é obrigatório: repetir a chave nunca reenvia. */
          enviar: (p: EnviarMensagem, o: { idempotencyKey: string }) =>
            chamar<MensagemEnviada>("POST", "/mensagens", c, { corpo: p, idempotencyKey: o.idempotencyKey, repetivel: true })
        },
        midias: {
          obter: (id: number) => get<Midia>(`/midias/${id}`),
          enviar: (a: EnviarMidia) => {
            const form = new FormData();
            const blob = a.conteudo instanceof Blob ? a.conteudo : new Blob([a.conteudo as Uint8Array<ArrayBuffer>], { type: a.tipoMime });
            form.append("arquivo", blob, a.nome);
            if (a.entidadeId) form.append("entidadeId", String(a.entidadeId));
            return chamar<Midia>("POST", "/midias", c, { formulario: form, repetivel: false });
          },
          excluir: (id: number) => chamar<void>("DELETE", `/midias/${id}`, c, { repetivel: true })
        },
        realtime: {
          emitir: (evento: string, dados: unknown, o: { usuarioId?: number } = {}) =>
            chamar<{ evento: string }>("POST", "/realtime/eventos", c, { corpo: { evento, dados, ...o }, repetivel: false })
        },
        notificacoes: {
          enviar: (n: Notificacao) => chamar<{ enfileirada: boolean }>("POST", "/notificacoes", c, { corpo: n, repetivel: false })
        },
        /** pessoas:ler (entidade pessoa) ou crm:ler (oportunidade). */
        camposPersonalizados: {
          listar: (p: { entidade: "pessoa" | "oportunidade" }) => get<{ dados: CampoPersonalizado[] }>("/campos-personalizados", { entidade: p.entidade })
        },
        /** crm:ler / crm:escrever. */
        crm: {
          pipelines: {
            listar: () => get<{ dados: Pipeline[] }>("/pipelines"),
            obter: (id: number) => get<Pipeline>(`/pipelines/${id}`)
          },
          oportunidades: {
            listar: (p: ListarOportunidadesParams = {}) => get<Paginado<Oportunidade>>("/oportunidades", { ...p }),
            obter: (id: number) => get<Oportunidade>(`/oportunidades/${id}`),
            tipos: () => get<{ dados: ItemSimples[] }>("/oportunidades/tipos"),
            motivosPerda: () => get<{ dados: ItemSimples[] }>("/oportunidades/motivos-perda"),
            criar: (dados: CriarOportunidade, o: { idempotencyKey: string }) => criar<Oportunidade>("/oportunidades", dados, o),
            atualizar: (id: number, dados: DadosOportunidade) => escrever<Oportunidade>("PATCH", `/oportunidades/${id}`, dados),
            /** Estágio de ganho/perda aplica o resultado. */
            mover: (id: number, p: { estagioId: number; pipelineId?: number }) => escrever<Oportunidade>("POST", `/oportunidades/${id}/mover`, p),
            ganhar: (id: number) => escrever<Oportunidade>("POST", `/oportunidades/${id}/ganhar`),
            perder: (id: number, p: { motivoPerdaId: number; observacao?: string }) => escrever<Oportunidade>("POST", `/oportunidades/${id}/perder`, p),
            reabrir: (id: number) => escrever<Oportunidade>("POST", `/oportunidades/${id}/reabrir`)
          }
        },
        /** tickets:ler / tickets:escrever. */
        tickets: {
          listar: (p: ListarTicketsParams = {}) => get<Paginado<Ticket>>("/tickets", { ...p }),
          obter: (id: number) => get<Ticket>(`/tickets/${id}`),
          anotar: (id: number, texto: string, o: { idempotencyKey: string }) => criar<NotaTicket>(`/tickets/${id}/notas`, { texto }, o),
          transferir: (id: number, p: TransferirTicket, o: { idempotencyKey: string }) => criar<Ticket>(`/tickets/${id}/transferir`, p, o),
          /** Sem `enviarDespedida: true`, não manda mensagem ao cliente. */
          fechar: (id: number, p: { enviarDespedida?: boolean }, o: { idempotencyKey: string }) => criar<Ticket>(`/tickets/${id}/fechar`, p, o)
        },
        /** mensagens:ler — histórico por cursor (mais novas primeiro). */
        historico: {
          doTicket: (ticketId: number, p: HistoricoParams = {}) => historico(`/tickets/${ticketId}/mensagens`)(p),
          doContato: (contatoId: number, p: HistoricoParams = {}) => historico(`/contatos/${contatoId}/mensagens`)(p),
          percorrerTicket: (ticketId: number, p: Omit<HistoricoParams, "cursor"> = {}) => percorrer(`/tickets/${ticketId}/mensagens`, p),
          percorrerContato: (contatoId: number, p: Omit<HistoricoParams, "cursor"> = {}) => percorrer(`/contatos/${contatoId}/mensagens`, p)
        }
      };
    }
  };
}
