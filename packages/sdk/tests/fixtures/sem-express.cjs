// Pré-carregado com `node --require`: simula uma instalação SEM o express (import e require falham).
const Module = require("node:module");

const ehExpress = especificador => especificador === "express" || especificador.startsWith("express/");
const erro = especificador => Object.assign(new Error(`express bloqueado: ${especificador}`), { code: "ERR_MODULE_NOT_FOUND" });

if (typeof Module.registerHooks === "function") {
  // Node 22.15+: um hook síncrono cobre import e require.
  Module.registerHooks({
    resolve(especificador, contexto, proximo) {
      if (ehExpress(especificador)) throw erro(especificador);
      return proximo(especificador, contexto);
    }
  });
} else {
  const original = Module._resolveFilename;
  Module._resolveFilename = function (especificador, ...resto) {
    if (ehExpress(especificador)) throw erro(especificador);
    return original.call(this, especificador, ...resto);
  };
  Module.register(
    "data:text/javascript," +
      encodeURIComponent(
        'export async function resolve(e, c, p) { if (e === "express" || e.startsWith("express/")) throw new Error("express bloqueado: " + e); return p(e, c); }'
      )
  );
}
