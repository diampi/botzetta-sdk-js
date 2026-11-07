import "@botzetta/sdk-frame/tema.css";
import { iniciarFrame, ErroFrame, type ClienteFrame } from "@botzetta/sdk-frame";

const raiz = document.getElementById("app") as HTMLElement;
const origensHost = String(import.meta.env.BOTZETTA_HOST_URL ?? "")
  .split(",")
  .map(o => o.trim())
  .filter(Boolean);

async function eu(frame: ClienteFrame) {
  // Token sempre pelo obterToken() (renovado pelo host); nunca guarde em localStorage.
  const r = await fetch("/api/eu", { headers: { Authorization: `Bearer ${await frame.obterToken()}` } });
  if (!r.ok) throw new Error(`API do app respondeu ${r.status}`);
  return (await r.json()) as { usuarioId: number; companyId: number; perfil: string };
}

const el = (tag: string, texto: string, estilo = "") => Object.assign(document.createElement(tag), { textContent: texto, style: estilo });

function alertar(e: unknown) {
  raiz.append(el("p", e instanceof ErroFrame ? `${e.codigo}: ${e.message}` : String(e), "color: var(--destructive)"));
}

function botao(texto: string, acao: () => unknown) {
  const b = el("button", texto, "margin: 4px; padding: 6px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--card); color: var(--foreground)");
  b.onclick = () => void Promise.resolve().then(acao).catch(alertar);
  return b;
}

try {
  const frame = await iniciarFrame({ origensHost });
  const ctx = frame.obterContexto();
  const dados = await eu(frame);
  raiz.textContent = "";
  raiz.append(
    el("h2", `Olá, ${ctx.usuario.nome}`),
    el(
      "p",
      `Empresa ${ctx.empresa.nome} · validado pelo backend do app: usuário ${dados.usuarioId}, empresa ${dados.companyId}, perfil ${dados.perfil} · rota "${ctx.rota}"`,
      "color: var(--muted-foreground)"
    ),
    botao("Toast", () => frame.toast("Tudo certo por aqui", "sucesso")),
    botao("Confirmar", async () => {
      const ok = await frame.confirmar({ titulo: "Continuar?", mensagem: "Exemplo de confirmação do host." });
      await frame.toast(ok ? "Confirmado" : "Cancelado");
    }),
    botao("Ir para Pessoas", () => frame.navegar("/pessoas")),
    botao("Mudar rota (sem recarregar)", () => frame.informarRota(`inicio/${Date.now() % 1000}`))
  );
  if (ctx.extensao) {
    raiz.append(el("p", `Ticket #${ctx.extensao.ticket.id} (contato ${ctx.extensao.ticket.contatoId})`), botao("Fechar", () => frame.fechar()));
    await frame.redimensionar();
  }
} catch (e) {
  raiz.textContent = "";
  alertar(e);
}
