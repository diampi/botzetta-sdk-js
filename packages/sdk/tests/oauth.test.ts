import { createHash, generateKeyPairSync } from "node:crypto";
import { createLocalJWKSet, decodeJwt, jwtVerify } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ASSERTION_TTL_MAX_SEGUNDOS,
  criarChaveApp,
  gerarChaveApp,
  TIPO_CLIENT_ASSERTION,
  urlTokenEndpoint,
  criarCliente,
  gerarPkce,
  montarUrlInstalacao,
  NucleoErro,
  renovarToken,
  trocarCodigo,
  type ArmazenamentoTokens,
  type TokensInstalacao
} from "../src";
import { criarNucleoFalso, type NucleoFalso } from "./nucleoFalso";
import { chaveTeste } from "./chaveTeste";

let nucleo: NucleoFalso;
beforeAll(async () => {
  nucleo = await criarNucleoFalso();
});
afterAll(() => nucleo.fechar());
beforeEach(() => nucleo.limpar());

const cred = () => ({ url: nucleo.url, clientId: "bzt_app_x", chave: chaveTeste, timeoutMs: 2000 });

const respostaToken = (n: number, expiresIn = 3600) => ({
  access_token: `acesso-${n}`,
  refresh_token: `refresh-${n}`,
  token_type: "Bearer",
  expires_in: expiresIn,
  escopos: ["pessoas:ler"],
  companyId: 7,
  instalacaoId: 3
});

const memoria = (inicial?: TokensInstalacao): ArmazenamentoTokens & { salvos: TokensInstalacao[] } => {
  let atual = inicial ?? null;
  const salvos: TokensInstalacao[] = [];
  return {
    salvos,
    obter: async () => atual,
    salvar: async (_c, t) => {
      atual = t;
      salvos.push(t);
    }
  };
};

describe("OAuth de instalação", () => {
  it("gerarPkce: challenge = base64url(sha256(verifier))", () => {
    const p = gerarPkce();
    expect(p.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.challenge).toBe(createHash("sha256").update(p.verifier).digest("base64url"));
    expect(p.metodo).toBe("S256");
  });

  it("montarUrlInstalacao aponta para /apps/instalar com PKCE S256", () => {
    const u = new URL(montarUrlInstalacao({ urlHost: "https://app.botzetta.com.br/", clientId: "c1", redirectUri: "https://x.com/cb", state: "st", codeChallenge: "ch" }));
    expect(u.pathname).toBe("/apps/instalar");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: "c1",
      redirect_uri: "https://x.com/cb",
      response_type: "code",
      state: "st",
      code_challenge: "ch",
      code_challenge_method: "S256"
    });
  });

  it("trocarCodigo envia o grant authorization_code e devolve os tokens da empresa", async () => {
    nucleo.quando("POST", "/oauth/token", () => respostaToken(1));
    const t = await trocarCodigo(cred(), { code: "c0d", redirectUri: "https://x.com/cb", codeVerifier: "v" });
    expect(t).toMatchObject({ accessToken: "acesso-1", refreshToken: "refresh-1", companyId: 7, instalacaoId: 3 });
    expect(nucleo.chamadas[0]!.corpo).toMatchObject({
      grant_type: "authorization_code",
      code: "c0d",
      redirect_uri: "https://x.com/cb",
      code_verifier: "v",
      client_id: "bzt_app_x"
    });
  });

  it("(1.0) manda client_assertion assinada pela chave do app, sem client_secret", async () => {
    nucleo.quando("POST", "/oauth/token", () => respostaToken(1));
    await trocarCodigo(cred(), { code: "c0d", redirectUri: "https://x.com/cb", codeVerifier: "v" });
    const corpo = nucleo.chamadas[0]!.corpo as Record<string, string>;
    expect(corpo.client_secret).toBeUndefined();
    expect(corpo.client_assertion_type).toBe(TIPO_CLIENT_ASSERTION);
    const { payload, protectedHeader } = await jwtVerify(corpo.client_assertion!, createLocalJWKSet(chaveTeste.jwks() as never));
    expect(protectedHeader).toMatchObject({ alg: "RS256", kid: chaveTeste.kid });
    expect(payload).toMatchObject({ iss: "bzt_app_x", sub: "bzt_app_x", aud: urlTokenEndpoint(nucleo.url) });
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(ASSERTION_TTL_MAX_SEGUNDOS);
    expect(typeof payload.jti).toBe("string");
    // audienciaAssertion troca o aud (app que fala com o núcleo por endereço interno).
    await trocarCodigo({ ...cred(), audienciaAssertion: "https://api.botzetta.com.br/plataforma/v1/oauth/token" }, { code: "c", redirectUri: "https://x.com/cb", codeVerifier: "v" });
    const outro = decodeJwt((nucleo.chamadas[1]!.corpo as Record<string, string>).client_assertion!);
    expect(outro.aud).toBe("https://api.botzetta.com.br/plataforma/v1/oauth/token");
    expect(outro.jti).not.toBe(payload.jti);
  });

  it("(1.0) criarChaveApp: JWKS só com a parte pública, ES256 e chave fraca recusada", async () => {
    const [jwk] = chaveTeste.jwks().keys;
    expect(jwk).toMatchObject({ kty: "RSA", alg: "RS256", use: "sig", kid: chaveTeste.kid });
    expect(jwk).not.toHaveProperty("d");
    const ec = gerarChaveApp("ES256");
    // PEM em base64 (formato do .env) também vale.
    const chaveEc = criarChaveApp({ chavePrivada: Buffer.from(ec.chavePrivadaPem).toString("base64"), kid: ec.kid });
    expect(chaveEc.alg).toBe("ES256");
    const a = await chaveEc.assinarAssertion({ clientId: "x", audiencia: "y" });
    await expect(jwtVerify(a, createLocalJWKSet(chaveEc.jwks() as never), { audience: "y" })).resolves.toBeTruthy();
    const fraca = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey;
    expect(() => criarChaveApp({ chavePrivada: fraca, kid: "k" })).toThrow(/2048/);
  });

  it("erro do núcleo vira NucleoErro com o código", async () => {
    nucleo.quando("POST", "/oauth/token", () => ({ status: 400, corpo: { error: "ERR_OAUTH_REFRESH_INVALIDO", message: "x" } }));
    await expect(renovarToken(cred(), "r")).rejects.toMatchObject({ codigo: "ERR_OAUTH_REFRESH_INVALIDO", status: 400 });
  });

  it("criarCliente: usa o token da instalação e não manda cabeçalho de empresa nem de usuário", async () => {
    nucleo.quando("GET", "/filas", () => ({ dados: [] }));
    const arm = memoria({ ...respostaToken(1), accessToken: "acesso-1", refreshToken: "refresh-1", expiraEm: new Date(Date.now() + 3_600_000), escopos: [], companyId: 7, instalacaoId: 3 });
    const c = criarCliente({ ...cred(), tokensInstalacao: arm });
    await c.empresa(7).filas.listar();
    const ch = nucleo.chamadas.find(x => x.caminho === "/filas")!;
    expect(ch.headers.authorization).toBe("Bearer acesso-1");
    expect(ch.headers["x-botzetta-empresa"]).toBeUndefined();
    expect(ch.headers["x-botzetta-usuario"]).toBeUndefined();
  });

  it("renova perto de expirar e salva o par novo antes de usar", async () => {
    nucleo.quando("POST", "/oauth/token", () => respostaToken(2));
    nucleo.quando("GET", "/filas", () => ({ dados: [] }));
    const arm = memoria({ accessToken: "acesso-1", refreshToken: "refresh-1", expiraEm: new Date(Date.now() + 10_000), escopos: [], companyId: 7, instalacaoId: 3 });
    const c = criarCliente({ ...cred(), tokensInstalacao: arm });
    await c.empresa(7).filas.listar();
    expect(arm.salvos[0]!.refreshToken).toBe("refresh-2");
    expect(nucleo.chamadas.find(x => x.caminho === "/oauth/token")!.corpo).toMatchObject({ grant_type: "refresh_token", refresh_token: "refresh-1" });
    expect(nucleo.chamadas.find(x => x.caminho === "/filas")!.headers.authorization).toBe("Bearer acesso-2");
  });

  it("401 ERR_TOKEN_INVALIDO força uma renovação e repete", async () => {
    let n = 0;
    nucleo.quando("POST", "/oauth/token", () => respostaToken(2));
    nucleo.quando("GET", "/filas", () => (++n === 1 ? { status: 401, corpo: { error: "ERR_TOKEN_INVALIDO", message: "x" } } : { dados: [] }));
    const arm = memoria({ accessToken: "acesso-1", refreshToken: "refresh-1", expiraEm: new Date(Date.now() + 3_600_000), escopos: [], companyId: 7, instalacaoId: 3 });
    await criarCliente({ ...cred(), tokensInstalacao: arm }).empresa(7).filas.listar();
    expect(n).toBe(2);
    expect(arm.salvos).toHaveLength(1);
  });

  it("depois do 401, novas tentativas por 5xx não renovam de novo", async () => {
    let n = 0;
    let renovacoes = 0;
    nucleo.quando("POST", "/oauth/token", () => respostaToken(++renovacoes + 1));
    nucleo.quando("GET", "/filas", () =>
      ++n === 1 ? { status: 401, corpo: { error: "ERR_TOKEN_INVALIDO", message: "x" } } : n === 2 ? { status: 503, corpo: { error: "ERR", message: "x" } } : { dados: [] }
    );
    const arm = memoria({ accessToken: "acesso-1", refreshToken: "refresh-1", expiraEm: new Date(Date.now() + 3_600_000), escopos: [], companyId: 7, instalacaoId: 3 });
    await criarCliente({ ...cred(), tokensInstalacao: arm }).empresa(7).filas.listar();
    expect(renovacoes).toBe(1);
  });

  it("refresh recusado porque outra instância já renovou: usa o par salvo", async () => {
    nucleo.quando("POST", "/oauth/token", () => ({ status: 400, corpo: { error: "ERR_OAUTH_REFRESH_INVALIDO", message: "x" } }));
    nucleo.quando("GET", "/filas", () => ({ dados: [] }));
    let leituras = 0;
    const arm: ArmazenamentoTokens = {
      // 1ª leitura: par vencendo; 2ª (depois da recusa): o par que a outra instância salvou.
      obter: async () =>
        ++leituras === 1
          ? { accessToken: "acesso-1", refreshToken: "refresh-1", expiraEm: new Date(Date.now() + 1000), escopos: [], companyId: 7, instalacaoId: 3 }
          : { accessToken: "acesso-outra", refreshToken: "refresh-outra", expiraEm: new Date(Date.now() + 3_600_000), escopos: [], companyId: 7, instalacaoId: 3 },
      salvar: async () => undefined
    };
    await criarCliente({ ...cred(), tokensInstalacao: arm }).empresa(7).filas.listar();
    expect(nucleo.chamadas.find(x => x.caminho === "/filas")!.headers.authorization).toBe("Bearer acesso-outra");
  });

  it("empresa sem tokens → ERR_APP_NAO_INSTALADO", async () => {
    const c = criarCliente({ ...cred(), tokensInstalacao: memoria() });
    await expect(c.empresa(9).filas.listar()).rejects.toBeInstanceOf(NucleoErro);
    await expect(c.empresa(9).filas.listar()).rejects.toMatchObject({ codigo: "ERR_APP_NAO_INSTALADO" });
  });
});
