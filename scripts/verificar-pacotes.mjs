/**
 * Confere o que cada pacote leva para o npm (npm pack --dry-run): só dist/, os extras listados
 * abaixo, README.md, LICENSE (igual à da raiz) e package.json. Rode depois do build.
 *
 * Uso: node scripts/verificar-pacotes.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const OBRIGATORIOS = ["package.json", "README.md", "LICENSE"];
/** Arquivos fora de dist/ que cada pacote pode publicar. */
const EXTRAS = { "@botzetta/sdk-frame": ["tema.css"] };

const { workspaces } = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8"));
const licenca = readFileSync(join(RAIZ, "LICENSE"), "utf8");
const erros = [];

for (const ws of workspaces) {
  const pkg = JSON.parse(readFileSync(join(RAIZ, ws, "package.json"), "utf8"));
  const saida = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: join(RAIZ, ws),
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  const [{ files }] = JSON.parse(saida);
  const caminhos = files.map(f => f.path.split("\\").join("/"));
  const permitidos = new Set([...OBRIGATORIOS, ...(EXTRAS[pkg.name] ?? [])]);

  for (const c of caminhos) if (!c.startsWith("dist/") && !permitidos.has(c)) erros.push(`${pkg.name}: arquivo inesperado no pacote: ${c}`);
  for (const c of permitidos) if (!caminhos.includes(c)) erros.push(`${pkg.name}: falta ${c} no pacote`);
  if (!caminhos.some(c => c.startsWith("dist/"))) erros.push(`${pkg.name}: dist/ vazio (rode o build antes)`);
  if (readFileSync(join(RAIZ, ws, "LICENSE"), "utf8") !== licenca) erros.push(`${pkg.name}: LICENSE diferente da raiz`);
  if (pkg.license !== "MIT") erros.push(`${pkg.name}: license deve ser MIT`);
  if (pkg.publishConfig?.access !== "public") erros.push(`${pkg.name}: publishConfig.access deve ser public`);

  console.log(`${pkg.name}@${pkg.version}: ${caminhos.length} arquivo(s)\n${caminhos.map(c => `  ${c}`).join("\n")}`);
}

if (erros.length) {
  console.error(`\n${erros.length} problema(s) nos pacotes:\n${erros.map(e => `  - ${e}`).join("\n")}`);
  process.exit(1);
}
console.log("Pacotes OK.");
