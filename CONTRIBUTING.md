# Contribuindo

Obrigado pelo interesse no SDK do Botzetta.

## Issues: abertas a todos

Use as [issues](https://github.com/diampi/botzetta-sdk-js/issues) para:

- **bug** no SDK: o que você fez, o que esperava, o que aconteceu, a versão do pacote e do Node ou navegador;
- **dúvida** sobre o uso do SDK.

Dúvidas sobre a sua conta, cobrança ou a Plataforma fora do SDK vão para o suporte do Botzetta.

**Vulnerabilidade de segurança não entra em issue.** Siga o [SECURITY.md](SECURITY.md).

## Pull requests: só do time do Botzetta

O código deste repositório é mantido pelo time do Botzetta. **Pull requests de fora do time são fechados** com um aviso, sem revisão. Achou um bug ou tem uma sugestão? Abra uma issue com o detalhe (e, se quiser, o trecho de código) que nós implementamos.

## Para o time

- Node 22 (`.nvmrc`) e `npm ci`. Antes do commit: `npm run build && npm run typecheck && npm run lint && npm test && npm run verificar:conteudo && npm run verificar:pacotes`.
- Toda mudança em pacote leva um changeset (`npm run changeset`). Semver estrito: mudança incompatível só em major.
- Este repositório é público: nada de nomes, caminhos ou rotas internas em código, comentário ou documentação. O CI barra (`scripts/verificar-conteudo.mjs`).
