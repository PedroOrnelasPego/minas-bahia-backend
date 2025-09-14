import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import perfilRouter from "./routes/perfil.js";
import uploadRouter from "./routes/upload.js";
import eventosRoutes from "./routes/eventos.js";

// 👇 importa o package.json e pega a versão
import pkg from "./package.json" with { type: "json" };
const VERSION = pkg.version;

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Middlewares globais
app.use(cors());
app.use(express.json());

// Rotas da aplicação
app.use("/perfil", perfilRouter);
app.use("/upload", uploadRouter);
app.use("/eventos", eventosRoutes);

// Rota raiz
app.get("/", (req, res) => {
  res.send(`Backend está rodando! 🚀 v${VERSION}`);
});

// Rota de verificação (health check)
app.get("/health", async (req, res) => {
  try {
    res.status(200).send(`Conexão OK com CosmosDB 🎉 v${VERSION}`);
  } catch (error) {
    res.status(500).send(`Erro ao conectar com o banco ❌ v${VERSION}`);
  }
});

// Inicialização do servidor
app.listen(PORT, () => {
  console.log(`✅ Servidor v${VERSION} rodando na porta ${PORT}`);
});
