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
