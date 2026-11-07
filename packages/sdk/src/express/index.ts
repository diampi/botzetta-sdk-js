// Subcaminho "@botzetta/sdk/express": middlewares para Express 5 (peer opcional).
// Só este módulo importa "express"; a raiz do pacote funciona sem ele instalado.
import { randomUUID } from "node:crypto";
import type { ErrorRequestHandler, Request, RequestHandler } from "express";
import { AppError } from "../erros/AppError";
import { NucleoErro } from "../erros/NucleoErro";
import type { ChaveApp } from "../chave";
import type { NivelBloqueio } from "../sessao";
import { criarVerificadorUsuario, escritaBloqueada, tokenDoCabecalho, type OpcoesVerificarUsuario } from "../usuario";

/** Contexto da requisição: a empresa SEMPRE vem daqui, nunca de body/query/params. */
export interface ContextoRequisicao {
  requestId: string;
  /** Quem autenticou a requisição; "usuario" = token da página do app (autenticarUsuario). */
  origem?: string;
  companyId?: number;
  userId?: number | null;
  perfil?: string;
  acessos?: string[];
  nivel?: NivelBloqueio;
}

export interface ContextoUsuario extends ContextoRequisicao {
  origem: "usuario";
  companyId: number;
  userId: number;
  perfil: string;
  acessos: string[];
  nivel: NivelBloqueio;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Preenchido por autenticarUsuario. */
      contexto?: ContextoRequisicao;
    }
  }
}

const REQUEST_ID_VALIDO = /^[A-Za-z0-9._-]{1,64}$/;
/** Reaproveita o X-Request-Id recebido (se tiver formato seguro) para correlacionar os logs; senão gera um. */
const requestIdDe = (h: string | string[] | undefined): string => {
  const v = Array.isArray(h) ? h[0] : h;
  return v && REQUEST_ID_VALIDO.test(v) ? v : randomUUID();
};

/** Mesmas opções de `verificarUsuario`: informe `nucleoUrl` (e, se quiser, `jwksUrl`). */
export type OpcoesAutenticacao = OpcoesVerificarUsuario;

/**
 * Valida o token "usuario" (Authorization: Bearer) com `verificarUsuario` e preenche `req.contexto`.
 * Recusa escrita (POST/PUT/PATCH/DELETE) quando a empresa está em paywall ou bloqueio total.
 */
export function autenticarUsuario(op: OpcoesAutenticacao): RequestHandler {
  const verificar = criarVerificadorUsuario(op);
  return async (req, _res, next) => {
    try {
      const sessao = await verificar(tokenDoCabecalho(req.headers.authorization));
      const escrita = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      const bloqueio = escrita ? escritaBloqueada(sessao.nivel) : null;
      if (bloqueio) throw bloqueio;
      req.contexto = {
        requestId: req.contexto?.requestId ?? requestIdDe(req.headers["x-request-id"]),
        origem: "usuario",
        companyId: sessao.companyId,
        userId: sessao.usuarioId,
        perfil: sessao.perfil,
        acessos: sessao.acessos,
        nivel: sessao.nivel
      };
      next();
    } catch (e) {
      next(e);
    }
  };
}

/** Contexto de uma rota protegida por autenticarUsuario (401 se não houver). */
export function contextoUsuario(req: Request): ContextoUsuario {
  const c = req.contexto;
  if (!c || c.origem !== "usuario" || !c.companyId) {
    throw new AppError("ERR_TOKEN_INVALIDO", "Sessão do app inválida ou expirada.", 401);
  }
  return c as ContextoUsuario;
}

/** `GET /.well-known/jwks.json` do app: publica só a chave pública (cache de 5 min). */
export function servirJwks(chave: ChaveApp): RequestHandler {
  return (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(chave.jwks());
  };
}

export interface LoggerMinimo {
  error: (obj: object, msg?: string) => void;
  warn?: (obj: object, msg?: string) => void;
}

interface ErroDeValidacao {
  name: string;
  issues: { path: PropertyKey[]; message: string }[];
}
/** Erro de validação no formato do zod (sem depender do zod). */
const ehErroDeValidacao = (e: unknown): e is ErroDeValidacao =>
  typeof e === "object" && e !== null && (e as { name?: unknown }).name === "ZodError" && Array.isArray((e as { issues?: unknown }).issues);

/** Handler de erro: responde sempre `{ error, message }`. Registre por último. */
export function tratarErros({ logger }: { logger?: LoggerMinimo } = {}): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const requestId = req.contexto?.requestId;
    if (requestId) res.setHeader("X-Request-Id", requestId);

    if (err instanceof AppError) {
      res.status(err.status).json(err.toJSON());
      return;
    }
    if (ehErroDeValidacao(err)) {
      const p = err.issues[0];
      const campo = p?.path.map(String).join(".");
      res.status(400).json({ error: "ERR_VALIDACAO", message: campo ? `${campo}: ${p?.message}` : (p?.message ?? "Dados inválidos.") });
      return;
    }
    if (err instanceof NucleoErro) {
      logger?.warn?.({ err: { codigo: err.codigo, status: err.status }, requestId }, "erro da API do Botzetta");
      // 4xx de negócio (404, 409, 422, 403 de escopo/assinatura…) são repassados. 401 é do token da
      // INSTALAÇÃO (não da sessão do navegador) e 5xx/rede são falha do upstream: viram 502 com mensagem
      // genérica, para a página não tratar como "sessão expirada".
      if (err.status >= 400 && err.status < 500 && err.status !== 401) {
        res.status(err.status).json(err.toJSON());
      } else {
        res.status(502).json({ error: err.codigo, message: "Falha ao chamar a API do Botzetta. Tente novamente." });
      }
      return;
    }
    const e = (err ?? {}) as { type?: string; status?: number; statusCode?: number; expose?: boolean; message?: string };
    if (e.type === "entity.parse.failed") {
      res.status(400).json({ error: "ERR_VALIDACAO", message: "JSON inválido." });
      return;
    }
    // Erros 4xx do Express/body-parser (ex.: 413 corpo grande) não são erro interno.
    const status = e.status ?? e.statusCode;
    if (typeof status === "number" && status >= 400 && status < 500 && e.expose !== false) {
      res.status(status).json({ error: status === 413 ? "ERR_CORPO_GRANDE" : "ERR_REQUISICAO", message: e.message ?? "Requisição inválida." });
      return;
    }
    logger?.error({ err, requestId }, "erro não tratado");
    res.status(500).json({ error: "ERR_INTERNO", message: "Erro interno." });
  };
}
