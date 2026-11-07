# @botzetta/sdk-frame

SDK da página de um app de parceiro **dentro do iframe do Botzetta**. Faz o handshake com o host (protocolo `postMessage` `frame/1`), entrega o contexto (empresa, usuário, tema e token) e expõe as ações que o host oferece à página.

ESM, sem dependências, funciona com qualquer framework (ou nenhum).

## Instalação

```bash
npm i @botzetta/sdk-frame
```

## Uso

```ts
import { iniciarFrame, ErroFrame } from "@botzetta/sdk-frame";
import "@botzetta/sdk-frame/tema.css"; // opcional: cores do Botzetta, claro e escuro

try {
  // Só aceita mensagens do window.parent vindas destas origens.
  const botzetta = await iniciarFrame({ origensHost: ["https://app.botzetta.com.br"] });

  const ctx = botzetta.obterContexto(); // { empresa, usuario, tema, rota, app, token, expiraEm, extensao? }

  // Token "usuario" para o backend do seu app. O host renova quando falta menos de 30 s.
  const token = await botzetta.obterToken();
  await fetch("/api/minha-rota", { headers: { Authorization: `Bearer ${token}` } });

  if (await botzetta.confirmar({ titulo: "Excluir nota", mensagem: "Tem certeza?", destrutivo: true })) {
    await botzetta.toast("Nota excluída", "sucesso");
  }

  botzetta.aoMudarTema(tema => console.log("tema", tema));
} catch (e) {
  if (e instanceof ErroFrame && e.codigo === "ERR_FRAME_FORA_DO_HOST") {
    // a página foi aberta fora do Botzetta
  }
}
```

**O token e o contexto não são autorização.** Valide o token `usuario` no backend do app (assinatura pelo JWKS do Botzetta) antes de confiar nele.

## API

| Método | O que faz |
|---|---|
| `iniciarFrame({ origensHost, timeoutMs? })` | Conecta ao host e resolve com o cliente. Rejeita com `ErroFrame` se a página não estiver num iframe ou se o host não responder (padrão 10 s) |
| `obterContexto()` | Empresa, usuário, tema, rota, app e, em extensões, os dados do ponto de extensão |
| `obterToken()` | Token `usuario` válido |
| `navegar(caminho)` | Abre um caminho do Botzetta (ex.: `"/pessoas/42"`) |
| `abrirPessoa(id)` | Abre o cadastro da pessoa |
| `toast(mensagem, tipo?)` | Aviso no host: `sucesso`, `erro`, `aviso` ou `info` |
| `confirmar(opcoes)` | Diálogo de confirmação do host; resolve `true` ou `false` |
| `redimensionar(altura?)` | Ajusta a altura do iframe (só em extensões) |
| `informarRota(caminho)` | Atualiza a URL do host sem recarregar o iframe |
| `fechar()` | Fecha o diálogo (só em extensões) |
| `aoMudarTema(fn)` / `aoRenovarToken(fn)` | Ouvintes; devolvem a função que cancela |
| `encerrar()` | Remove o listener de mensagens |

Erros chegam como `ErroFrame`, com `codigo` (`ERR_FRAME_TIMEOUT`, `ERR_FRAME_PARAMETRO`, `ERR_FRAME_FORA_DO_HOST`…).

## Tema

`@botzetta/sdk-frame/tema.css` define as variáveis de cor do Botzetta (`--background`, `--primary`, `--border`…) para o tema claro (`:root`) e o escuro (`.dark`). O SDK põe e tira a classe `dark` no `<html>` conforme o tema do host. Com Tailwind v4, mapeie as variáveis num bloco `@theme inline` (ex.: `--color-primary: var(--primary)`).

## Licença

[MIT](LICENSE) © Diampi
