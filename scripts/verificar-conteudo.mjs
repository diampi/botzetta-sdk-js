/**
 * Checagem de conteúdo do repositório público: nada de nome, caminho ou rota interna do Botzetta
 * em código, comentário, documentação ou pacote gerado.
 *
 * Varre todo arquivo versionado (git ls-files, incluindo os novos ainda não ignorados) e o que vai
 * dentro dos pacotes (packages/<pacote>/dist, se já houver build). Este próprio script também é
 * varrido: as expressões abaixo são escritas de forma a não casarem consigo mesmas.
 *
 * Uso: node scripts/verificar-conteudo.mjs [--raiz <pasta>]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opcao = nome => (args.includes(nome) ? args[args.indexOf(nome) + 1] : null);
const RAIZ = resolve(opcao("--raiz") ?? fileURLToPath(new URL("..", import.meta.url)));

const PROIBIDOS = [
  { re: /@diampi\//, motivo: "pacote privado do escopo diampi (o parceiro não consegue instalar)" },
  { re: /\b[A-Za-z]:\\[A-Za-z]/, motivo: "caminho local do Windows" },
  { re: /(^|[\s"'`(/])(_wt|\.claude)\//, motivo: "caminho do workspace interno" },
  { re: /"sources":\[[^\]]*"(?:[A-Za-z]:\\|\/)/, motivo: "sourcemap com caminho absoluto da máquina do build" }
];

/**
 * Padrões específicos do Botzetta (repositórios, rotas e configuração internos) não ficam neste repositório público:
 * vêm do secret VERIFICAR_PADROES_INTERNOS (uma expressão regular por linha). No log aparece só o número
 * do padrão, nunca a expressão nem a linha que casou. No CI o secret é obrigatório; fora dele, sem o
 * secret, a checagem roda só com os padrões genéricos e avisa.
 */
const textoInternos = (process.env.VERIFICAR_PADROES_INTERNOS ?? "").trim();
if (!textoInternos && process.env.CI) {
  console.error("Secret VERIFICAR_PADROES_INTERNOS ausente: no CI a checagem de conteúdo não roda sem ele.");
  process.exit(1);
}
const INTERNOS = textoInternos
  .split(/\r?\n/)
  .map(l => l.trim())
  .filter(Boolean)
  .map(fonte => new RegExp(fonte));
if (!textoInternos) console.warn("Aviso: VERIFICAR_PADROES_INTERNOS não definido; só os padrões genéricos foram verificados.");

function versionados() {
  const saida = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: RAIZ,
    encoding: "utf8"
  });
  return [...new Set(saida.split("\0").filter(Boolean))].filter(rel => existsSync(join(RAIZ, rel)));
}

function arquivosDe(pasta) {
  if (!existsSync(pasta)) return [];
  return readdirSync(pasta).flatMap(nome => {
    const p = join(pasta, nome);
    return statSync(p).isDirectory() ? arquivosDe(p) : [p];
  });
}

function gerados() {
  const pacotes = join(RAIZ, "packages");
  if (!existsSync(pacotes)) return [];
  return readdirSync(pacotes).flatMap(p => arquivosDe(join(pacotes, p, "dist")).map(a => relative(RAIZ, a)));
}

const alvos = [...new Set([...versionados(), ...gerados()].map(r => r.split("\\").join("/")))].sort();
const erros = [];
let varridos = 0;

for (const rel of alvos) {
  const conteudo = readFileSync(join(RAIZ, rel));
  if (conteudo.includes(0)) continue; // binário
  varridos++;
  conteudo
    .toString("utf8")
    .split(/\r?\n/)
    .forEach((linha, i) => {
      for (const { re, motivo } of PROIBIDOS) if (re.test(linha)) erros.push(`${rel}:${i + 1}: ${motivo}: ${linha.trim().slice(0, 120)}`);
      INTERNOS.forEach((re, n) => {
        if (re.test(linha)) erros.push(`${rel}:${i + 1}: padrão interno nº ${n + 1}`);
      });
    });
}

if (erros.length) {
  console.error(`${erros.length} problema(s) no conteúdo:\n${erros.map(e => `  - ${e}`).join("\n")}`);
  process.exit(1);
}
console.log(`Conteúdo OK: ${varridos} arquivo(s) sem nome, caminho ou rota interna.`);
