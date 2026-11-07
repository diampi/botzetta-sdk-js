/**
 * Escopos da API de Plataforma 1.x: o que o app pede no manifesto e o admin da empresa consente
 * na instalação. Sem dependências.
 */
export const ESCOPOS = [
  "pessoas:ler",
  "contatos:ler",
  "whatsapps:ler",
  "filas:ler",
  "templates:ler",
  "usuarios:ler",
  "mensagens:enviar",
  "midias:ler",
  "midias:escrever",
  "realtime:emitir",
  "notificacoes:enviar",
  // API ampliada
  "pessoas:escrever",
  "crm:ler",
  "crm:escrever",
  "tickets:ler",
  "tickets:escrever",
  "mensagens:ler"
] as const;

export type Escopo = (typeof ESCOPOS)[number];

export type RiscoEscopo = "baixo" | "medio" | "alto";

/**
 * Rótulo em português e risco de cada escopo, como aparecem na tela de consentimento da instalação.
 * Risco "alto" = envio em nome da empresa ou leitura de conversas.
 */
export const CATALOGO_ESCOPOS: Record<Escopo, { rotulo: string; risco: RiscoEscopo }> = {
  "pessoas:ler": { rotulo: "Ver pessoas e seus contatos", risco: "medio" },
  "contatos:ler": { rotulo: "Ver contatos do atendimento (inclusive grupos)", risco: "medio" },
  "whatsapps:ler": { rotulo: "Ver as conexões de WhatsApp", risco: "baixo" },
  "filas:ler": { rotulo: "Ver as filas de atendimento", risco: "baixo" },
  "templates:ler": { rotulo: "Ver os templates de mensagem", risco: "baixo" },
  "usuarios:ler": { rotulo: "Ver nome e perfil dos usuários", risco: "baixo" },
  "mensagens:enviar": { rotulo: "Enviar mensagens de WhatsApp em nome da empresa", risco: "alto" },
  "midias:ler": { rotulo: "Ver arquivos e mídias", risco: "medio" },
  "midias:escrever": { rotulo: "Enviar e apagar arquivos e mídias do app", risco: "medio" },
  "realtime:emitir": { rotulo: "Atualizar as telas em tempo real", risco: "baixo" },
  "notificacoes:enviar": { rotulo: "Enviar notificações aos usuários", risco: "baixo" },
  "pessoas:escrever": { rotulo: "Criar e editar pessoas, tags, campos personalizados e opt-out", risco: "medio" },
  "crm:ler": { rotulo: "Ver pipelines, etapas e oportunidades", risco: "medio" },
  "crm:escrever": { rotulo: "Criar, mover e encerrar oportunidades", risco: "medio" },
  "tickets:ler": { rotulo: "Ver os atendimentos (tickets)", risco: "medio" },
  "tickets:escrever": { rotulo: "Anotar, transferir e fechar atendimentos", risco: "medio" },
  "mensagens:ler": { rotulo: "Ler o histórico das conversas", risco: "alto" }
};
