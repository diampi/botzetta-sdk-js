/**
 * Protocolo postMessage host ↔ iframe do parceiro (contrato "frame/1").
 * A interface do Botzetta (o host) implementa o outro lado: os dois mudam juntos.
 */

export const PROTOCOLO = "frame/1";

export type Tema = "claro" | "escuro";
export type TipoToast = "sucesso" | "erro" | "aviso" | "info";

export type MetodoFrame =
  | "token"
  | "navegar"
  | "abrirPessoa"
  | "toast"
  | "confirmar"
  | "redimensionar"
  | "informarRota"
  | "fechar";

export type CodigoErroFrame =
  | "ERR_FRAME_PARAMETRO"
  | "ERR_FRAME_METODO"
  | "ERR_FRAME_OCUPADO"
  | "ERR_FRAME_LIMITE"
  | "ERR_FRAME_INDISPONIVEL"
  | "ERR_FRAME_TIMEOUT"
  | "ERR_FRAME_PROTOCOLO"
  | "ERR_FRAME_FORA_DO_HOST"
  | "ERR_FRAME_CONFIG"
  | "ERR_FRAME_ENCERRADO";

/** Ids do ticket aberto (extensão "ticket.acoes"). Contexto, não autorização: reconfira pela API. */
export interface TicketDaExtensao {
  id: number;
  contatoId: number;
  whatsappId?: number | null;
  filaId?: number | null;
  usuarioId?: number | null;
}

export interface ContextoFrame {
  protocolo: typeof PROTOCOLO;
  /** Token "usuario" (aud app:<slug>, 10 min). Valide no backend do app (assinatura pelo JWKS do Botzetta) antes de confiar nele. */
  token: string;
  /** ISO 8601. */
  expiraEm: string;
  app: { slug: string; versao: string };
  empresa: { id: number; nome: string };
  usuario: { id: number; nome: string };
  tema: Tema;
  /** Caminho relativo à rotaBase que o host abriu (ex.: "notas/1?x=2"). */
  rota: string;
  extensao?: { ponto: "ticket.acoes"; id: string; ticket: TicketDaExtensao };
}

export interface Envelope {
  botzetta: typeof PROTOCOLO;
  tipo: "pronto" | "contexto" | "pedido" | "resposta" | "evento";
  id?: string;
  dados?: unknown;
}

export function ehEnvelope(v: unknown): v is Envelope {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    e.botzetta === PROTOCOLO &&
    typeof e.tipo === "string" &&
    ["pronto", "contexto", "pedido", "resposta", "evento"].includes(e.tipo) &&
    (e.id === undefined || typeof e.id === "string")
  );
}

export class ErroFrame extends Error {
  constructor(
    public readonly codigo: CodigoErroFrame,
    mensagem: string
  ) {
    super(mensagem);
    this.name = "ErroFrame";
  }
}
