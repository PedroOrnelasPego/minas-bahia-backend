// api/index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import perfilRouter from "./routes/perfil.js";
import uploadRouter from "./routes/upload.js";
import eventosRoutes from "./routes/eventos.js";
import authRoutes from "./routes/authGoogle.js";

// package.json com "type": "module"
import pkg from "./package.json" with { type: "json" };
import { gate } from "./middleware/gate.js";

dotenv.config();

const VERSION = pkg.version;
const app = express();
const PORT = process.env.PORT || 4000;

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
  })
);

app.use(express.json());

/* ============ Rotas PÚBLICAS (sem gate) ============ */
app.use("/auth", authRoutes); // /auth/google
app.get("/", (_req, res) => res.send(`Backend está rodando! 🚀 v${VERSION}`));
app.get("/health", (_req, res) => res.status(200).send(`OK v${VERSION}`));

/* ======== Travar o restante da API a partir daqui ======== */
app.use(gate());

/* ================== Rotas PROTEGIDAS ================== */
app.use("/perfil", perfilRouter);
app.use("/upload", uploadRouter);
app.use("/eventos", eventosRoutes);

/* ================== Inicialização ================== */
app.listen(PORT, () => {
  console.log(`✅ Servidor v${VERSION} rodando na porta ${PORT}`);
});
