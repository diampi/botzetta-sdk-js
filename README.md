# Botzetta SDK para JavaScript/TypeScript

SDKs oficiais para **parceiros da Plataforma de Apps do Botzetta**: quem constrói um app que roda dentro do Botzetta e fala com a API pública.

| Pacote | Onde roda | Para quê |
|---|---|---|
| [`@botzetta/sdk`](packages/sdk) | Node 22+ | Backend do app: chave do app, instalação OAuth, cliente da API, webhook assinado e validação do usuário do iframe (com middlewares opcionais para Express) |
| [`@botzetta/sdk-frame`](packages/sdk-frame) | Navegador | Página do app dentro do iframe do Botzetta: contexto do usuário, token, tema e ações no host (protocolo `frame/1`) |

> Os pacotes ainda não estão no npm. A versão 1.0.0 sai em breve.

## Instalação

```bash
npm i @botzetta/sdk          # backend
npm i @botzetta/sdk-frame    # página no iframe
```

Sem token, sem `.npmrc` e sem conta no GitHub: os pacotes ficam no npm público.

## Exemplo rápido

Backend (valida o usuário que a página manda e recebe webhooks):

```ts
import { criarVerificadorUsuario, tokenDoCabecalho, verificarWebhook } from "@botzetta/sdk";

const verificarUsuario = criarVerificadorUsuario({ slug: "meuapp", nucleoUrl: process.env.NUCLEO_URL! });
const usuario = await verificarUsuario(tokenDoCabecalho(req.headers.authorization));
// usuario.companyId, usuario.usuarioId, usuario.acessos...
```

Página no iframe:

```ts
import { iniciarFrame } from "@botzetta/sdk-frame";
import "@botzetta/sdk-frame/tema.css";

const botzetta = await iniciarFrame({ origensHost: ["https://app.botzetta.com.br"] });
const { usuario, empresa } = botzetta.obterContexto();
await botzetta.toast(`Olá, ${usuario.nome} (${empresa.nome})`, "sucesso");
```

Detalhes nos READMEs de [`@botzetta/sdk`](packages/sdk/README.md) e [`@botzetta/sdk-frame`](packages/sdk-frame/README.md).

## Exemplos

- [`exemplos/parceiro`](exemplos/parceiro): app completo (página no iframe + backend Express com instalação OAuth, cliente da API e webhook). O CI faz build e typecheck dele com os pacotes de cada commit.
- [`exemplos/node-puro`](exemplos/node-puro/servidor.mjs): backend só com `node:http`, sem framework.

## Versionamento

Semver estrito: mudança incompatível só em versão major, com depreciação anunciada antes no CHANGELOG de cada pacote. Cada versão é publicada pelo GitHub Actions com [provenance](https://docs.npmjs.com/generating-provenance-statements), ligada ao commit deste repositório.

## Desenvolvimento

Requer Node 22 (veja `.nvmrc`).

```bash
npm ci
npm run build
npm test
npm run lint
npm run typecheck
npm run verificar:exemplo   # exemplos/parceiro com os pacotes locais (npm pack)
```

## Contribuição, dúvidas e segurança

- Bugs e dúvidas sobre o SDK: abra uma [issue](https://github.com/diampi/botzetta-sdk-js/issues).
- Pull requests: veja o [CONTRIBUTING.md](CONTRIBUTING.md).
- Vulnerabilidades: **não** abra issue; siga o [SECURITY.md](SECURITY.md).

## Licença

[MIT](LICENSE) © Diampi
