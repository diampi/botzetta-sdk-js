import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { PLATAFORMA_ISS } from "./constantes";
import { exigirHttps } from "./url";

type JwksRemoto = ReturnType<typeof createRemoteJWKSet>;
const conjuntos = new Map<string, JwksRemoto>();

/** JWKS remoto com cache de 10 min (nova busca quando aparece um `kid` desconhecido, no máximo a cada 30 s). */
export function jwksRemoto(jwksUrl: string): JwksRemoto {
  let jwks = conjuntos.get(jwksUrl);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(exigirHttps(jwksUrl, "jwksUrl")), { cacheMaxAge: 10 * 60_000, cooldownDuration: 30_000 });
    conjuntos.set(jwksUrl, jwks);
  }
  return jwks;
}

export type Verificador = (token: string, opcoes: { audience: string }) => Promise<JWTPayload>;

/**
 * Valida tokens RS256 emitidos pelo núcleo usando o JWKS público
 * (cache de 10 min; nova busca automática quando aparece um `kid` desconhecido).
 */
export function criarVerificador({ jwksUrl }: { jwksUrl: string }): Verificador {
  const conjunto = jwksRemoto(jwksUrl);
  return async (token, { audience }) => {
    const { payload } = await jwtVerify(token, conjunto, {
      issuer: PLATAFORMA_ISS,
      audience,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "sub"]
    });
    return payload;
  };
}
