/**
 * Testa o exemplos/parceiro com os pacotes DESTE commit (não os publicados): empacota cada pacote
 * (npm pack), copia o exemplo para uma pasta temporária, aponta as dependências @botzetta/* para os
 * .tgz e roda npm install, typecheck e build. Rode depois do build dos pacotes.
 *
 * Uso: node scripts/verificar-exemplo.mjs [--destino <pasta>] [--manter]
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const opcao = nome => (args.includes(nome) ? args[args.indexOf(nome) + 1] : null);
const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const destino = opcao("--destino") ?? mkdtempSync(join(tmpdir(), "botzetta-exemplo-"));
const pastaPacotes = join(destino, "pacotes");
const app = join(destino, "parceiro");

const npm = (argumentos, cwd) => {
  console.log(`$ npm ${argumentos.join(" ")}  (${cwd})`);
  return execFileSync("npm", argumentos, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], shell: process.platform === "win32" });
};

const { workspaces } = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8"));
mkdirSync(pastaPacotes, { recursive: true });
const tgz = {};
for (const ws of workspaces) {
  const { name } = JSON.parse(readFileSync(join(RAIZ, ws, "package.json"), "utf8"));
  const [{ filename }] = JSON.parse(npm(["pack", "--json", "--ignore-scripts", "--pack-destination", pastaPacotes], join(RAIZ, ws)));
  tgz[name] = join(pastaPacotes, filename.split("/").pop());
}

cpSync(join(RAIZ, "exemplos", "parceiro"), app, { recursive: true, filter: origem => !/[\\/](node_modules|dist|\.env(\.[\w-]+)?)$/.test(origem) || origem.endsWith(".env.exemplo") });
const pkgApp = join(app, "package.json");
const pkg = JSON.parse(readFileSync(pkgApp, "utf8"));
for (const nome of Object.keys(pkg.dependencies)) {
  if (!nome.startsWith("@botzetta/")) continue;
  if (!tgz[nome]) throw new Error(`O exemplo depende de ${nome}, que não é um pacote deste repositório.`);
  pkg.dependencies[nome] = pathToFileURL(tgz[nome]).href;
}
writeFileSync(pkgApp, `${JSON.stringify(pkg, null, 2)}\n`);

npm(["install", "--no-audit", "--no-fund"], app);
npm(["run", "typecheck"], app);
npm(["run", "build"], app);
if (!readdirSync(join(app, "dist", "web")).includes("index.html")) throw new Error("O build do exemplo não gerou dist/web/index.html.");

if (!args.includes("--manter") && !opcao("--destino")) rmSync(destino, { recursive: true, force: true });
console.log(`Exemplo OK com ${Object.keys(tgz).join(", ")}.`);
