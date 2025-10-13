import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import perfilRouter from "./routes/perfil.js";
import uploadRouter from "./routes/upload.js";
import eventosRoutes from "./routes/eventos.js";
import authRoutes from "./routes/authGoogle.js";
import pkg from "./package.json" with { type: "json" };

const VERSION = pkg.version;

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

/** ===== Middlewares globais ===== */
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://zealous-bay-00b08311e.6.azurestaticapps.net",
      "https://www.icmbc.com.br",
      "https://icmbc.com.br",
    ],
  })
);
app.use(express.json());

/** ===== Rotas ===== */
app.use("/auth", authRoutes);
app.use("/perfil", perfilRouter);
app.use("/upload", uploadRouter);
app.use("/eventos", eventosRoutes);

app.get("/", (_req, res) => res.send(`Backend está rodando! 🚀 v${VERSION}`));

app.get("/health", async (_req, res) => {
  try {
    res.status(200).send(`Conexão OK com CosmosDB 🎉 v${VERSION}`);
  } catch {
    res.status(500).send(`Erro ao conectar com o banco ❌ v${VERSION}`);
  }
});

app.listen(PORT, () => {
  console.log(`✅ Servidor v${VERSION} rodando na porta ${PORT}`);
});
