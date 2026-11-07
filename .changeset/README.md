# Changesets

Toda mudança num pacote `@botzetta/*` entra com um changeset:

1. `npm run changeset`: escolha os pacotes, o tipo (patch/minor/major) e descreva a mudança em português.
2. Faça o commit do arquivo gerado em `.changeset/` junto com o código.
3. Para lançar: `npm run versionar` (consome os changesets, atualiza versões e CHANGELOGs) e commit na `main`. O workflow `release.yml` publica no npm, com provenance, as versões que ainda não estão lá.

Semver estrito: mudança incompatível só em major, com a depreciação anunciada antes no CHANGELOG.
