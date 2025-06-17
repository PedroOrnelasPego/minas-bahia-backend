import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import perfilRouter from "./routes/perfil.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Rotas principais
app.use("/perfil", perfilRouter);

// Rota raiz: responde com mensagem simples
app.get("/", (req, res) => {
  res.send("Backend está rodando! 🚀");
});

// Rota de verificação de saúde
app.get("/health", async (req, res) => {
  try {
    // Aqui você pode testar a conexão com o banco, exemplo:
    // const count = await cosmosContainer.items.readAll().fetchAll();
    // res.status(200).send(`Conexão OK com CosmosDB 🎉 Total: ${count.resources.length} itens`);
    
    res.status(200).send("Conexão OK com CosmosDB 🎉");
  } catch (e) {
    res.status(500).send("Erro ao conectar com o banco ❌");
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend rodando na porta ${PORT}`);
});
