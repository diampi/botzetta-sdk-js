import { criarChaveApp, gerarChaveApp } from "../src";

/** Chave de app para os testes (gerada uma vez por processo). */
const { chavePrivadaPem, kid } = gerarChaveApp();
export const chaveTeste = criarChaveApp({ chavePrivada: chavePrivadaPem, kid });
