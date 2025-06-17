import express from "express";
import cors from "cors";
import perfilRouter from "./routes/perfil.js";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Rotas
app.use("/perfil", perfilRouter);

// Iniciar servidor
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend rodando na porta ${PORT}`);
});

app.get("/", (req, res) => {
  res.send("Backend está rodando! 🚀");
});

app.get("/", (req, res) => {
  res.redirect("/api/perfil");
});

app.get("/health", async (req, res) => {
  try {
    // consulta no Cosmos (simples, tipo um count ou findOne)
    res.status(200).send("Conexão OK com CosmosDB 🎉");
  } catch (e) {
    res.status(500).send("Erro ao conectar com o banco ❌");
  }
});
