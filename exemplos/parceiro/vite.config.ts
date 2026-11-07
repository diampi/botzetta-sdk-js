import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    root: "web",
    // A página só conhece o host pela lista explícita (F3-D04): entra no bundle.
    define: { "import.meta.env.BOTZETTA_HOST_URL": JSON.stringify(env.BOTZETTA_HOST_URL ?? "") },
    // es2022: a página usa top-level await (await iniciarFrame(...)).
    build: { outDir: "../dist/web", emptyOutDir: true, target: "es2022" }
  };
});
