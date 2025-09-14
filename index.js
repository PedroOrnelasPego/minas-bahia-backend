import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import perfilRouter from "./routes/perfil.js";
import uploadRouter from "./routes/upload.js";
import eventosRoutes from "./routes/eventos.js";

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
  res.send("Backend está rodando! 🚀");
});

// Rota de verificação (health check)
app.get("/health", async (req, res) => {
  try {
    res.status(200).send("Conexão OK com CosmosDB 🎉");
  } catch (error) {
    res.status(500).send("Erro ao conectar com o banco ❌");
  }
});

// Inicialização do servidor
app.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
});

