// Gera a chave do app (RS256). Copie as duas linhas para o .env; nunca versione a chave privada.
import { gerarChaveApp } from "@botzetta/sdk";

const { kid, chavePrivadaPem } = gerarChaveApp();
console.log(`APP_CHAVE_KID=${kid}`);
// Em base64: cabe numa linha do .env (o criarChaveApp aceita PEM ou PEM em base64).
console.log(`APP_CHAVE_PRIVADA=${Buffer.from(chavePrivadaPem).toString("base64")}`);
