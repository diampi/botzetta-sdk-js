/**
 * Backend mínimo de app de parceiro só com `node:http` e a raiz do `@botzetta/sdk` (sem Express):
 *
 *   GET  /.well-known/jwks.json  chave pública do app (o Botzetta confere o client_assertion por ela)
 *   GET  /api/eu                 valida o token "usuario" que a página do iframe manda
 *   POST /botzetta/webhook       confere a assinatura do webhook e devolve 204
 *
 * Rodar: NUCLEO_URL=... APP_SLUG=... APP_CHAVE_PRIVADA=... APP_CHAVE_KID=... node servidor.mjs
 */
import http from "node:http";
import { pathToFileURL } from "node:url";
import {
  AppError,
  CABECALHO_ASSINATURA,
  CABECALHO_ENTREGA,
  EVENTO_TESTE_WEBHOOK,
  criarChaveApp,
  criarVerificadorUsuario,
  escritaBloqueada,
  servirJwks,
  tokenDoCabecalho,
  verificarWebhook
} from "@botzetta/sdk";

const LIMITE_CORPO = 64 * 1024;

/** Lê o corpo CRU (a assinatura do webhook confere exatamente estes bytes). */
function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let tamanho = 0;
    let excedeu = false;
    req.on("data", parte => {
      tamanho += parte.length;
      // Para de guardar, mas deixa o corpo terminar de chegar para conseguir responder o 413.
      if (tamanho > LIMITE_CORPO) excedeu = true;
      else partes.push(parte);
    });
    req.on("end", () => (excedeu ? reject(new AppError("ERR_CORPO_GRANDE", "Corpo grande demais.", 413)) : resolve(Buffer.concat(partes))));
    req.on("error", reject);
  });
}

function responder(res, status, corpo) {
  res.statusCode = status;
  if (corpo === undefined) return res.end();
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(corpo));
}

/**
 * @param {{ slug: string, nucleoUrl: string, chave: import("@botzetta/sdk").ChaveApp, aoEvento?: (evento: object) => void }} op
 */
export function criarServidor({ slug, nucleoUrl, chave, aoEvento = () => {} }) {
  const verificarUsuario = criarVerificadorUsuario({ slug, nucleoUrl });
  const jwks = servirJwks(chave);
  const jwksNucleo = `${nucleoUrl.replace(/\/+$/, "")}/plataforma/v1/.well-known/jwks.json`;
  // Entrega é "pelo menos uma vez": deduplique pelo id (aqui em memória; use o seu banco).
  const vistos = new Set();

  return http.createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url ?? "/", "http://localhost");

      if (req.method === "GET" && pathname === "/.well-known/jwks.json") return jwks(req, res);

      if (pathname === "/api/eu") {
        const usuario = await verificarUsuario(tokenDoCabecalho(req.headers.authorization));
        const leitura = ["GET", "HEAD", "OPTIONS"].includes(req.method ?? "GET");
        const bloqueio = leitura ? null : escritaBloqueada(usuario.nivel);
        if (bloqueio) throw bloqueio;
        // Use SEMPRE a empresa do token, nunca uma vinda do navegador.
        return responder(res, 200, { usuarioId: usuario.usuarioId, companyId: usuario.companyId, perfil: usuario.perfil });
      }

      if (req.method === "POST" && pathname === "/botzetta/webhook") {
        const evento = await verificarWebhook({
          corpo: await lerCorpo(req),
          assinatura: req.headers[CABECALHO_ASSINATURA],
          entrega: req.headers[CABECALHO_ENTREGA],
          slug,
          jwksUrl: jwksNucleo
        });
        if (evento.evento !== EVENTO_TESTE_WEBHOOK && !vistos.has(evento.id)) {
          vistos.add(evento.id);
          // O payload é só o sinal: busque os detalhes na API com o token da empresa (evento.companyId).
          aoEvento(evento);
        }
        return responder(res, 204);
      }

      responder(res, 404, { error: "ERR_NAO_ENCONTRADO", message: "Rota não encontrada." });
    } catch (e) {
      if (e instanceof AppError) return responder(res, e.status, e.toJSON());
      console.error(e);
      responder(res, 500, { error: "ERR_INTERNO", message: "Erro interno." });
    }
  });
}

// Executado direto (node servidor.mjs): lê a configuração do ambiente.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { NUCLEO_URL, APP_SLUG, APP_CHAVE_PRIVADA, APP_CHAVE_KID, PORTA = "4300" } = process.env;
  if (!NUCLEO_URL || !APP_SLUG || !APP_CHAVE_PRIVADA || !APP_CHAVE_KID)
    throw new Error("Configure NUCLEO_URL, APP_SLUG, APP_CHAVE_PRIVADA e APP_CHAVE_KID.");
  const chave = criarChaveApp({ chavePrivada: APP_CHAVE_PRIVADA, kid: APP_CHAVE_KID });
  criarServidor({ slug: APP_SLUG, nucleoUrl: NUCLEO_URL, chave, aoEvento: e => console.log(`[webhook] ${e.evento} empresa ${e.companyId}`) }).listen(
    Number(PORTA),
    () => console.log(`App em http://localhost:${PORTA}`)
  );
}
