// api/index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import perfilRouter from "./routes/perfil.js";
import uploadRouter from "./routes/upload.js";
import eventosRoutes from "./routes/eventos.js";
import authRoutes from "./routes/authGoogle.js";
import authAppRoutes from "./routes/authApp.js";


// package.json com "type": "module"
import pkg from "./package.json" with { type: "json" };
const VERSION = pkg.version;

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

 app.use(express.json());
 app.use(
   cors({
     origin: [
       "http://localhost:5173",
       "https://zealous-bay-00b08311e.6.azurestaticapps.net",
       "https://www.icmbc.com.br",
       "https://icmbc.com.br",
     ],
     methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
     allowedHeaders: ["Content-Type", "Authorization"],
   })
 );
// Se for usar cookie httpOnly, troque por:
// app.use(cors({ origin: ["http://localhost:5173"], credentials: true }));


/** ===== Rotas ===== */
app.use("/auth", authAppRoutes);
app.use("/auth", authRoutes);
app.use("/perfil", perfilRouter);
app.use("/upload", uploadRouter);
app.use("/eventos", eventosRoutes);

// Rota raiz
app.get("/", (_req, res) => res.send(`Backend está rodando! 🚀 v${VERSION}`));

// Health
app.get("/health", async (_req, res) => {
  try {
    res.status(200).send(`Conexão OK com CosmosDB 🎉 v${VERSION}`);
  } catch {
    res.status(500).send(`Erro ao conectar com o banco ❌ v${VERSION}`);
  }
});

/** ===== Inicialização ===== */
app.listen(PORT, () => {
  console.log(`✅ Servidor v${VERSION} rodando na porta ${PORT}`);
});
