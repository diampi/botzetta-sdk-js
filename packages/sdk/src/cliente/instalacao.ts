import { NucleoErro } from "../erros/NucleoErro";
import { renovarToken, type ArmazenamentoTokens, type CredenciaisOAuth, type TokensInstalacao } from "../oauth";
import type { ChaveApp } from "../chave";
import { criarClienteBase, type ContextoChamada, type LoggerCliente } from "./base";

export interface OpcoesCliente {
  /** Base do Botzetta, sem /plataforma/v1 (ex.: https://api.botzetta.com.br). */
  url: string;
  /** client_id = slug do app. */
  clientId: string;
  /** Chave do app (criarChaveApp): assina o client_assertion de cada renovação de token. */
  chave: ChaveApp;
  /** `aud` da assertion; padrão = token endpoint de `url`. */
  audienciaAssertion?: string;
  /**
   * Onde o app guarda o par de tokens de cada empresa (seu banco, cifrado). O cliente renova sozinho
   * 60 s antes de expirar (refresh rotativo) e salva o par novo aqui ANTES de usá-lo.
   */
  tokensInstalacao: ArmazenamentoTokens;
  /** Timeout por tentativa (padrão 10 s). */
  timeoutMs?: number;
  /** Novas tentativas em 5xx/timeout/rede (padrão 2). */
  novasTentativas?: number;
  logger?: LoggerCliente;
  /** Injetável nos testes. */
  fetch?: typeof fetch;
}

/** Token por empresa (instalação): renova 60 s antes de expirar, um refresh em voo por empresa. */
class CacheTokenInstalacao {
  private emVoo = new Map<number, Promise<string>>();

  constructor(
    private readonly armazenamento: ArmazenamentoTokens,
    private readonly cred: CredenciaisOAuth
  ) {}

  async obter(companyId: number, forcarRenovacao = false): Promise<string> {
    // Renovação em andamento neste processo: espera por ela em vez de ler o par que está sendo trocado.
    const emCurso = this.emVoo.get(companyId);
    if (emCurso) return emCurso;
    const atual = await this.armazenamento.obter(companyId);
    if (!atual) throw new NucleoErro("ERR_APP_NAO_INSTALADO", `O app não está instalado na empresa ${companyId}.`, 403);
    // Defesa contra armazenamento que devolve o par de outra empresa (chave trocada no banco do app).
    if (atual.companyId !== companyId)
      throw new NucleoErro("ERR_OAUTH_EMPRESA_DIVERGENTE", "Os tokens guardados não pertencem a esta empresa.", 403);
    if (!forcarRenovacao && new Date(atual.expiraEm).getTime() - 60_000 > Date.now()) return atual.accessToken;
    let p = this.emVoo.get(companyId);
    if (!p) {
      p = this.renovar(companyId, atual).finally(() => this.emVoo.delete(companyId));
      this.emVoo.set(companyId, p);
    }
    return p;
  }

  private async renovar(companyId: number, atual: TokensInstalacao): Promise<string> {
    try {
      const novos = await renovarToken(this.cred, atual.refreshToken);
      // O token renovado tem de ser da mesma empresa (o armazenamento é indexado por ela). Erro final
      // (403, final): o par não é salvo e a empresa precisa reinstalar o app.
      if (novos.companyId !== companyId)
        throw new NucleoErro("ERR_OAUTH_EMPRESA_DIVERGENTE", "O token renovado não pertence à empresa esperada.", 403);
      await this.armazenamento.salvar(companyId, novos);
      return novos.accessToken;
    } catch (e) {
      // Outra instância do app pode ter renovado primeiro (o Botzetta recusa o refresh já usado):
      // se o par salvo mudou, usa o novo em vez de falhar.
      if (e instanceof NucleoErro && e.codigo === "ERR_OAUTH_REFRESH_INVALIDO") {
        const salvo = await this.armazenamento.obter(companyId);
        if (salvo && salvo.refreshToken !== atual.refreshToken) return salvo.accessToken;
      }
      throw e;
    }
  }
}

/**
 * Cliente da API de Plataforma para o app de parceiro: cada chamada usa o token da instalação da
 * empresa (o token já carrega a empresa), renovado sozinho com o refresh rotativo.
 *
 *   const botzetta = criarCliente({ url, clientId: "meuapp", chave, tokensInstalacao: meuBanco });
 *   const pessoa = await botzetta.empresa(companyId).pessoas.obter(42);
 */
export function criarCliente(opcoes: OpcoesCliente) {
  if (!opcoes.tokensInstalacao) throw new Error("criarCliente: informe tokensInstalacao (onde o app guarda os tokens de cada empresa).");
  const url = opcoes.url.replace(/\/+$/, ""); // conferida (https) pelo criarClienteBase
  const timeoutMs = opcoes.timeoutMs ?? 10_000;
  const cache = new CacheTokenInstalacao(opcoes.tokensInstalacao, {
    url,
    clientId: opcoes.clientId,
    chave: opcoes.chave,
    audienciaAssertion: opcoes.audienciaAssertion,
    timeoutMs,
    fetch: opcoes.fetch
  });
  return criarClienteBase<ContextoChamada>({
    url,
    timeoutMs,
    novasTentativas: opcoes.novasTentativas,
    logger: opcoes.logger,
    fetch: opcoes.fetch,
    obterToken: (ctx, forcar) => cache.obter(ctx.companyId, forcar)
  });
}

export type Cliente = ReturnType<typeof criarCliente>;
