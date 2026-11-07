// Testes da checagem de conteúdo (node --test). Os textos proibidos são montados por concatenação
// para que este arquivo não seja barrado pela própria checagem.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./verificar-conteudo.mjs", import.meta.url));
const pastas = [];

function repo(arquivos) {
  const raiz = mkdtempSync(join(tmpdir(), "verificar-conteudo-"));
  pastas.push(raiz);
  execFileSync("git", ["init", "-q"], { cwd: raiz });
  for (const [caminho, texto] of Object.entries(arquivos)) {
    mkdirSync(join(raiz, caminho, ".."), { recursive: true });
    writeFileSync(join(raiz, caminho), texto);
  }
  return raiz;
}

// Padrões internos fictícios: os reais ficam no secret VERIFICAR_PADROES_INTERNOS, fora do repositório.
const INTERNOS_TESTE = "\\bprojeto-secreto\\b\n/rota-oculta/";
const rodar = (raiz, internos = INTERNOS_TESTE) =>
  spawnSync(process.execPath, [SCRIPT, "--raiz", raiz], {
    encoding: "utf8",
    env: { ...process.env, CI: "", VERIFICAR_PADROES_INTERNOS: internos }
  });

after(() => pastas.forEach(p => rmSync(p, { recursive: true, force: true })));

describe("verificar-conteudo", () => {
  it("aceita conteúdo público, inclusive o nome deste repositório", () => {
    const r = rodar(repo({ "README.md": "npm i @botzetta/sdk-frame\nhttps://github.com/diampi/botzetta-sdk-js\nimport { PLATAFORMA_ISS } from \"@botzetta/sdk\";\n{\"sources\":[\"../src/a.ts\"]}\n" }));
    assert.equal(r.status, 0, r.stderr);
  });

  const casos = {
    "pacote privado": "import x from \"@dia" + "mpi/botzetta-ui\";",
    "caminho local do Windows": "C:\\Users\\x\\projeto",
    "caminho do workspace": "ver .cla" + "ude/specs/x.md",
    "sourcemap com caminho absoluto": '{"version":3,"sour' + 'ces":["/home/runner/work/x/dist/index.cjs"]}',
    "sourcemap com caminho absoluto fora da 1ª entrada": '{"sour' + 'ces":["../src/a.ts","/home/runner/work/x/src/b.ts"]}',
    "sourcemap com caminho do Windows": '{"sour' + 'ces":["d:\\\\a\\\\x\\\\dist\\\\index.cjs"]}',
    "padrão interno (1º)": "veja o projeto-" + "secreto",
    "padrão interno (2º)": "GET /rota-" + "oculta/x"
  };
  for (const [nome, texto] of Object.entries(casos)) {
    it(`reprova ${nome} em arquivo versionado`, () => {
      const r = rodar(repo({ "src/a.ts": `// ok\n// ${texto}\n` }));
      assert.equal(r.status, 1, `deveria reprovar: ${texto}`);
      assert.match(r.stderr, /src\/a\.ts:2/);
    });
  }

  it("padrão interno: o log mostra só o número, sem a expressão nem a linha", () => {
    const r = rodar(repo({ "src/a.ts": "// GET /rota-" + "oculta/x\n" }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /src\/a\.ts:1: padrão interno nº 2/);
    assert.doesNotMatch(r.stderr, /rota-oculta/);
  });

  it("no CI, sem o secret dos padrões internos, falha", () => {
    const r = spawnSync(process.execPath, [SCRIPT, "--raiz", repo({ "a.md": "ok\n" })], {
      encoding: "utf8",
      env: { ...process.env, CI: "true", VERIFICAR_PADROES_INTERNOS: "" }
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /VERIFICAR_PADROES_INTERNOS/);
  });

  it("reprova conteúdo proibido em dist/ de pacote (mesmo ignorado pelo git)", () => {
    const r = rodar(repo({ ".gitignore": "dist/\n", "packages/p/dist/index.js": "// @dia" + "mpi/x\n" }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /packages\/p\/dist\/index\.js:1/);
  });
});
