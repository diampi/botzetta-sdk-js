// Subcaminho "@botzetta/sdk/catalogos": constantes e catálogos da Plataforma, SEM dependências
// (pode ser importado em qualquer ambiente, inclusive no navegador). A raiz reexporta tudo.
export { PLATAFORMA_ISS, PREFIXO_API } from "./constantes";
export { ESCOPOS, CATALOGO_ESCOPOS, type Escopo, type RiscoEscopo } from "./escopos";
export {
  CATALOGO_EVENTOS,
  EVENTOS,
  EVENTOS_APP,
  EVENTO_TESTE_WEBHOOK,
  CABECALHO_ASSINATURA,
  CABECALHO_EVENTO,
  CABECALHO_ENTREGA,
  TYP_ASSINATURA_WEBHOOK,
  TOLERANCIA_WEBHOOK_SEGUNDOS,
  type Evento,
  type EventoWebhook
} from "./eventos";
