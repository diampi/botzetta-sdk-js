/** Códigos de bloqueio por assinatura (empresa com pagamento pendente) devolvidos em escrita/envio. */
export const ERROS_ASSINATURA = ["ERR_ASSINATURA_VENCIDA", "ERR_ASSINATURA_BLOQUEADA"] as const;

/** Erro devolvido pela API de Plataforma do núcleo (ou falha de rede/timeout ao chamá-la). */
export class NucleoErro extends Error {
  public readonly codigo: string;
  public readonly status: number;
  public readonly requestId: string | null;

  constructor(codigo: string, mensagem: string, status: number, requestId: string | null = null) {
    super(mensagem);
    this.name = "NucleoErro";
    this.codigo = codigo;
    this.status = status;
    this.requestId = requestId;
  }

  /** Vale tentar de novo mais tarde? (409 conexão desconectada / em andamento, 429, 5xx, rede). */
  get tentarDeNovo(): boolean {
    return this.status === 0 || this.status === 409 || this.status === 429 || this.status >= 500;
  }

  /** Resultado definitivo: não adianta tentar de novo (ex.: opt-out, assinatura vencida, canal não suportado). */
  get final(): boolean {
    return !this.tentarDeNovo;
  }

  /** Bloqueio por assinatura (paywall/total): escrita e envio recusados até regularizar. */
  get assinaturaBloqueada(): boolean {
    return (ERROS_ASSINATURA as readonly string[]).includes(this.codigo);
  }

  toJSON(): { error: string; message: string } {
    return { error: this.codigo, message: this.message };
  }
}
