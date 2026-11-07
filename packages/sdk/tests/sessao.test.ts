import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarResolvedorSessao, limparCacheSessao, type SessaoUsuario } from "../src/sessao";

const SESSAO: SessaoUsuario = { usuarioId: 3, companyId: 7, perfil: "user", acessos: ["exemplo.view"], nivel: "nenhum" };

const resposta = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

/** fetch falso: devolve as respostas em ordem; a última se repete. */
function fetchFalso(...respostas: (Response | Error)[]) {
  const fila = [...respostas];
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const prox = fila.length > 1 ? fila.shift()! : fila[0]!;
    if (prox instanceof Error) throw prox;
    return prox.clone();
  });
}

const resolvedor = (f: ReturnType<typeof fetchFalso>, ttlMs?: number) =>
  criarResolvedorSessao({ nucleoUrl: "https://nucleo.teste/", ttlMs, fetch: f as unknown as typeof fetch });

beforeEach(() => {
  limparCacheSessao();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-22T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("criarResolvedorSessao", () => {
  it("consulta GET /plataforma/v1/sessao com o token como Bearer", async () => {
    const f = fetchFalso(resposta(200, SESSAO));
    expect(await resolvedor(f)("tok-a")).toEqual(SESSAO);
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toBe("https://nucleo.teste/plataforma/v1/sessao");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok-a");
  });

  it("cache de 30 s por token; depois consulta de novo", async () => {
    const f = fetchFalso(resposta(200, SESSAO));
    const r = resolvedor(f);
    await r("tok-b");
    await r("tok-b");
    expect(f).toHaveBeenCalledTimes(1);
    await r("tok-outro");
    expect(f).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() + 30_001);
    await r("tok-b");
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("um pedido em voo por token", async () => {
    const f = fetchFalso(resposta(200, SESSAO));
    const r = resolvedor(f);
    await Promise.all([r("tok-c"), r("tok-c"), r("tok-c")]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("401 e 403 entram no cache negativo", async () => {
    const f = fetchFalso(resposta(401, { error: "ERR_TOKEN_REVOGADO", message: "Sessão encerrada." }));
    const r = resolvedor(f);
    await expect(r("tok-d")).rejects.toMatchObject({ codigo: "ERR_TOKEN_REVOGADO", status: 401 });
    await expect(r("tok-d")).rejects.toMatchObject({ codigo: "ERR_TOKEN_REVOGADO" });
    expect(f).toHaveBeenCalledTimes(1);

    const g = fetchFalso(resposta(403, { error: "ERR_APP_NAO_HABILITADO" }));
    await expect(resolvedor(g)("tok-e")).rejects.toMatchObject({ codigo: "ERR_APP_NAO_HABILITADO", status: 403 });
    const h = fetchFalso(resposta(404, {}));
    await expect(resolvedor(h)("tok-e2")).rejects.toMatchObject({ codigo: "ERR_APP_NAO_HABILITADO", status: 403 });
  });

  it("401 sem código conhecido vira ERR_TOKEN_INVALIDO", async () => {
    const f = fetchFalso(resposta(401, { error: "OUTRO" }));
    await expect(resolvedor(f)("tok-f")).rejects.toMatchObject({ codigo: "ERR_TOKEN_INVALIDO", status: 401 });
  });

  it("indisponível: usa a sessão velha por até 2 min, depois 503", async () => {
    const f = fetchFalso(resposta(200, SESSAO), new TypeError("fetch failed"));
    const r = resolvedor(f);
    await r("tok-g");
    vi.setSystemTime(Date.now() + 31_000);
    expect(await r("tok-g")).toEqual(SESSAO); // erro de rede → valor velho
    vi.setSystemTime(Date.now() + 90_000); // 121 s desde a última consulta boa
    await expect(r("tok-g")).rejects.toMatchObject({ codigo: "ERR_NUCLEO_INDISPONIVEL", status: 503 });
  });

  it("indisponível sem valor anterior → 503; 429 e 5xx contam como indisponível", async () => {
    await expect(resolvedor(fetchFalso(new TypeError("x")))("tok-h")).rejects.toMatchObject({ status: 503 });
    await expect(resolvedor(fetchFalso(resposta(429, {})))("tok-i")).rejects.toMatchObject({ status: 503 });
    await expect(resolvedor(fetchFalso(resposta(502, {})))("tok-j")).rejects.toMatchObject({ status: 503 });
  });

  it("indisponibilidade não fica em cache", async () => {
    const f = fetchFalso(resposta(503, {}), resposta(200, SESSAO));
    const r = resolvedor(f);
    await expect(r("tok-k")).rejects.toMatchObject({ status: 503 });
    expect(await r("tok-k")).toEqual(SESSAO);
  });

  it("TTL é limitado entre 5 s e 60 s", async () => {
    const f = fetchFalso(resposta(200, SESSAO));
    const r = resolvedor(f, 1);
    await r("tok-l");
    vi.setSystemTime(Date.now() + 4_000);
    await r("tok-l");
    expect(f).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 1_500);
    await r("tok-l");
    expect(f).toHaveBeenCalledTimes(2);

    const g = fetchFalso(resposta(200, SESSAO));
    const longo = resolvedor(g, 10 * 60_000);
    await longo("tok-m");
    vi.setSystemTime(Date.now() + 60_001);
    await longo("tok-m");
    expect(g).toHaveBeenCalledTimes(2);
  });

  it("nivel ausente ou desconhecido é tratado como indisponível (falha fechada)", async () => {
    await expect(resolvedor(fetchFalso(resposta(200, { ...SESSAO, nivel: undefined })))("tok-o")).rejects.toMatchObject({ status: 503 });
    await expect(resolvedor(fetchFalso(resposta(200, { ...SESSAO, nivel: "outro" })))("tok-p")).rejects.toMatchObject({ status: 503 });
  });

  it("recusa nucleoUrl em http fora do localhost", () => {
    expect(() => criarResolvedorSessao({ nucleoUrl: "http://nucleo.teste" })).toThrow(/https/);
  });

  it("resposta 200 sem acessos é tratada como indisponível", async () => {
    await expect(resolvedor(fetchFalso(resposta(200, { usuarioId: 3 })))("tok-n")).rejects.toMatchObject({ status: 503 });
  });
});
