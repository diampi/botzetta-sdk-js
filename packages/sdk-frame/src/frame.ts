import {
  ErroFrame,
  PROTOCOLO,
  ehEnvelope,
  type CodigoErroFrame,
  type ContextoFrame,
  type Envelope,
  type MetodoFrame,
  type Tema,
  type TipoToast
} from "./protocolo";

export interface OpcoesFrame {
  /**
   * Origens exatas do host do Botzetta que podem falar com esta página (ex.: ["https://app.botzetta.com.br"]).
   * Obrigatório: mensagem de qualquer outra origem é ignorada.
   */
  origensHost: string[];
  /** Espera pelo contexto do host (padrão 10 s, o mesmo prazo do host). */
  timeoutMs?: number;
}

/** Só para testes: janela da página e janela do host. */
export interface JanelasFrame {
  janela: Window;
  pai: Window;
}

export interface OpcoesConfirmar {
  titulo: string;
  mensagem: string;
  /** Texto do botão de confirmação (padrão "Confirmar"). */
  confirmar?: string;
  /** Texto do botão de cancelar (padrão "Cancelar"). */
  cancelar?: string;
  destrutivo?: boolean;
}

export interface ClienteFrame {
  obterContexto(): ContextoFrame;
  /** Token "usuario" válido: renova pelo host quando faltam menos de 30 s. */
  obterToken(): Promise<string>;
  /** Caminho interno do host (ex.: "/pessoas/42"). */
  navegar(caminho: string): Promise<void>;
  abrirPessoa(id: number): Promise<void>;
  toast(mensagem: string, tipo?: TipoToast): Promise<void>;
  confirmar(opcoes: OpcoesConfirmar): Promise<boolean>;
  /** Altura em px (sem argumento: altura do documento). Só tem efeito em extensão. */
  redimensionar(altura?: number): Promise<void>;
  /** Caminho relativo à rotaBase (ex.: "notas/2"): o host atualiza a URL sem recarregar o iframe. */
  informarRota(caminho: string): Promise<void>;
  /** Só em extensão: fecha o diálogo. */
  fechar(): Promise<void>;
  aoMudarTema(fn: (tema: Tema) => void): () => void;
  aoRenovarToken(fn: (token: string) => void): () => void;
  /** Remove o listener de mensagens (pedidos pendentes são rejeitados). */
  encerrar(): void;
}

const TIMEOUT_HANDSHAKE_MS = 10_000;
const TIMEOUT_PEDIDO_MS = 30_000;
const MARGEM_TOKEN_MS = 30_000;

function normalizarOrigens(origens: unknown): Set<string> {
  if (!Array.isArray(origens) || !origens.length)
    throw new ErroFrame("ERR_FRAME_CONFIG", "iniciarFrame: informe origensHost (ex.: [\"https://app.botzetta.com.br\"])");
  return new Set(
    origens.map(o => {
      let u: URL;
      try {
        u = new URL(String(o));
      } catch {
        throw new ErroFrame("ERR_FRAME_CONFIG", `origem inválida em origensHost: ${String(o)}`);
      }
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new ErroFrame("ERR_FRAME_CONFIG", `origem inválida: ${String(o)}`);
      return u.origin;
    })
  );
}

function aplicarTema(janela: Window, tema: Tema): void {
  janela.document.documentElement.classList.toggle("dark", tema === "escuro");
}

/**
 * Conecta a página (dentro do iframe do host) ao Botzetta: envia "pronto" e espera o contexto
 * (token "usuario", empresa, usuário, tema). Só aceita mensagens do window.parent vindas de origensHost.
 */
export function iniciarFrame(opcoes: OpcoesFrame, janelas?: JanelasFrame): Promise<ClienteFrame> {
  const origens = normalizarOrigens(opcoes?.origensHost);
  const janela = janelas?.janela ?? window;
  const pai = janelas?.pai ?? window.parent;
  if (!pai || pai === janela)
    return Promise.reject(new ErroFrame("ERR_FRAME_FORA_DO_HOST", "a página não está dentro do Botzetta (sem window.parent)"));

  let origemHost: string | null = null;
  let contexto: ContextoFrame | null = null;
  let seq = 0;
  let encerrado = false;
  const pendentes = new Map<string, { resolver(v: unknown): void; rejeitar(e: Error): void; timer?: ReturnType<typeof setTimeout> }>();
  const ouvintesTema = new Set<(t: Tema) => void>();
  const ouvintesToken = new Set<(t: string) => void>();

  return new Promise<ClienteFrame>((resolver, rejeitar) => {
    const timerHandshake = setTimeout(() => {
      encerrar();
      rejeitar(new ErroFrame("ERR_FRAME_TIMEOUT", "o host não respondeu ao handshake"));
    }, opcoes.timeoutMs ?? TIMEOUT_HANDSHAKE_MS);

    function enviar(msg: Omit<Envelope, "botzetta">): void {
      if (!origemHost) return;
      pai.postMessage({ botzetta: PROTOCOLO, ...msg }, origemHost);
    }

    function encerrar(): void {
      encerrado = true;
      janela.removeEventListener("message", aoReceber);
      for (const [, p] of pendentes) {
        if (p.timer) clearTimeout(p.timer);
        p.rejeitar(new ErroFrame("ERR_FRAME_ENCERRADO", "cliente encerrado"));
      }
      pendentes.clear();
    }

    function pedir<T>(metodo: MetodoFrame, args?: unknown, semTimeout = false): Promise<T> {
      if (encerrado) return Promise.reject(new ErroFrame("ERR_FRAME_ENCERRADO", "cliente encerrado"));
      const id = `p${++seq}`;
      return new Promise<T>((res, rej) => {
        const p: { resolver(v: unknown): void; rejeitar(e: Error): void; timer?: ReturnType<typeof setTimeout> } = {
          resolver: v => res(v as T),
          rejeitar: rej
        };
        if (!semTimeout)
          p.timer = setTimeout(() => {
            pendentes.delete(id);
            rej(new ErroFrame("ERR_FRAME_TIMEOUT", `o host não respondeu a ${metodo}`));
          }, TIMEOUT_PEDIDO_MS);
        pendentes.set(id, p);
        enviar({ tipo: "pedido", id, dados: { metodo, args } });
      });
    }

    function atualizarToken(v: unknown): void {
      const t = v as { token?: unknown; expiraEm?: unknown } | null;
      if (!contexto || typeof t?.token !== "string" || typeof t.expiraEm !== "string") return;
      contexto = { ...contexto, token: t.token, expiraEm: t.expiraEm };
      ouvintesToken.forEach(fn => fn(t.token as string));
    }

    const cliente: ClienteFrame = {
      obterContexto: () => contexto as ContextoFrame,
      async obterToken() {
        const ctx = contexto as ContextoFrame;
        if (Date.parse(ctx.expiraEm) - Date.now() > MARGEM_TOKEN_MS) return ctx.token;
        atualizarToken(await pedir("token"));
        return (contexto as ContextoFrame).token;
      },
      navegar: caminho => pedir("navegar", { caminho }),
      abrirPessoa: id => pedir("abrirPessoa", { id }),
      toast: (mensagem, tipo = "info") => pedir("toast", { mensagem, tipo }),
      confirmar: o => pedir<boolean>("confirmar", o, true),
      redimensionar: altura => pedir("redimensionar", { altura: altura ?? janela.document.documentElement.scrollHeight }),
      informarRota: caminho => pedir("informarRota", { caminho }),
      fechar: () => pedir("fechar"),
      aoMudarTema(fn) {
        ouvintesTema.add(fn);
        return () => ouvintesTema.delete(fn);
      },
      aoRenovarToken(fn) {
        ouvintesToken.add(fn);
        return () => ouvintesToken.delete(fn);
      },
      encerrar
    };

    function aoReceber(e: MessageEvent): void {
      // Só o host que enquadra esta página, numa origem permitida, e (depois do handshake) sempre a mesma.
      if (e.source !== pai || !origens.has(e.origin) || (origemHost && e.origin !== origemHost)) return;
      if (!ehEnvelope(e.data)) return;
      const msg = e.data;

      if (msg.tipo === "contexto") {
        if (contexto) return; // um handshake por carga da página
        const ctx = msg.dados as ContextoFrame | undefined;
        clearTimeout(timerHandshake);
        if (ctx?.protocolo !== PROTOCOLO || typeof ctx.token !== "string") {
          encerrar();
          rejeitar(new ErroFrame("ERR_FRAME_PROTOCOLO", `protocolo do host não suportado: ${String(ctx?.protocolo)}`));
          return;
        }
        origemHost = e.origin;
        contexto = ctx;
        aplicarTema(janela, ctx.tema); // antes de resolver: sem piscar
        resolver(cliente);
        return;
      }
      if (!contexto) return;

      if (msg.tipo === "resposta" && msg.id) {
        const p = pendentes.get(msg.id);
        if (!p) return;
        pendentes.delete(msg.id);
        if (p.timer) clearTimeout(p.timer);
        const r = msg.dados as { ok?: boolean; valor?: unknown; erro?: { codigo?: string; mensagem?: string } } | undefined;
        if (r?.ok) p.resolver(r.valor);
        else p.rejeitar(new ErroFrame((r?.erro?.codigo ?? "ERR_FRAME_PARAMETRO") as CodigoErroFrame, r?.erro?.mensagem ?? "pedido recusado pelo host"));
        return;
      }

      if (msg.tipo === "evento") {
        const ev = msg.dados as { nome?: string; valor?: unknown } | undefined;
        if (ev?.nome === "tema" && (ev.valor === "claro" || ev.valor === "escuro")) {
          contexto = { ...contexto, tema: ev.valor };
          aplicarTema(janela, ev.valor);
          ouvintesTema.forEach(fn => fn(ev.valor as Tema));
        } else if (ev?.nome === "token") {
          atualizarToken(ev.valor);
        }
      }
    }

    janela.addEventListener("message", aoReceber);
    // Não sabemos qual das origens enquadra a página: cada postMessage só é entregue se a origem bater.
    for (const origem of origens) {
      pai.postMessage({ botzetta: PROTOCOLO, tipo: "pronto", dados: { versaoSdk: VERSAO_SDK } }, origem);
    }
  });
}

declare const __VERSAO_SDK__: string | undefined;
const VERSAO_SDK = typeof __VERSAO_SDK__ === "string" ? __VERSAO_SDK__ : "0.1.0";
