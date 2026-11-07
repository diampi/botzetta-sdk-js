import { AppError } from "./erros/AppError";
import { PREFIXO_API } from "./constantes";
import { criarVerificador } from "./jwks";
import { criarResolvedorSessao, type SessaoUsuario } from "./sessao";
import { exigirHttps } from "./url";

/**
 * Validação do token "usuario" sem framework: é o que a página do app (no iframe) manda para o seu
 * backend no `Authorization: Bearer`. Serve para Node puro, Fastify, Nest ou qualquer outro.
 * Com Express, use `autenticarUsuario` de `@botzetta/sdk/express`, que faz isto e preenche `req.contexto`.
 */
export interface OpcoesVerificarUsuario {
  /** Slug do app (o token precisa ter aud = app:<slug>). */
  slug: string;
  /** Base do Botzetta, sem /plataforma/v1 (ex.: https://api.botzetta.com.br). Obrigatória se não informar `jwksUrl`. */
  nucleoUrl?: string;
  /** JWKS da Plataforma; padrão: <nucleoUrl>/plataforma/v1/.well-known/jwks.json. */
  jwksUrl?: string;
  /** Validade do cache da sessão (padrão 30 s, entre 5 s e 60 s). */
  sessaoCacheTtlMs?: number;
  /** Injetável nos testes. */
  fetch?: typeof fetch;
  logger?: { warn?: (obj: object, msg?: string) => void };
}

/** Usuário conferido: identidade do token + sessão atual (acessos, perfil e nivel vêm do Botzetta, não do token). */
export type UsuarioVerificado = SessaoUsuario;

const SUFIXO_JWKS = `${PREFIXO_API}/.well-known/jwks.json`;
const semBarra = (u: string) => exigirHttps(u, "nucleoUrl").replace(/\/+$/, "");

/** Extrai o token de um cabeçalho `Authorization: Bearer <token>` ("" se ausente ou noutro formato). */
export function tokenDoCabecalho(cabecalho: string | string[] | undefined | null): string {
  const valor = Array.isArray(cabecalho) ? cabecalho[0] : cabecalho;
  const [tipo, token, ...resto] = (valor ?? "").trim().split(/\s+/);
  return tipo === "Bearer" && token && resto.length === 0 ? token : "";
}

const invalido = () => new AppError("ERR_TOKEN_INVALIDO", "Sessão do app inválida ou expirada.", 401);

/** Resolve as URLs uma vez por combinação de opções (o JWKS e o cache de sessão já são compartilhados no processo). */
function urlsDe(op: OpcoesVerificarUsuario): { jwksUrl: string; nucleoUrl: string } {
  if (op.jwksUrl) {
    const jwksUrl = exigirHttps(op.jwksUrl, "jwksUrl");
    const nucleoUrl = op.nucleoUrl ?? (jwksUrl.endsWith(SUFIXO_JWKS) ? jwksUrl.slice(0, -SUFIXO_JWKS.length) : "");
    if (!nucleoUrl) throw new Error("Informe nucleoUrl (não foi possível derivá-la do jwksUrl).");
    return { jwksUrl, nucleoUrl: semBarra(nucleoUrl) };
  }
  if (!op.nucleoUrl) throw new Error("Informe nucleoUrl (ou jwksUrl).");
  return { jwksUrl: `${semBarra(op.nucleoUrl)}${SUFIXO_JWKS}`, nucleoUrl: semBarra(op.nucleoUrl) };
}

/**
 * Cria um verificador reutilizável (prefira este a chamar `verificarUsuario` com opções novas a cada requisição).
 *
 *   const verificar = criarVerificadorUsuario({ slug: "meuapp", nucleoUrl: env.NUCLEO_URL });
 *   const usuario = await verificar(tokenDoCabecalho(req.headers.authorization));
 */
export function criarVerificadorUsuario(op: OpcoesVerificarUsuario): (token: string) => Promise<UsuarioVerificado> {
  if (!op.slug) throw new Error("slug do app é obrigatório.");
  const { jwksUrl, nucleoUrl } = urlsDe(op);
  const verificar = criarVerificador({ jwksUrl });
  const resolverSessao = criarResolvedorSessao({ nucleoUrl, ttlMs: op.sessaoCacheTtlMs, fetch: op.fetch, logger: op.logger });

  return async token => {
    if (!token) throw invalido();
    const payload = await verificar(token, { audience: `app:${op.slug}` }).catch(() => {
      throw invalido();
    });
    if (payload.tipo !== "usuario" || !payload.cid || !payload.sub) throw invalido();
    const sessao = await resolverSessao(token);
    // A sessão tem de ser do mesmo usuário e da mesma empresa do token.
    if (sessao.companyId !== Number(payload.cid) || sessao.usuarioId !== Number(payload.sub)) throw invalido();
    return sessao;
  };
}

/**
 * Valida o token "usuario" (assinatura RS256 pelo JWKS da Plataforma, `aud` = app:<slug>, validade) e
 * consulta a sessão atual no Botzetta (GET /plataforma/v1/sessao, cache de 30 s por token).
 * Recusa com AppError 401 (ERR_TOKEN_INVALIDO ou ERR_TOKEN_REVOGADO), 403 (ERR_APP_NAO_HABILITADO)
 * ou 503 (ERR_NUCLEO_INDISPONIVEL, falha fechada). Use SEMPRE o `companyId` devolvido aqui,
 * nunca um vindo do navegador.
 */
export function verificarUsuario(token: string, op: OpcoesVerificarUsuario): Promise<UsuarioVerificado> {
  return criarVerificadorUsuario(op)(token);
}

/** Escrita (POST/PUT/PATCH/DELETE) deve ser recusada? (empresa em paywall ou bloqueio total) */
export function escritaBloqueada(nivel: SessaoUsuario["nivel"]): AppError | null {
  if (nivel === "total") return new AppError("ERR_ASSINATURA_BLOQUEADA", "Assinatura bloqueada por falta de pagamento. Regularize para continuar.", 403);
  if (nivel === "paywall") return new AppError("ERR_ASSINATURA_VENCIDA", "Assinatura vencida. Regularize o pagamento para continuar.", 403);
  return null;
}
