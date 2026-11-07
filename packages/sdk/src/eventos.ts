/**
 * Webhooks de apps de parceiros: o Botzetta avisa o app de fatos da empresa
 * com um POST assinado (JWS com a chave da Plataforma, ver verificarWebhook) que leva SÓ o sinal (tipo + id); os detalhes vêm por GET na API de Plataforma.
 * Sem dependências.
 */

/**
 * Catálogo v1. `escopo` = escopo de leitura que o app precisa ter (efetivo) para receber o evento;
 * null = evento do próprio app (`app.*`), sempre entregue.
 */
export const CATALOGO_EVENTOS = {
  "app.instalado": { escopo: null, recursoTipo: "instalacao", rotulo: "App instalado em uma empresa" },
  "app.desinstalado": { escopo: null, recursoTipo: "instalacao", rotulo: "App desinstalado de uma empresa" },
  "app.escopos-alterados": { escopo: null, recursoTipo: "instalacao", rotulo: "Empresa consentiu novos escopos" },
  "pessoa.criada": { escopo: "pessoas:ler", recursoTipo: "pessoa", rotulo: "Pessoa criada" },
  "pessoa.atualizada": { escopo: "pessoas:ler", recursoTipo: "pessoa", rotulo: "Pessoa atualizada" },
  "oportunidade.criada": { escopo: "crm:ler", recursoTipo: "oportunidade", rotulo: "Oportunidade criada" },
  "oportunidade.movida": { escopo: "crm:ler", recursoTipo: "oportunidade", rotulo: "Oportunidade mudou de estágio" },
  "oportunidade.ganha": { escopo: "crm:ler", recursoTipo: "oportunidade", rotulo: "Oportunidade ganha" },
  "oportunidade.perdida": { escopo: "crm:ler", recursoTipo: "oportunidade", rotulo: "Oportunidade perdida" },
  "ticket.aberto": { escopo: "tickets:ler", recursoTipo: "ticket", rotulo: "Ticket aberto ou reaberto" },
  "ticket.transferido": { escopo: "tickets:ler", recursoTipo: "ticket", rotulo: "Ticket transferido de fila ou atendente" },
  "ticket.fechado": { escopo: "tickets:ler", recursoTipo: "ticket", rotulo: "Ticket fechado" },
  "mensagem.recebida": { escopo: "mensagens:ler", recursoTipo: "mensagem", rotulo: "Mensagem recebida do contato" },
  "mensagem.enviada": { escopo: "mensagens:ler", recursoTipo: "mensagem", rotulo: "Mensagem enviada ao contato" }
} as const satisfies Record<string, { escopo: string | null; recursoTipo: string; rotulo: string }>;

export type Evento = keyof typeof CATALOGO_EVENTOS;
export const EVENTOS = Object.keys(CATALOGO_EVENTOS) as [Evento, ...Evento[]];
/** Eventos do próprio app: entregues a todo app de parceiro com URL de webhook, inscrito ou não. */
export const EVENTOS_APP = EVENTOS.filter(e => e.startsWith("app.")) as Evento[];

/**
 * Evento de teste enviado pelo portal do desenvolvedor ("Enviar evento de teste"): mesmo
 * formato e mesma assinatura, `companyId` da sua sandbox e `recurso: { tipo: "teste", id: 0 }`.
 * Não faz parte do catálogo (não se assina) e não é reenviado: responda 2xx e ignore.
 */
export const EVENTO_TESTE_WEBHOOK = "webhook.teste";

/** Corpo do POST (versão 1). Deduplique pelo `id`: a entrega é "pelo menos uma vez" e sem ordem garantida. */
export interface EventoWebhook {
  /** evt_<uuid>: igual em todas as tentativas e no reenvio. */
  id: string;
  /** Evento do catálogo ou, só no teste do portal, `webhook.teste`. */
  evento: Evento | typeof EVENTO_TESTE_WEBHOOK;
  versao: "1";
  companyId: number;
  recurso: { tipo: string; id: number };
  /** Só ids relacionados (ex.: ticketId e contatoId em mensagem.*). Nunca dado pessoal. */
  contexto?: Record<string, number | number[] | string[] | null>;
  /** ISO 8601. Use para ordenar. */
  ocorridoEm: string;
}

/** Cabeçalhos do POST do webhook (sem o prefixo X-). */
export const CABECALHO_ASSINATURA = "botzetta-assinatura";
export const CABECALHO_EVENTO = "botzetta-evento";
export const CABECALHO_ENTREGA = "botzetta-entrega";
/** `typ` do JWT de Botzetta-Assinatura e `tipo` nas claims. */
export const TYP_ASSINATURA_WEBHOOK = "botzetta-webhook+jwt";
/** Vida da assinatura (exp − iat) e tolerância padrão do receptor: 5 min. */
export const TOLERANCIA_WEBHOOK_SEGUNDOS = 300;
