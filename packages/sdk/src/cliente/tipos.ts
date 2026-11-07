/**
 * DTOs da API de Plataforma 1.x.
 * Mudança incompatível aqui só em versão major do pacote.
 */

export interface Paginado<T> {
  dados: T[];
  pagina: number;
  porPagina: number;
  total: number;
}

export interface ListarPessoasParams {
  ids?: number[];
  busca?: string;
  tags?: number[];
  pagina?: number;
  porPagina?: number;
}

export interface PessoaResumo {
  id: number;
  nome: string;
  nomeFantasia: string | null;
  dataNascimento: string | null;
  sexo: string | null;
  ativo: boolean;
  optOut: boolean;
}

export interface Pessoa extends PessoaResumo {
  contatosWhatsapp: { numero: string; origem: "crm" | "atendimento" }[];
}

export interface FiltrosAniversariante {
  tagIds?: number[];
  sexo?: string[];
  idadeMin?: number | null;
  idadeMax?: number | null;
  estado?: string | null;
  cidade?: string | null;
  pessoasIncluir?: number[];
  pessoasExcluir?: number[];
}

export interface BuscaAniversariantes {
  dia: number;
  mes: number;
  filtros?: FiltrosAniversariante;
}

export interface Aniversariante {
  id: number;
  nome: string;
  dataNascimento: string;
  contatoWhatsapp: string;
  /** Pediu para não receber mensagens: o envio será recusado com ERR_DESTINO_OPT_OUT. */
  optOut?: boolean;
}

export interface PreviaAniversariantes {
  total: number;
  /** Quantas das pessoas do total têm opt-out e não vão receber. */
  totalOptOut?: number;
  amostra: { id: number; nome: string }[];
}

export interface Whatsapp {
  id: number;
  nome: string;
  tipo: "baileys" | "meta" | string;
  status: string;
  canal: string | null;
  padrao: boolean;
}

/** Tag de pessoa (GET /tags, escopo pessoas:ler). */
export interface Tag {
  id: number;
  nome: string;
  cor: string | null;
}

export interface Fila {
  id: number;
  nome: string;
  cor: string | null;
}

export interface Template {
  id: number;
  whatsappId: number;
  nome: string;
  idioma: string;
  categoria: string | null;
  status: string;
  componentes: unknown[];
}

/** Contato do atendimento (GET /contatos, escopo contatos:ler). Inclui grupos. */
export interface Contato {
  id: number;
  nome: string;
  /** Só dígitos; em grupo é o id do grupo (JID sem @g.us). */
  numero: string;
  grupo: boolean;
  pessoaId: number | null;
  /** A pessoa vinculada pediu para não receber mensagens (o envio será recusado). Grupo: sempre false. */
  optOut: boolean;
  fotoUrl: string | null;
}

export interface ListarContatosParams {
  ids?: number[];
  busca?: string;
  pagina?: number;
  porPagina?: number;
}

export interface Usuario {
  id: number;
  nome: string;
  perfil: string;
}

export interface EnviarMensagem {
  whatsappId: number;
  /** { contatoId }: contato do atendimento, inclusive grupo; único destino que aceita `ticket`. */
  destino: { pessoaId: number } | { numero: string } | { contatoId: number };
  conteudo: {
    texto?: string | null;
    templateId?: number | null;
    parametros?: Record<string, string | number> | null;
    /** No máximo 1 mídia. */
    midiaIds?: number[] | null;
  };
  usuarioId?: number | null;
  /**
   * 1.1, só com destino { contatoId }: abre (ou reaproveita o aberto/pendente) o ticket do contato na conexão,
   * aplica as variáveis do ticket ({{firstName}}, {{ms}}, {{queue}}...) e registra a mensagem na conversa.
   */
  ticket?: { abrir: boolean; filaId?: number | null; usuarioId?: number | null; status?: "open" | "closed" | "pending" } | null;
  /** 1.1: prefixa "*Nome do usuário:*" (assinatura do v1). Só com `ticket.abrir`. */
  assinarComoUsuarioId?: number | null;
}

export interface MensagemEnviada {
  whatsappMensagemId: string;
  status: "enviada";
  /** 1.1: ticket usado quando `ticket.abrir`. */
  ticketId?: number | null;
}

/**
 * Mídia do núcleo. `id` é a referência oficial (envio, exclusão, LGPD, checagem de empresa).
 * `url` é permanente: o app guarda `id` + cópia de url/nome/tipo/tamanho para exibir sem chamar o
 * núcleo, mas nunca usa a URL como referência.
 */
export interface Midia {
  id: number;
  nomeOriginal: string;
  tipoMime: string;
  tamanho: number;
  /** URL permanente. */
  url: string;
  /** @deprecated Sempre `null` (a URL não expira). Sai na próxima versão major. */
  urlExpiraEm: string | null;
}

export interface EnviarMidia {
  conteudo: Blob | Uint8Array;
  nome: string;
  tipoMime: string;
  entidadeId?: number;
}

export interface Notificacao {
  titulo: string;
  mensagem: string;
  referencia?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// API ampliada: pessoas (escrita), CRM, tickets e histórico.
// ---------------------------------------------------------------------------

/** Valor de campo personalizado (GET /pessoas/:id, PUT /pessoas/:id/campos). */
export interface CampoValor {
  campoId: number;
  nome: string;
  valor: unknown;
}

/** GET /pessoas/:id traz também tags, campos e status do cadastro. */
export interface PessoaDetalhe extends Pessoa {
  statusCadastro: "rascunho" | "incompleto" | "completo";
  tags: Tag[];
  campos: CampoValor[];
}

export interface DadosPessoa {
  natureza?: "PF" | "PJ";
  nome?: string;
  nomeFantasia?: string | null;
  /** AAAA-MM-DD */
  dataNascimento?: string | null;
  sexo?: "M" | "F" | "O" | null;
  observacao?: string | null;
}

export interface CriarPessoa extends DadosPessoa {
  natureza: "PF" | "PJ";
  nome: string;
  /** WhatsApp já usado por outra pessoa → 409 ERR_CONTATO_EXISTENTE (nunca deduplica). */
  contatos?: { tipo: "whatsapp" | "celular" | "telefone_residencial" | "telefone_comercial" | "email"; valor: string }[];
  tags?: number[];
  campos?: { campoId: number; valor: unknown }[];
}

export interface CampoPersonalizado {
  id: number;
  nome: string;
  rotulo: string;
  tipo: string;
  obrigatorio: boolean;
  opcoes: unknown[] | null;
}

export interface EstagioPipeline {
  id: number;
  nome: string;
  ordem: number;
  cor: string | null;
  tipo: "padrao" | "ganho" | "perda";
  ativo: boolean;
}

export interface Pipeline {
  id: number;
  nome: string;
  descricao: string | null;
  estagios: EstagioPipeline[];
}

export type ResultadoOportunidade = "aberta" | "ganha" | "perdida";

export interface Oportunidade {
  id: number;
  titulo: string;
  descricao: string | null;
  pessoaId: number;
  pipelineId: number;
  estagioId: number;
  tipoId: number | null;
  responsavelId: number | null;
  valor: number | null;
  probabilidade: number | null;
  prioridade: string | null;
  resultado: ResultadoOportunidade;
  ganhaEm: string | null;
  perdidaEm: string | null;
  motivoPerdaId: number | null;
  perdaObservacao: string | null;
  ativo: boolean;
  criadoEm: string;
  atualizadoEm: string;
}

export interface ListarOportunidadesParams {
  pipelineId?: number;
  estagioId?: number;
  pessoaId?: number;
  resultado?: ResultadoOportunidade;
  /** ISO 8601 */
  atualizadoDesde?: string;
  pagina?: number;
  porPagina?: number;
}

export interface DadosOportunidade {
  titulo?: string;
  descricao?: string | null;
  valor?: number | null;
  probabilidade?: number | null;
  prioridade?: string | null;
  responsavelId?: number | null;
  tipoId?: number;
}

export interface CriarOportunidade extends DadosOportunidade {
  pessoaId: number;
  pipelineId: number;
  estagioId: number;
  tipoId: number;
  titulo: string;
}

export interface ItemSimples {
  id: number;
  nome: string;
}

export type StatusTicket = "open" | "pending" | "closed";

/** Ticket sem a última mensagem (conteúdo de conversa é mensagens:ler). */
export interface Ticket {
  id: number;
  uuid: string;
  status: string;
  contatoId: number | null;
  pessoaId: number | null;
  filaId: number | null;
  usuarioId: number | null;
  whatsappId: number | null;
  canal: string | null;
  naoLidas: number;
  criadoEm: string;
  atualizadoEm: string;
}

export interface ListarTicketsParams {
  status?: StatusTicket;
  filaId?: number;
  contatoId?: number;
  pessoaId?: number;
  usuarioId?: number;
  whatsappId?: number;
  atualizadoDesde?: string;
  pagina?: number;
  porPagina?: number;
}

export interface NotaTicket {
  id: number;
  ticketId: number;
  texto: string;
  /** `chave`: nota feita por uma chave de integração da empresa. */
  autor:
    | { tipo: "app"; slug: string }
    | { tipo: "usuario"; usuarioId: number }
    | { tipo: "chave"; chaveId: number; nome: string };
  criadoEm: string;
}

export interface TransferirTicket {
  filaId?: number;
  usuarioId?: number;
  /** Sem `mensagem`, nada é enviado ao cliente. */
  mensagem?: string;
}

export interface Mensagem {
  id: number;
  ticketId: number;
  contatoId: number | null;
  deMim: boolean;
  tipo: string;
  texto: string | null;
  transcricao: string | null;
  midiaId: number | null;
  ack: number | null;
  interna: boolean;
  editada: boolean;
  encaminhada: boolean;
  citadaId: number | null;
  criadoEm: string;
}

/** Página por cursor (histórico de mensagens): o cursor é opaco, só repasse. */
export interface PaginaCursor<T> {
  dados: T[];
  proximoCursor: string | null;
}

export interface HistoricoParams {
  cursor?: string;
  /** Padrão 50, máximo 200. */
  limite?: number;
}
