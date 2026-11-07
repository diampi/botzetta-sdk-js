// @botzetta/sdk — SDK de backend (Node) para apps de parceiros da Plataforma de Apps do Botzetta.
// Raiz sem framework. Com Express, veja também "@botzetta/sdk/express".

export { AppError } from "./erros/AppError";
export { NucleoErro, ERROS_ASSINATURA } from "./erros/NucleoErro";
export * from "./catalogos";

// Chave do app (private_key_jwt) e JWKS público do app
export {
  criarChaveApp,
  gerarChaveApp,
  servirJwks,
  urlTokenEndpoint,
  camposAssertion,
  TIPO_CLIENT_ASSERTION,
  ASSERTION_TTL_MAX_SEGUNDOS,
  type ChaveApp,
  type OpcoesChaveApp,
  type CredenciaisApp,
  type JwkPublica,
  type AlgoritmoChave,
  type RespostaHttp
} from "./chave";

// Instalação OAuth (PKCE) e tokens de instalação
export {
  gerarPkce,
  gerarState,
  montarUrlInstalacao,
  trocarCodigo,
  renovarToken,
  revogarToken,
  type TokensInstalacao,
  type ArmazenamentoTokens,
  type CredenciaisOAuth
} from "./oauth";

// Webhook assinado
export { verificarWebhook, hashCorpoWebhook, type OpcoesVerificarWebhook, type WebhookVerificado } from "./webhook";

// Usuário da página do app (token "usuario" + sessão)
export {
  verificarUsuario,
  criarVerificadorUsuario,
  tokenDoCabecalho,
  escritaBloqueada,
  type OpcoesVerificarUsuario,
  type UsuarioVerificado
} from "./usuario";
// criarVerificador (JWKS genérico, sem conferir o `tipo` do token) e o resolvedor de sessão ficam
// internos: o parceiro valida com verificarUsuario/verificarWebhook, que conferem o tipo.
export { limparCacheSessao, type SessaoUsuario, type NivelBloqueio } from "./sessao";

// Cliente da API de Plataforma
export { criarCliente, type OpcoesCliente, type Cliente } from "./cliente/instalacao";
export {
  criarClienteBase,
  type OpcoesClienteBase,
  type ClienteBase,
  type ClienteEmpresa,
  type ContextoChamada,
  type LoggerCliente
} from "./cliente/base";
export type * from "./cliente/tipos";
