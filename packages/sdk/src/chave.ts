import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, type JsonWebKey, type KeyObject } from "node:crypto";
import { SignJWT } from "jose";
import { PREFIXO_API } from "./constantes";

/**
 * Chave do app: autenticação no núcleo por `private_key_jwt` (RFC 7523).
 * O app guarda a chave PRIVADA (variável de ambiente), publica a PÚBLICA num `jwksUrl` (informado na
 * versão do app no portal) e assina um `client_assertion` curto a cada pedido de token. Nenhum segredo
 * passa pelo portal nem fica guardado no núcleo.
 */

export const TIPO_CLIENT_ASSERTION = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
/** Vida máxima aceita pelo núcleo (exp − iat). */
export const ASSERTION_TTL_MAX_SEGUNDOS = 300;
const ASSERTION_TTL_PADRAO = 60;

export type AlgoritmoChave = "RS256" | "ES256";

export interface JwkPublica {
  kty: string;
  kid: string;
  alg: AlgoritmoChave;
  use: "sig";
  [campo: string]: unknown;
}

export interface ChaveApp {
  kid: string;
  alg: AlgoritmoChave;
  /** Conteúdo de GET /.well-known/jwks.json do app (só a chave pública). */
  jwks(): { keys: JwkPublica[] };
  /** client_assertion para o token endpoint do núcleo (iss = sub = clientId, jti único). */
  assinarAssertion(p: { clientId: string; audiencia: string; ttlSegundos?: number }): Promise<string>;
}

export interface OpcoesChaveApp {
  /** PEM (PKCS#8 ou PKCS#1/SEC1), PEM em base64 (formato das variáveis de ambiente), JWK privada ou KeyObject. */
  chavePrivada: string | JsonWebKey | KeyObject;
  kid: string;
}

const lerChavePrivada = (c: OpcoesChaveApp["chavePrivada"]): KeyObject => {
  if (typeof c === "string") {
    const texto = c.trim();
    const pem = texto.includes("BEGIN") ? texto.replace(/\\n/g, "\n") : Buffer.from(texto, "base64").toString("utf8");
    return createPrivateKey(pem);
  }
  if ((c as KeyObject).type === "private") return c as KeyObject;
  return createPrivateKey({ key: c as JsonWebKey, format: "jwk" });
};

const algoritmoDe = (k: KeyObject): AlgoritmoChave => {
  const d = k.asymmetricKeyDetails;
  if (k.asymmetricKeyType === "rsa") {
    if ((d?.modulusLength ?? 0) < 2048) throw new Error("Chave RSA do app precisa ter ao menos 2048 bits.");
    return "RS256";
  }
  if (k.asymmetricKeyType === "ec" && d?.namedCurve === "prime256v1") return "ES256";
  throw new Error("Chave do app deve ser RSA (RS256) ou EC P-256 (ES256).");
};

/** URL do token endpoint: é o `aud` padrão da assertion. */
export const urlTokenEndpoint = (urlNucleo: string): string => `${urlNucleo.replace(/\/+$/, "")}${PREFIXO_API}/oauth/token`;

/**
 * Carrega a chave do app.
 *
 *   const chave = criarChaveApp({ chavePrivada: process.env.APP_CHAVE_PRIVADA!, kid: process.env.APP_CHAVE_KID! });
 */
export function criarChaveApp(op: OpcoesChaveApp): ChaveApp {
  if (!op.kid || op.kid.length > 100) throw new Error("kid da chave do app é obrigatório (até 100 caracteres).");
  const privada = lerChavePrivada(op.chavePrivada);
  const alg = algoritmoDe(privada);
  const publica = createPublicKey(privada).export({ format: "jwk" }) as Record<string, unknown>;
  const jwk: JwkPublica = { ...publica, kty: String(publica.kty), kid: op.kid, alg, use: "sig" };
  return {
    kid: op.kid,
    alg,
    jwks: () => ({ keys: [jwk] }),
    assinarAssertion: ({ clientId, audiencia, ttlSegundos = ASSERTION_TTL_PADRAO }) => {
      const ttl = Math.min(Math.max(ttlSegundos, 10), ASSERTION_TTL_MAX_SEGUNDOS);
      const agora = Math.floor(Date.now() / 1000);
      return new SignJWT({})
        .setProtectedHeader({ alg, kid: op.kid, typ: "JWT" })
        .setIssuer(clientId)
        .setSubject(clientId)
        .setAudience(audiencia)
        .setIssuedAt(agora)
        .setExpirationTime(agora + ttl)
        .setJti(randomUUID())
        .sign(privada);
    }
  };
}

/** Resposta mínima aceita por `servirJwks`: a `ServerResponse` do Node (e, por isso, a do Express ou o `reply.raw` do Fastify). */
export interface RespostaHttp {
  statusCode: number;
  setHeader(nome: string, valor: string): unknown;
  end(corpo: string): unknown;
}

/**
 * Handler de `GET /.well-known/jwks.json` sem framework: publica só a chave pública (cache de 5 min).
 * Com Express, use o de `@botzetta/sdk/express`.
 *
 *   const jwks = servirJwks(chave);
 *   http.createServer((req, res) => (req.url === "/.well-known/jwks.json" ? jwks(req, res) : ...));
 */
export function servirJwks(chave: ChaveApp) {
  const corpo = JSON.stringify(chave.jwks());
  return (_req: unknown, res: RespostaHttp): void => {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.end(corpo);
  };
}

/** Gera um par novo para o app. A chave privada sai em PEM PKCS#8: guarde num cofre ou variável de ambiente, nunca no código. */
export function gerarChaveApp(alg: AlgoritmoChave = "RS256"): { chavePrivadaPem: string; kid: string } {
  const { privateKey } =
    alg === "ES256" ? generateKeyPairSync("ec", { namedCurve: "prime256v1" }) : generateKeyPairSync("rsa", { modulusLength: 2048 });
  const data = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return {
    chavePrivadaPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    kid: `app-${data}-${randomBytes(3).toString("hex")}`
  };
}

/** Corpo comum dos pedidos ao token endpoint (os 3 grants e o /oauth/revogar). */
export interface CredenciaisApp {
  /** URL do núcleo, sem /plataforma/v1. */
  url: string;
  /** client_id = slug do app. */
  clientId: string;
  chave: ChaveApp;
  /** `aud` da assertion; padrão = token endpoint de `url`. Troque quando o app chega ao núcleo por um endereço interno. */
  audienciaAssertion?: string;
}

export async function camposAssertion(c: CredenciaisApp): Promise<Record<string, string>> {
  return {
    client_id: c.clientId,
    client_assertion_type: TIPO_CLIENT_ASSERTION,
    client_assertion: await c.chave.assinarAssertion({ clientId: c.clientId, audiencia: c.audienciaAssertion ?? urlTokenEndpoint(c.url) })
  };
}
