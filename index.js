// api/index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import perfilPublicoRouter from "./routes/perfilPublico.js"; // << NOVO
import perfilRouter from "./routes/perfil.js"; // (agora só rotas protegidas)
import uploadRouter from "./routes/upload.js";
import eventosRoutes from "./routes/eventos.js";
import authRoutes from "./routes/authGoogle.js";
import chamadaRoutes from "./routes/chamada.js";

// package.json com "type": "module"
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
    origin: [
      "http://localhost:5173",
      "https://zealous-bay-00b08311e.6.azurestaticapps.net",
      "https://icmbc.com.br",
      "https://www.icmbc.com.br",
    ],
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
/**
 * IMPORTANTE:
 * A partir daqui o gate() já rodou,
 * então todas essas rotas vão exigir sessão válida via cookie mbc_gate,
 * exceto as que já foram expostas acima no perfilPublicoRouter.
 */
app.use("/perfil", perfilRouter);
app.use("/eventos", eventosRoutes);
app.use("/chamada", chamadaRoutes);

/* ================== Inicialização ================== */
app.listen(PORT, () => {
  console.log(`✅ Servidor v${VERSION} rodando na porta ${PORT}`);
  console.log(`📚 Documentação Swagger disponível em http://localhost:${PORT}/api-docs`);
});

/*

VOOLTAR O "app.use("/upload", uploadRouter);" PARA DEBAIXO DO GATE E TESTAR!!!!!!!!!!!!!!!!!!!!!!!!!!!! E PEGAR A RESPOSTA DO CHAT GPT POR ULTIMO TAMBÉM!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! */
