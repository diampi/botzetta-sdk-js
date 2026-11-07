/**
 * Erro de negócio dos apps. Serializado como { error: codigo, message: mensagem }
 * (mesmo formato da API de Plataforma e do AppError do núcleo).
 */
export class AppError extends Error {
  public readonly codigo: string;
  public readonly status: number;

  constructor(codigo: string, mensagem?: string, status = 400) {
    super(mensagem ?? codigo);
    this.name = "AppError";
    this.codigo = codigo;
    this.status = status;
  }

  toJSON(): { error: string; message: string } {
    return { error: this.codigo, message: this.message };
  }
}
