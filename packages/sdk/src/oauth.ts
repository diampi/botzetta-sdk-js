import { createHash, randomBytes } from "node:crypto";
import { NucleoErro } from "./erros/NucleoErro";
import { PREFIXO_API } from "./constantes";
import { camposAssertion, type CredenciaisApp } from "./chave";
import { baseSegura } from "./url";

/**
 * OAuth por instalação para apps de parceiro:
 * link de instalação (PKCE S256) → o admin consente no host → o app troca o código
 * por tokens daquela empresa → renova com o refresh rotativo.
 */

/** Tokens de UMA instalação (uma empresa). O app guarda; o SDK não decide onde. */
export interface TokensInstalacao {
  accessToken: string;
  refreshToken: string;
  /** Quando o access token expira. */
  expiraEm: Date;
  escopos: string[];
  companyId: number;
  instalacaoId: number;
}

/**
 * Onde o app guarda os tokens de cada empresa (banco do app, cifrado).
 * O refresh é rotativo: SEMPRE salve o par novo antes de usar o access token novo.
 */
export interface ArmazenamentoTokens {
  obter(companyId: number): Promise<TokensInstalacao | null>;
  salvar(companyId: number, tokens: TokensInstalacao): Promise<void>;
}

/** O app se autentica com a própria chave (client_assertion, private_key_jwt). */
export interface CredenciaisOAuth extends CredenciaisApp {
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const base64url = (b: Buffer) => b.toString("base64url");

/** Par PKCE S256. Guarde o `verifier` (ex.: na sessão) até a troca do código. */
export function gerarPkce(): { verifier: string; challenge: string; metodo: "S256" } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge, metodo: "S256" };
}

/** Valor aleatório para o `state` (anti-CSRF do callback). Confira no retorno. */
export const gerarState = (): string => base64url(randomBytes(24));

/** Link que o admin da empresa abre para instalar o app (tela de consentimento do host). */
export function montarUrlInstalacao(p: {
  /** URL do Botzetta (host), ex.: https://app.botzetta.com.br */
  urlHost: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: "code",
    state: p.state,
    code_challenge: p.codeChallenge,
    code_challenge_method: "S256"
  });
  return `${baseSegura(p.urlHost, "urlHost")}/apps/instalar?${q.toString()}`;
}

interface RespostaToken {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  escopos?: string[];
  companyId?: number;
  instalacaoId?: number;
  error?: string;
  message?: string;
}

async function pedirToken(c: CredenciaisOAuth, corpo: Record<string, string>): Promise<TokensInstalacao> {
  const f = c.fetch ?? fetch;
  const destino = `${baseSegura(c.url, "url")}${PREFIXO_API}/oauth/token`;
  const resp = await f(destino, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...corpo, ...(await camposAssertion(c)) }),
    // Nunca reenviar o client_assertion para outro endereço.
    redirect: "error",
    signal: AbortSignal.timeout(c.timeoutMs ?? 10_000)
  }).catch(e => {
    throw new NucleoErro("ERR_NUCLEO_INDISPONIVEL", `Núcleo indisponível: ${(e as Error).message}`, 0);
  });
  const r = (await resp.json().catch(() => ({}))) as RespostaToken;
  if (!resp.ok || !r.access_token || !r.refresh_token || !Number.isSafeInteger(r.companyId) || !Number.isSafeInteger(r.instalacaoId)) {
    throw new NucleoErro(r.error ?? "ERR_OAUTH", r.message ?? "Falha ao obter token de instalação.", resp.status);
  }
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    expiraEm: new Date(Date.now() + (r.expires_in ?? 3600) * 1000),
    escopos: r.escopos ?? [],
    companyId: r.companyId as number,
    instalacaoId: r.instalacaoId as number
  };
}

/** Callback do link de instalação: troca o `code` (uso único, 10 min) pelos tokens da empresa. */
export function trocarCodigo(c: CredenciaisOAuth, p: { code: string; redirectUri: string; codeVerifier: string }): Promise<TokensInstalacao> {
  return pedirToken(c, { grant_type: "authorization_code", code: p.code, redirect_uri: p.redirectUri, code_verifier: p.codeVerifier });
}

/**
 * Renova o par. O refresh antigo deixa de valer; reusar um refresh já usado revoga
 * a instalação inteira (ERR_OAUTH_REFRESH_INVALIDO) e o admin precisa reinstalar.
 */
export function renovarToken(c: CredenciaisOAuth, refreshToken: string): Promise<TokensInstalacao> {
  return pedirToken(c, { grant_type: "refresh_token", refresh_token: refreshToken });
}

/**
 * Revoga o refresh (e os que vieram dele). Nunca lança: devolve `true` quando o Botzetta aceitou o
 * pedido (a resposta não revela se o token existia) e `false` em falha de rede ou de assinatura; tente de novo.
 */
export async function revogarToken(c: CredenciaisOAuth, refreshToken: string): Promise<boolean> {
  const f = c.fetch ?? fetch;
  try {
    const resp = await f(`${baseSegura(c.url, "url")}${PREFIXO_API}/oauth/revogar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: refreshToken, ...(await camposAssertion(c)) }),
      redirect: "error",
      signal: AbortSignal.timeout(c.timeoutMs ?? 10_000)
    });
    return resp.ok;
  } catch {
    return false;
  }
}
