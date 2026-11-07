# @botzetta/sdk

SDK de backend (Node 22+) para **apps de parceiros** do Botzetta: chave do app, instalação OAuth com PKCE, cliente da API de Plataforma, webhook assinado e validação do usuário que abre o app no iframe.

```bash
npm i @botzetta/sdk
```

ESM e CommonJS, com tipos. A raiz não depende de framework (Node puro, Fastify, Nest…). Quem usa Express 5 tem os middlewares em [`@botzetta/sdk/express`](#botzettasdkexpress).

Todas as URLs do Botzetta passadas ao SDK precisam ser `https://` (`http://` só para `localhost` em desenvolvimento): o JWKS da Plataforma é a raiz de confiança dos tokens e dos webhooks.

## 1. Chave do app

O app se autentica no Botzetta com a própria chave (`private_key_jwt`, RFC 7523). Nenhum segredo passa pelo portal.

```ts
import { criarChaveApp, gerarChaveApp, servirJwks } from "@botzetta/sdk";

// Uma vez: gere o par e guarde a chave privada num cofre ou variável de ambiente (nunca no código).
const { chavePrivadaPem, kid } = gerarChaveApp(); // RS256; gerarChaveApp("ES256") para EC P-256

// No servidor:
const chave = criarChaveApp({ chavePrivada: process.env.APP_CHAVE_PRIVADA!, kid: process.env.APP_CHAVE_KID! });
// GET /.well-known/jwks.json → informe esta URL como jwksUrl no portal do desenvolvedor
const jwks = servirJwks(chave); // (req, res) do node:http
```

`chavePrivada` aceita PEM, PEM em base64 (cabe numa linha do `.env`), JWK privada ou `KeyObject`. RSA precisa ter ao menos 2048 bits.

## 2. Instalação (OAuth com PKCE)

```ts
import { gerarPkce, gerarState, montarUrlInstalacao, trocarCodigo } from "@botzetta/sdk";

// GET /botzetta/instalar (a "URL de instalação" cadastrada no portal)
const { verifier, challenge } = gerarPkce();
const state = gerarState(); // guarde verifier + state na sessão do navegador
const url = montarUrlInstalacao({ urlHost: "https://app.botzetta.com.br", clientId: "meuapp", redirectUri, state, codeChallenge: challenge });

// GET /botzetta/callback?code=...&state=... (confira o state antes)
const tokens = await trocarCodigo({ url: NUCLEO_URL, clientId: "meuapp", chave }, { code, redirectUri, codeVerifier: verifier });
await meuBanco.salvar(tokens.companyId, tokens); // cifrado
```

`renovarToken` e `revogarToken` completam o ciclo (`revogarToken` nunca lança: devolve `false` em falha, para você tentar de novo). O refresh é **rotativo**: reusar um refresh já usado revoga a instalação inteira, por isso salve sempre o par novo antes de usá-lo (o `criarCliente` faz isso por você).

## 3. Cliente da API

```ts
import { criarCliente, type ArmazenamentoTokens } from "@botzetta/sdk";

const tokensInstalacao: ArmazenamentoTokens = {
  obter: companyId => meuBanco.obter(companyId), // TokensInstalacao | null
  salvar: (companyId, tokens) => meuBanco.salvar(companyId, tokens)
};
const botzetta = criarCliente({ url: NUCLEO_URL, clientId: "meuapp", chave, tokensInstalacao });

const pessoa = await botzetta.empresa(companyId).pessoas.obter(42);
await botzetta.empresa(companyId).mensagens.enviar(
  { whatsappId: 1, destino: { pessoaId: 42 }, conteudo: { texto: "Olá!" } },
  { idempotencyKey: `boas-vindas-${pessoa.id}` } // repetir a chave nunca reenvia
);
```

Cada chamada usa o token da instalação daquela empresa, renovado sozinho 60 s antes de expirar, com um refresh por vez **dentro do processo**. Com várias instâncias do app, duas podem tentar renovar juntas: o Botzetta tolera o reuso do refresh por alguns segundos e o cliente usa o par que a outra instância salvou, mas o mais seguro é serializar a renovação por empresa (ex.: um lock no seu banco dentro de `salvar`/`obter`). Leituras e escritas idempotentes são repetidas em 5xx, timeout ou falha de rede. Erros chegam como `NucleoErro` (`codigo`, `status`, `requestId`, `tentarDeNovo`, `final`, `assinaturaBloqueada`).

Recursos: `pessoas`, `contatos`, `whatsapps`, `filas`, `tags`, `templates`, `usuarios`, `mensagens`, `midias`, `realtime`, `notificacoes`, `camposPersonalizados`, `crm` (pipelines e oportunidades), `tickets` e `historico`. Os tipos de cada resposta são exportados (`PessoaDetalhe`, `Oportunidade`, `Ticket`…).

`criarClienteBase` (avançado) monta o mesmo cliente com outra origem de token (ex.: testes ou um cofre de tokens próprio).

## 4. Webhook

```ts
import { verificarWebhook, CABECALHO_ASSINATURA, CABECALHO_ENTREGA, EVENTO_TESTE_WEBHOOK } from "@botzetta/sdk";

const evento = await verificarWebhook({
  corpo, // Buffer/string CRU, os mesmos bytes que chegaram
  assinatura: req.headers[CABECALHO_ASSINATURA],
  entrega: req.headers[CABECALHO_ENTREGA],
  slug: "meuapp",
  jwksUrl: `${NUCLEO_URL}/plataforma/v1/.well-known/jwks.json`
});
if (evento.evento !== EVENTO_TESTE_WEBHOOK) await processar(evento); // deduplique por evento.id
```

A assinatura é um JWT RS256 da Plataforma que liga o corpo pelo hash, com validade de 5 minutos. Assinatura ausente, de outro app, expirada ou com corpo adulterado vira `AppError` 401 `ERR_WEBHOOK_ASSINATURA_INVALIDA`. O evento traz só o sinal (tipo + id): busque os detalhes com o cliente. Catálogo em `CATALOGO_EVENTOS`.

## 5. Usuário da página do app

A página do app (no iframe, com [`@botzetta/sdk-frame`](../sdk-frame)) manda o token "usuario" no `Authorization`. Valide no backend:

```ts
import { criarVerificadorUsuario, tokenDoCabecalho, escritaBloqueada } from "@botzetta/sdk";

const verificarUsuario = criarVerificadorUsuario({ slug: "meuapp", nucleoUrl: NUCLEO_URL });

const usuario = await verificarUsuario(tokenDoCabecalho(req.headers.authorization));
// { usuarioId, companyId, perfil, acessos, nivel } — use SEMPRE este companyId
const bloqueio = req.method !== "GET" ? escritaBloqueada(usuario.nivel) : null; // empresa em paywall/bloqueio
```

O token é conferido pelo JWKS da Plataforma (`aud` = `app:<slug>`), e perfil, acessos e nível vêm da sessão atual no Botzetta (cache de 30 s por token): um acesso retirado deixa de valer em até 30 s. Se o Botzetta estiver fora do ar, o último valor bom vale por até 2 min; sem ele, a resposta é 503 (falha fechada). Exemplo completo sem framework: [`exemplos/node-puro`](../../exemplos/node-puro/servidor.mjs).

## `@botzetta/sdk/express`

Middlewares para Express 5 (`express` é peer opcional; instale também `@types/express` se usar TypeScript).

```ts
import { autenticarUsuario, contextoUsuario, servirJwks, tratarErros } from "@botzetta/sdk/express";

app.get("/.well-known/jwks.json", servirJwks(chave));
app.use("/api", autenticarUsuario({ slug: "meuapp", nucleoUrl: NUCLEO_URL })); // recusa escrita em paywall
app.get("/api/eu", (req, res) => {
  const { companyId, userId } = contextoUsuario(req);
  res.json({ companyId, userId });
});
app.use(tratarErros()); // por último: responde { error, message }; falhas da API do Botzetta viram 502
```

Exemplo completo (iframe + backend + instalação + webhook): [`exemplos/parceiro`](../../exemplos/parceiro).

## Erros

| Classe | Quando | Formato |
|---|---|---|
| `AppError` | Validações do SDK (token, webhook, sessão) e do seu app | `{ error: codigo, message }` com `status` |
| `NucleoErro` | Resposta de erro da API do Botzetta ou falha de rede (`status` 0) | idem, com `requestId` |

## Catálogos

`CATALOGO_ESCOPOS` (rótulo e risco de cada escopo), `CATALOGO_EVENTOS`, `PLATAFORMA_ISS` e `PREFIXO_API` também saem em `@botzetta/sdk/catalogos`, sem nenhuma dependência.

## Licença

[MIT](LICENSE)
