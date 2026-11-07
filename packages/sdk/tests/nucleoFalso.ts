import http from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, jwtVerify, SignJWT } from "jose";
import { PLATAFORMA_ISS, PREFIXO_API } from "../src/constantes";
import { TOLERANCIA_WEBHOOK_SEGUNDOS, TYP_ASSINATURA_WEBHOOK } from "../src/eventos";
import { hashCorpoWebhook } from "../src/webhook";

/**
 * Botzetta falso para os testes deste pacote (não é publicado): publica o JWKS da Plataforma, emite
 * tokens "usuario", responde GET /sessao, assina webhooks e responde as rotas que o teste registrar.
 */

export interface RequisicaoFalsa {
  metodo: string;
  caminho: string;
  params: Record<string, string>;
  consulta: Record<string, string>;
  headers: http.IncomingHttpHeaders;
  corpo: unknown;
}

export interface RespostaFalsa {
  status?: number;
  corpo?: unknown;
}

export type ManipuladorFalso = (req: RequisicaoFalsa) => RespostaFalsa | Promise<RespostaFalsa> | unknown;

export interface OpcoesTokenUsuario {
  slug: string;
  companyId: number;
  userId: number;
  perfil?: string;
  acessos?: string[];
  nivel?: "nenhum" | "aviso" | "paywall" | "total";
  expiraEmSegundos?: number;
}

export interface NucleoFalso {
  url: string;
  jwksUrl: string;
  /** Registra a resposta de uma rota (caminho relativo a /plataforma/v1, aceita :param). */
  quando(metodo: string, caminho: string, manipulador: ManipuladorFalso): void;
  /** Chamadas recebidas (exceto JWKS e /sessao). */
  chamadas: RequisicaoFalsa[];
  /** Token "usuario" (só identidade); perfil/acessos/nivel ficam aqui e saem no GET /sessao. */
  emitirTokenUsuario(op: OpcoesTokenUsuario): Promise<string>;
  /** Token "usuario" assinado por uma chave fora do JWKS. */
  emitirTokenInvalido(op: OpcoesTokenUsuario): Promise<string>;
  /** Token válido da Plataforma, mas de outro `tipo` (não pode valer como "usuario" nem como webhook). */
  emitirTokenDeOutroTipo(op: { slug: string; companyId: number }): Promise<string>;
  revogarSessoes(companyId: number, userId: number): void;
  alterarSessao(companyId: number, userId: number, dados: { acessos?: string[]; perfil?: string; nivel?: OpcoesTokenUsuario["nivel"] }): void;
  definirSessaoIndisponivel(indisponivel: boolean): void;
  /** Valor de Botzetta-Assinatura. `iat` simula atraso; `outraChave` assina fora do JWKS. */
  assinarWebhook(op: { corpo: string | Buffer; slug: string; evento?: string; entrega?: string; iat?: number; outraChave?: boolean }): Promise<string>;
  limpar(): void;
  fechar(): Promise<void>;
}

const KID = "teste";
type ChavePrivada = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

async function assinar(chave: ChavePrivada, claims: Record<string, unknown>, aud: string, ttl: number, sub: string): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(PLATAFORMA_ISS)
    .setAudience(aud)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttl)
    .sign(chave);
}

function casar(padrao: string, caminho: string): Record<string, string> | null {
  const a = padrao.split("/").filter(Boolean);
  const b = caminho.split("/").filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!;
    const v = b[i]!;
    if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(v);
    else if (p !== v) return null;
  }
  return params;
}

export async function criarNucleoFalso(): Promise<NucleoFalso> {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const outra = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: "RS256", use: "sig" };
  const rotas: { metodo: string; caminho: string; manipulador: ManipuladorFalso }[] = [];
  const chamadas: RequisicaoFalsa[] = [];
  interface SessaoFalsa { usuarioId: number; companyId: number; perfil: string; acessos: string[]; nivel: string }
  const sessoes = new Map<string, SessaoFalsa>();
  const revogados = new Set<string>();
  let sessaoIndisponivel = false;
  const usuarioChave = (companyId: number, userId: number) => `${companyId}:${userId}`;

  const servidor = http.createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://localhost");
    const responder = (status: number, corpo: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(corpo === undefined ? "" : JSON.stringify(corpo));
    };
    if (u.pathname === `${PREFIXO_API}/.well-known/jwks.json`) return responder(200, { keys: [jwk] });
    if (u.pathname === `${PREFIXO_API}/sessao` && req.method === "GET") {
      const [, token] = (req.headers.authorization ?? "").split(" ");
      const claims = await jwtVerify(token ?? "", publicKey, { issuer: PLATAFORMA_ISS })
        .then(r => r.payload)
        .catch(() => null);
      const sessao = claims?.tipo === "usuario" && typeof claims.jti === "string" ? sessoes.get(claims.jti) : undefined;
      if (!sessao) return responder(401, { error: "ERR_TOKEN_INVALIDO", message: "Token inválido ou expirado." });
      if (sessaoIndisponivel) return responder(503, { error: "ERR_INDISPONIVEL", message: "Indisponível." });
      if (revogados.has(usuarioChave(sessao.companyId, sessao.usuarioId)))
        return responder(401, { error: "ERR_TOKEN_REVOGADO", message: "Sessão encerrada. Entre novamente." });
      return responder(200, sessao);
    }

    const pedacos: Buffer[] = [];
    for await (const p of req) pedacos.push(p as Buffer);
    const bruto = Buffer.concat(pedacos).toString("utf8");
    let corpo: unknown = bruto;
    if ((req.headers["content-type"] ?? "").includes("application/json") && bruto) {
      try {
        corpo = JSON.parse(bruto);
      } catch {
        corpo = bruto;
      }
    }
    const caminho = u.pathname.startsWith(PREFIXO_API) ? u.pathname.slice(PREFIXO_API.length) : u.pathname;
    const metodo = (req.method ?? "GET").toUpperCase();

    for (const r of rotas) {
      const params = r.metodo === metodo ? casar(r.caminho, caminho) : null;
      if (!params) continue;
      const chamada: RequisicaoFalsa = { metodo, caminho, params, consulta: Object.fromEntries(u.searchParams), headers: req.headers, corpo };
      chamadas.push(chamada);
      const saida = await r.manipulador(chamada);
      const ehResposta = typeof saida === "object" && saida !== null && ("status" in saida || "corpo" in saida);
      const resposta = (ehResposta ? saida : { status: 200, corpo: saida }) as RespostaFalsa;
      return responder(resposta.status ?? 200, resposta.corpo);
    }
    chamadas.push({ metodo, caminho, params: {}, consulta: Object.fromEntries(u.searchParams), headers: req.headers, corpo });
    return responder(404, { error: "ERR_NAO_ENCONTRADO", message: `Rota não registrada no Botzetta falso: ${metodo} ${caminho}` });
  });

  await new Promise<void>(r => servidor.listen(0, "127.0.0.1", r));
  const { port } = servidor.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;

  const tokenUsuario = (chave: ChavePrivada, op: OpcoesTokenUsuario) => {
    const jti = randomUUID();
    sessoes.set(jti, {
      usuarioId: op.userId,
      companyId: op.companyId,
      perfil: op.perfil ?? "user",
      acessos: op.acessos ?? ["*"],
      nivel: op.nivel ?? "nenhum"
    });
    return assinar(chave, { tipo: "usuario", cid: op.companyId, ver: 0, jti }, `app:${op.slug}`, op.expiraEmSegundos ?? 600, String(op.userId));
  };

  return {
    url,
    jwksUrl: `${url}${PREFIXO_API}/.well-known/jwks.json`,
    quando: (metodo, caminho, manipulador) => {
      rotas.unshift({ metodo: metodo.toUpperCase(), caminho, manipulador });
    },
    chamadas,
    emitirTokenUsuario: op => tokenUsuario(privateKey, op),
    emitirTokenInvalido: op => tokenUsuario(outra.privateKey, op),
    emitirTokenDeOutroTipo: op => assinar(privateKey, { tipo: "outro", cid: op.companyId }, `app:${op.slug}`, 120, "outro"),
    assinarWebhook: ({ corpo, slug, evento, entrega, iat, outraChave }) => {
      const t = iat ?? Math.floor(Date.now() / 1000);
      return new SignJWT({ tipo: "webhook", entrega: entrega ?? `ent_${randomUUID()}`, evento: evento ?? null, sha256: hashCorpoWebhook(corpo) })
        .setProtectedHeader({ alg: "RS256", kid: KID, typ: TYP_ASSINATURA_WEBHOOK })
        .setIssuer(PLATAFORMA_ISS)
        .setAudience(`app:${slug}`)
        .setIssuedAt(t)
        .setExpirationTime(t + TOLERANCIA_WEBHOOK_SEGUNDOS)
        .setJti(randomUUID())
        .sign(outraChave ? outra.privateKey : privateKey);
    },
    revogarSessoes: (companyId, userId) => {
      revogados.add(usuarioChave(companyId, userId));
    },
    alterarSessao: (companyId, userId, dados) => {
      for (const s of sessoes.values()) {
        if (s.companyId !== companyId || s.usuarioId !== userId) continue;
        if (dados.acessos) s.acessos = dados.acessos;
        if (dados.perfil) s.perfil = dados.perfil;
        if (dados.nivel) s.nivel = dados.nivel;
      }
    },
    definirSessaoIndisponivel: indisponivel => {
      sessaoIndisponivel = indisponivel;
    },
    limpar: () => {
      rotas.length = 0;
      chamadas.length = 0;
      revogados.clear();
      sessaoIndisponivel = false;
    },
    fechar: () => new Promise<void>((r, e) => servidor.close(err => (err ? e(err) : r())))
  };
}
