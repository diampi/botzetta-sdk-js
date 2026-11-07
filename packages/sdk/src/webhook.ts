import { createHash, timingSafeEqual } from "node:crypto";
import { jwtVerify } from "jose";
import { AppError } from "./erros/AppError";
import { PLATAFORMA_ISS } from "./constantes";
import { jwksRemoto } from "./jwks";
import { TOLERANCIA_WEBHOOK_SEGUNDOS, TYP_ASSINATURA_WEBHOOK, type EventoWebhook } from "./eventos";

/**
 * Webhook assinado pelo Botzetta: `Botzetta-Assinatura` é um JWT RS256
 * com a chave da Plataforma (JWKS público do núcleo) que liga o corpo pelo hash:
 * `{ iss: "botzetta-nucleo", aud: "app:<slug>", tipo: "webhook", iat, exp, jti, entrega, evento, sha256 }`
 * e cabeçalho `typ: "botzetta-webhook+jwt"`. Nenhum segredo por app.
 */

export interface OpcoesVerificarWebhook {
  /** Corpo CRU da requisição (os mesmos bytes que chegaram; não use o JSON re-serializado). */
  corpo: string | Buffer;
  /** Valor do cabeçalho Botzetta-Assinatura. */
  assinatura: string | string[] | undefined | null;
  /** Valor do cabeçalho Botzetta-Entrega (opcional): se vier, precisa ser o mesmo assinado. */
  entrega?: string | string[] | undefined | null;
  /** Slug do app (o `aud` esperado é `app:<slug>`). */
  slug: string;
  /** JWKS do núcleo: <núcleo>/plataforma/v1/.well-known/jwks.json (cache de 10 min). */
  jwksUrl: string;
  /** Idade máxima da assinatura (padrão 300 s). */
  toleranciaSegundos?: number;
}

const invalida = (mensagem: string) => new AppError("ERR_WEBHOOK_ASSINATURA_INVALIDA", mensagem, 401);

/** base64url(SHA-256(corpo)) — o claim `sha256` da assinatura. */
export const hashCorpoWebhook = (corpo: string | Buffer): string => createHash("sha256").update(corpo).digest("base64url");

/** Evento conferido + dados da assinatura. Deduplique por `id` (evento) ou `entrega`; `jti` muda a cada tentativa. */
export type WebhookVerificado = EventoWebhook & { entrega: string; jti: string };

/**
 * Confere a assinatura de um webhook do Botzetta e devolve o evento.
 * Recusa (AppError ERR_WEBHOOK_ASSINATURA_INVALIDA, 401) cabeçalho ausente, chave fora do JWKS do núcleo,
 * `iss`/`aud`/`typ`/`tipo` errados, assinatura expirada ou fora da tolerância corpo que não bate com o hash e
 * Botzetta-Entrega diferente da assinada (quando informado em `entrega`).
 */
export async function verificarWebhook(o: OpcoesVerificarWebhook): Promise<WebhookVerificado> {
  const token = Array.isArray(o.assinatura) ? o.assinatura[0] : o.assinatura;
  if (!token) throw invalida("Cabeçalho Botzetta-Assinatura ausente.");
  if (!o.slug) throw invalida("Slug do app não configurado.");
  if (!o.jwksUrl) throw invalida("JWKS do Botzetta não configurado.");
  if (typeof o.corpo !== "string" && !Buffer.isBuffer(o.corpo)) throw invalida("Passe o corpo CRU (string ou Buffer), não o JSON já interpretado.");
  const chaves = jwksRemoto(o.jwksUrl);
  const tolerancia = o.toleranciaSegundos ?? TOLERANCIA_WEBHOOK_SEGUNDOS;

  let claims: Record<string, unknown>;
  try {
    const r = await jwtVerify(token, chaves, {
      issuer: PLATAFORMA_ISS,
      audience: `app:${o.slug}`,
      algorithms: ["RS256"],
      typ: TYP_ASSINATURA_WEBHOOK,
      requiredClaims: ["iat", "exp"],
      maxTokenAge: tolerancia,
      clockTolerance: 30,
    });
    claims = r.payload as Record<string, unknown>;
  } catch {
    throw invalida("Assinatura do webhook não confere.");
  }
  if (claims.tipo !== "webhook" || typeof claims.sha256 !== "string" || typeof claims.entrega !== "string" || typeof claims.jti !== "string")
    throw invalida("Assinatura do webhook não confere.");
  const cabecalhoEntrega = Array.isArray(o.entrega) ? o.entrega[0] : o.entrega;
  if (cabecalhoEntrega && cabecalhoEntrega !== claims.entrega) throw invalida("Botzetta-Entrega não confere com a assinatura.");
  const esperado = Buffer.from(hashCorpoWebhook(o.corpo));
  const recebido = Buffer.from(claims.sha256);
  if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) throw invalida("Corpo do webhook não confere com a assinatura.");

  let evento: EventoWebhook;
  try {
    evento = JSON.parse(Buffer.isBuffer(o.corpo) ? o.corpo.toString("utf8") : o.corpo) as EventoWebhook;
  } catch {
    throw new AppError("ERR_WEBHOOK_CORPO_INVALIDO", "Corpo do webhook não é JSON.", 400);
  }
  // `entrega` e `jti` vêm da assinatura (não do corpo): usar para deduplicar e registrar.
  return { ...evento, entrega: claims.entrega as string, jti: claims.jti as string };
}
