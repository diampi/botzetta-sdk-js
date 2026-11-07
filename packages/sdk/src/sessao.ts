import { createHash } from "node:crypto";
import { AppError } from "./erros/AppError";
import { PREFIXO_API } from "./constantes";
import { baseSegura } from "./url";

/** Situação da assinatura da empresa: em `paywall` e `total` a escrita é recusada. */
export type NivelBloqueio = "nenhum" | "aviso" | "paywall" | "total";
const NIVEIS: readonly NivelBloqueio[] = ["nenhum", "aviso", "paywall", "total"];

/**
 * Sessão atual do usuário (GET /plataforma/v1/sessao): acessos, perfil e nivel
 * vêm do núcleo, não do token. Cache curto por token para que um acesso retirado deixe de
 * valer no app em até 30 s. Com o Botzetta fora do ar, o último valor bom vale por até 2 min;
 * sem ele, a validação falha fechada (503).
 */
export interface SessaoUsuario {
  usuarioId: number;
  companyId: number;
  perfil: string;
  acessos: string[];
  nivel: NivelBloqueio;
}

export const SESSAO_TTL_PADRAO_MS = 30_000;
/** Último valor bom, usado só quando o núcleo está indisponível. */
export const SESSAO_STALE_MAX_MS = 120_000;
const TTL_MIN_MS = 5_000;
const TTL_MAX_MS = 60_000;
const MAX_ENTRADAS = 5_000;
const TIMEOUT_MS = 3_000;

interface Entrada {
  obtidoEm: number;
  sessao?: SessaoUsuario;
  erro?: AppError;
}

/** Ordem de inserção = LRU simples (acesso move a entrada para o fim). */
const cache = new Map<string, Entrada>();
const emVoo = new Map<string, Promise<SessaoUsuario>>();

/** Esvazia o cache de sessões deste processo (útil em testes). */
export function limparCacheSessao(): void {
  cache.clear();
  emVoo.clear();
}

export interface OpcoesSessao {
  /** Base do núcleo, sem /plataforma/v1. */
  nucleoUrl: string;
  /** Validade do cache (padrão 30 s, entre 5 s e 60 s). */
  ttlMs?: number;
  /** Injetável nos testes. */
  fetch?: typeof fetch;
  logger?: { warn?: (obj: object, msg?: string) => void };
}

const chaveDe = (token: string) => createHash("sha256").update(token).digest("base64url");

const gravar = (chave: string, entrada: Entrada): void => {
  cache.delete(chave);
  if (cache.size >= MAX_ENTRADAS) {
    let excesso = cache.size - Math.floor(MAX_ENTRADAS * 0.9);
    for (const k of cache.keys()) {
      if (excesso-- <= 0) break;
      cache.delete(k);
    }
  }
  cache.set(chave, entrada);
};

const indisponivel = () =>
  new AppError("ERR_NUCLEO_INDISPONIVEL", "Não foi possível validar a sessão agora. Tente novamente.", 503);

class Indisponivel extends Error {}

export function criarResolvedorSessao(op: OpcoesSessao): (token: string) => Promise<SessaoUsuario> {
  const destino = `${baseSegura(op.nucleoUrl, "nucleoUrl")}${PREFIXO_API}/sessao`;
  const ttl = Math.min(TTL_MAX_MS, Math.max(TTL_MIN_MS, op.ttlMs ?? SESSAO_TTL_PADRAO_MS));
  const fetchImpl = op.fetch ?? fetch;

  async function consultar(token: string): Promise<SessaoUsuario> {
    const resp = await fetchImpl(destino, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS)
    }).catch(() => {
      throw new Indisponivel();
    });
    if (resp.status === 429 || resp.status >= 500) throw new Indisponivel();
    const corpo = (await resp.json().catch(() => ({}))) as Partial<SessaoUsuario> & { error?: string; message?: string };
    if (resp.status === 401) {
      const codigo = corpo.error === "ERR_TOKEN_REVOGADO" ? "ERR_TOKEN_REVOGADO" : "ERR_TOKEN_INVALIDO";
      throw new AppError(codigo, corpo.message ?? "Sessão do app inválida ou expirada.", 401);
    }
    if (resp.status === 403 || resp.status === 404) {
      throw new AppError("ERR_APP_NAO_HABILITADO", "App não habilitado para esta empresa.", 403);
    }
    // Resposta fora do contrato = falha fechada (nunca liberar escrita por falta de `nivel`).
    if (!resp.ok || !Array.isArray(corpo.acessos) || !NIVEIS.includes(corpo.nivel as NivelBloqueio)) throw new Indisponivel();
    return {
      usuarioId: Number(corpo.usuarioId),
      companyId: Number(corpo.companyId),
      perfil: String(corpo.perfil ?? ""),
      acessos: corpo.acessos.map(String),
      nivel: corpo.nivel as NivelBloqueio
    };
  }

  return async function resolver(token: string): Promise<SessaoUsuario> {
    const chave = chaveDe(token);
    const agora = Date.now();
    const atual = cache.get(chave);
    if (atual && agora - atual.obtidoEm < ttl) {
      gravar(chave, atual);
      if (atual.erro) throw atual.erro;
      return atual.sessao!;
    }

    let pedido = emVoo.get(chave);
    if (!pedido) {
      pedido = consultar(token)
        .then(sessao => {
          gravar(chave, { obtidoEm: Date.now(), sessao });
          return sessao;
        })
        .catch((e: unknown) => {
          if (e instanceof AppError) {
            gravar(chave, { obtidoEm: Date.now(), erro: e });
            throw e;
          }
          // Indisponível: último valor bom por até 2 min; senão falha fechada (503).
          if (atual?.sessao && Date.now() - atual.obtidoEm <= SESSAO_STALE_MAX_MS) {
            op.logger?.warn?.({ destino }, "[sessao] núcleo indisponível; usando sessão em cache");
            return atual.sessao;
          }
          throw indisponivel();
        })
        .finally(() => emVoo.delete(chave));
      emVoo.set(chave, pedido);
    }
    return pedido;
  };
}
