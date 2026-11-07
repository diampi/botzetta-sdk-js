/**
 * Backend do app de parceiro (roda na SUA infraestrutura). Serve a página (dist/web) e a API dela.
 * A página manda o token "usuario" que recebeu do host (obterToken()); autenticarUsuario valida a
 * assinatura pelo JWKS da Plataforma e a sessão atual pelo GET /plataforma/v1/sessao (cache de 30 s).
 * Use SEMPRE a empresa do token (contextoUsuario(req).companyId), nunca uma vinda do navegador.
 *
 * Instalação e webhook: /botzetta/instalar é a "URL de instalação" que você cadastra no portal
 * (o botão "Testar na sandbox" e o link para clientes abrem ela); /botzetta/callback é a redirect URI;
 * /botzetta/webhook recebe os eventos assinados pelo Botzetta (JWS, validado pelo JWKS da Plataforma).
 * /.well-known/jwks.json publica a chave pública do app: informe essa URL como jwksUrl no rascunho do portal.
 */
import { fileURLToPath } from "node:url";
import express from "express";
import {
  CABECALHO_ASSINATURA,
  CABECALHO_ENTREGA,
  EVENTO_TESTE_WEBHOOK,
  criarChaveApp,
  criarCliente,
  gerarPkce,
  gerarState,
  montarUrlInstalacao,
  trocarCodigo,
  verificarWebhook,
  type ArmazenamentoTokens,
  type TokensInstalacao
} from "@botzetta/sdk";
import { autenticarUsuario, contextoUsuario, servirJwks, tratarErros } from "@botzetta/sdk/express";

const { NUCLEO_URL, APP_SLUG, BOTZETTA_HOST_URL, PORTA = "4300" } = process.env;
if (!NUCLEO_URL || !APP_SLUG || !BOTZETTA_HOST_URL) throw new Error("Configure NUCLEO_URL, APP_SLUG e BOTZETTA_HOST_URL (.env).");
// client_id = slug do app; a chave do app (npm run gerar-chave) nunca sai daqui.
const { BOTZETTA_REDIRECT_URI, APP_CHAVE_PRIVADA, APP_CHAVE_KID } = process.env;
const BOTZETTA_CLIENT_ID = APP_SLUG;
if (!APP_CHAVE_PRIVADA || !APP_CHAVE_KID) throw new Error("Configure APP_CHAVE_PRIVADA e APP_CHAVE_KID (npm run gerar-chave).");
const chave = criarChaveApp({ chavePrivada: APP_CHAVE_PRIVADA, kid: APP_CHAVE_KID });
const jwksNucleo = `${NUCLEO_URL}/plataforma/v1/.well-known/jwks.json`;

const app = express();
const pastaWeb = fileURLToPath(new URL("./dist/web", import.meta.url));

// Só o Botzetta pode enquadrar estas páginas (clickjacking por terceiros).
const origensHost = BOTZETTA_HOST_URL.split(",")
  .map(o => new URL(o.trim()).origin)
  .join(" ");
app.use((_req, res, next) => {
  res.setHeader("Content-Security-Policy", `frame-ancestors ${origensHost}`);
  next();
});

const usuario = autenticarUsuario({ slug: APP_SLUG, nucleoUrl: NUCLEO_URL });

// Chave pública do app (o Botzetta valida o client_assertion por aqui).
app.get("/.well-known/jwks.json", servirJwks(chave));

// ---------- Tokens de instalação ----------
// EXEMPLO em memória: em produção guarde os tokens no SEU banco, cifrados.
const tokens = new Map<number, TokensInstalacao>();
const armazenamento: ArmazenamentoTokens = {
  obter: async companyId => tokens.get(companyId) ?? null,
  salvar: async (companyId, t) => void tokens.set(companyId, t)
};
// Cliente da API: usa o token da instalação de cada empresa e renova sozinho (refresh rotativo).
const botzetta = criarCliente({ url: NUCLEO_URL, clientId: BOTZETTA_CLIENT_ID, chave, tokensInstalacao: armazenamento });

app.get("/api/eu", usuario, (req, res) => {
  const ctx = contextoUsuario(req);
  res.json({ usuarioId: ctx.userId, companyId: ctx.companyId, perfil: ctx.perfil });
});

// Chamada à API em nome da empresa do usuário (escopo usuarios:ler no manifesto).
app.get("/api/usuarios", usuario, async (req, res) => {
  const { companyId } = contextoUsuario(req);
  res.json(await botzetta.empresa(companyId).usuarios.listar());
});

// ---------- Instalação (OAuth com PKCE): /botzetta/instalar → host → /botzetta/callback ----------
// EXEMPLO em memória: em produção guarde o verifier na sessão.
const pendentes = new Map<string, { verifier: string; expira: number }>();
const lerCookie = (req: express.Request, nome: string) =>
  (req.headers.cookie ?? "")
    .split(";")
    .map(c => c.trim().split("="))
    .find(([k]) => k === nome)?.[1];

const MAX_PENDENTES = 1000;
const limparPendentes = () => {
  const agora = Date.now();
  for (const [s, p] of pendentes) if (p.expira < agora) pendentes.delete(s);
};

app.get("/botzetta/instalar", (_req, res) => {
  if (!BOTZETTA_REDIRECT_URI) {
    res.status(500).send("Configure BOTZETTA_REDIRECT_URI.");
    return;
  }
  // Rota pública: limpa os expirados e põe teto no que fica em memória.
  limparPendentes();
  if (pendentes.size >= MAX_PENDENTES) {
    res.status(503).send("Muitas instalações em andamento. Tente de novo em instantes.");
    return;
  }
  const { verifier, challenge } = gerarPkce();
  const state = gerarState();
  pendentes.set(state, { verifier, expira: Date.now() + 10 * 60_000 });
  // O state também vai num cookie: o callback só aceita o state que saiu DESTE navegador (anti-CSRF).
  res.cookie("bz_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 10 * 60_000, path: "/botzetta" });
  const urlHost = BOTZETTA_HOST_URL.split(",")[0]!.trim();
  res.redirect(montarUrlInstalacao({ urlHost, clientId: BOTZETTA_CLIENT_ID, redirectUri: BOTZETTA_REDIRECT_URI, state, codeChallenge: challenge }));
});

app.get("/botzetta/callback", async (req, res) => {
  const state = String(req.query.state ?? "");
  const pendente = pendentes.get(state);
  pendentes.delete(state);
  if (!pendente || pendente.expira < Date.now() || lerCookie(req, "bz_state") !== state) {
    res.status(400).send("Instalação inválida ou expirada. Comece de novo.");
    return;
  }
  if (req.query.error) {
    res.send("Instalação cancelada.");
    return;
  }
  const t = await trocarCodigo(
    { url: NUCLEO_URL, clientId: BOTZETTA_CLIENT_ID, chave },
    { code: String(req.query.code ?? ""), redirectUri: BOTZETTA_REDIRECT_URI!, codeVerifier: pendente.verifier }
  );
  await armazenamento.salvar(t.companyId, t);
  res.send(`App instalado na empresa ${t.companyId}. Você já pode fechar esta janela.`);
});

// ---------- Webhook: corpo CRU para conferir a assinatura ----------
// Entrega é "pelo menos uma vez": deduplique pelo id (EXEMPLO em memória; use o seu banco).
const vistos = new Map<string, number>();
app.post("/botzetta/webhook", express.raw({ type: "*/*", limit: "64kb" }), async (req, res) => {
  const corpo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  // Confere a assinatura do Botzetta (chave, aud = app:<slug>, validade de 5 min e hash do corpo).
  const evento = await verificarWebhook({
    corpo,
    assinatura: req.headers[CABECALHO_ASSINATURA],
    entrega: req.headers[CABECALHO_ENTREGA],
    slug: APP_SLUG,
    jwksUrl: jwksNucleo
  });
  if (evento.evento === EVENTO_TESTE_WEBHOOK || vistos.has(evento.id)) {
    res.sendStatus(204);
    return;
  }
  const agora = Date.now();
  for (const [id, em] of vistos) if (agora - em > 10 * 60_000) vistos.delete(id);
  vistos.set(evento.id, agora);
  // Payload é só sinal: busque os detalhes na API com botzetta.empresa(evento.companyId).
  console.log(`[webhook] ${evento.evento} ${evento.recurso.tipo}#${evento.recurso.id} empresa ${evento.companyId}`);
  res.sendStatus(204);
});

app.use(express.static(pastaWeb));
// Deep link: /qualquer/caminho → index.html (o roteamento é da página).
app.get("/{*caminho}", (_req, res) => res.sendFile("index.html", { root: pastaWeb }));
app.use(tratarErros());

app.listen(Number(PORTA), () => console.log(`App de parceiro em http://localhost:${PORTA}`));
