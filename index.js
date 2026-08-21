// api/index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import perfilPublicoRouter from "./routes/perfilPublico.js";
import perfilRouter from "./routes/perfil.js";
import uploadRouter from "./routes/upload.js";
import eventosRoutes from "./routes/eventos.js";
import authRoutes from "./routes/authGoogle.js";
import chamadaRoutes from "./routes/chamada.js";

import pkg from "./package.json" with { type: "json" };
import { gate } from "./middleware/gate.js";
import { setupSwagger } from "./swagger.js";

dotenv.config();

const VERSION = pkg.version;
const app = express();
const PORT = process.env.PORT || 4000;

// Configurar o painel do Swagger logo na raíz
setupSwagger(app);

/* ================== Middlewares globais ================== */
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json());

/* ================== Rotas PÚBLICAS (sem gate) ================== */

// auth pública
app.use("/auth", authRoutes);

// health/basic info
app.get("/", (_req, res) => res.send(`Backend está rodando! 🚀 v${VERSION}`));
app.get("/health", (_req, res) => res.status(200).send(`OK v${VERSION}`));

// cadastro inicial e checagem de CPF (público, sem exigir cookie gate)
app.use("/perfil", perfilPublicoRouter);
app.use("/upload", uploadRouter);

/* ======== Travar o restante da API a partir daqui ======== */
app.use(gate());

/* ================== Rotas PROTEGIDAS ================== */
app.use("/perfil", perfilRouter);
app.use("/eventos", eventosRoutes);
app.use("/chamada", chamadaRoutes);

/* ================== Inicialização ================== */
if (process.env.NODE_ENV !== "test" && !process.env.NODE_TEST_CONTEXT && !process.execArgv.includes("--test")) {
  app
    .listen(PORT, () => {
      console.log(`✅ Servidor v${VERSION} rodando na porta ${PORT}`);
      console.log(`📚 Documentação Swagger disponível em http://localhost:${PORT}/api-docs`);
    })
    .on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.error(
          `❌ ERRO: A porta ${PORT} já está sendo usada por outro processo (ex: Docker ou outro Node).`
        );
        process.exit(1);
      } else {
        console.error("❌ ERRO no servidor:", err);
      }
    });
}

export default app;
