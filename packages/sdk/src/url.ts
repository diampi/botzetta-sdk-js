const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Confere que a URL usa https:// (http:// só para desenvolvimento local). O JWKS da Plataforma é a raiz
 * de confiança, e os pedidos levam tokens e o client_assertion: em http, quem estiver no caminho forja
 * tokens ou captura credenciais.
 */
export function exigirHttps(url: string, campo: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`${campo}: URL inválida.`);
  }
  if (u.protocol === "https:") return url;
  if (u.protocol === "http:" && (HOSTS_LOCAIS.has(u.hostname) || u.hostname.endsWith(".localhost"))) return url;
  throw new Error(`${campo} precisa usar https:// (http:// só para localhost).`);
}

/** Base sem barra no fim e já conferida. */
export const baseSegura = (url: string, campo: string): string => exigirHttps(url, campo).replace(/\/+$/, "");
