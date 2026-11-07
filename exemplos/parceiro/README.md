# Exemplo: app de parceiro (iframe + backend)

Ponto de partida para um app de **parceiro** do Botzetta. A tela abre **dentro do Botzetta**, num iframe sandbox na **sua** origem, e o backend roda na **sua** infraestrutura. Usa só os pacotes públicos: [`@botzetta/sdk`](../../packages/sdk) no backend e [`@botzetta/sdk-frame`](../../packages/sdk-frame) na página.

```
Host do Botzetta (/apps/meuapp/...)          Sua página (iframe)                Seu backend
  ── contexto (token "usuario") ──postMessage──► iniciarFrame()
                                                  fetch /api/eu  (Bearer token) ──► autenticarUsuario()
                                                                                     JWKS + GET /sessao do Botzetta
```

Sem Express? Veja [`exemplos/node-puro`](../node-puro/servidor.mjs): o mesmo backend com `node:http` e a raiz do `@botzetta/sdk`.

## Começar

1. Copie esta pasta e troque `meuapp` pelo seu slug (`botzetta-app.json` e `.env`).
2. `cp .env.exemplo .env` e preencha `BOTZETTA_HOST_URL` (origem do host que enquadra a página), `NUCLEO_URL` e `APP_SLUG`.
3. `npm install`, depois `npm run gerar-chave` e copie `APP_CHAVE_KID` e `APP_CHAVE_PRIVADA` para o `.env` (nunca versione a chave privada).
4. `npm run build && npm start` (página e API na porta 4300).
5. No **portal do desenvolvedor**: crie o app, informe o `jwksUrl` `<seu domínio>/.well-known/jwks.json`, a redirect URI `<seu domínio>/botzetta/callback`, a **URL de instalação** `<seu domínio>/botzetta/instalar` e a URL do webhook `<seu domínio>/botzetta/webhook`; preencha o rascunho (URL do iframe = URL base da página) e publique a versão. Coloque `BOTZETTA_REDIRECT_URI` no `.env` (o `client_id` é o slug).
6. "Testar na sandbox" (portal) abre `/botzetta/instalar`: entre no Botzetta com o usuário da sua sandbox e autorize. O callback troca o código pelos tokens da empresa (aqui, guardados em memória: troque pelo seu banco, cifrado). O menu do manifesto aparece no Botzetta e abre `<webUrl>/<rota>`.

## O que o backend usa (`@botzetta/sdk`)

| Função | Uso |
|---|---|
| `criarChaveApp`, `servirJwks` | Chave do app (`private_key_jwt`) e o `/.well-known/jwks.json` com a parte pública |
| `gerarPkce`, `gerarState`, `montarUrlInstalacao`, `trocarCodigo` | Instalação OAuth com PKCE |
| `criarCliente` | Chamadas à API em nome de uma empresa, com renovação automática do token da instalação |
| `verificarWebhook` | Confere a assinatura do webhook (corpo cru) |
| `autenticarUsuario`, `contextoUsuario`, `tratarErros` (`/express`) | Valida o token da página e devolve `{ error, message }` |

## O que a página pode fazer (`@botzetta/sdk-frame`)

| Método | Uso |
|---|---|
| `iniciarFrame({ origensHost })` | Conecta ao host. As origens do Botzetta são obrigatórias |
| `obterContexto()` | `token`, `empresa`, `usuario`, `tema`, `rota`, `extensao?` |
| `obterToken()` | Token "usuario" válido (o host renova). Mande no `Authorization` da sua API |
| `navegar("/pessoas")`, `abrirPessoa(42)` | Navega no Botzetta |
| `toast(msg, tipo)`, `confirmar({ titulo, mensagem })` | Avisos e confirmação do host (`alert`/`confirm` nativos são bloqueados) |
| `informarRota("notas/2")` | Atualiza a URL do Botzetta sem recarregar o iframe |
| `redimensionar()`, `fechar()` | Em extensões (diálogo no ticket) |
| `aoMudarTema(fn)`, `aoRenovarToken(fn)` | Eventos |

`tema.css` traz as cores do Botzetta (claro e escuro; a classe `.dark` é aplicada sozinha).

## Obrigações

- Validar o token **no backend** (`autenticarUsuario` ou `verificarUsuario`) e usar a empresa do token, nunca uma vinda do navegador.
- Enviar `Content-Security-Policy: frame-ancestors <origens do Botzetta>` (o `server.ts` já faz).
- Não guardar o token em `localStorage`: peça com `obterToken()`.
- Guardar os tokens de instalação cifrados e salvar o par novo **antes** de usá-lo (o refresh é rotativo).
- O iframe roda com `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"`: sem navegação do topo e sem `alert`/`confirm`.
