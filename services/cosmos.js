import express from "express";
import {
  buscarPerfil,
  criarPerfil,
  atualizarPerfil, // usado internamente, mas não na rota PUT
  listarPerfis,
  container,
} from "../services/cosmos.js";

const router = express.Router();
const EMAIL_MESTRE = "contato@capoeiraminasbahia.com.br";

// Listar todos os perfis
router.get("/", async (req, res) => {
  try {
    const perfis = await listarPerfis();
    res.status(200).json(perfis);
  } catch (error) {
    console.error("Erro ao listar perfis:", error.message);
    res.status(500).json({ erro: "Erro ao listar perfis." });
  }
});

// Buscar perfil por e-mail
router.get("/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const perfil = await buscarPerfil(email);

    if (!perfil) {
      return res.status(404).json({ erro: "Perfil não encontrado" });
    }

    res.json(perfil);
  } catch (error) {
    res.status(500).json({
      erro: "Erro ao buscar perfil",
      detalhe: error.message,
    });
  }
});

// Criar perfil
router.post("/", async (req, res) => {
  try {
    const perfil = req.body;

    if (!perfil.email) {
      return res.status(400).json({ erro: "Email é obrigatório" });
    }

    const resultado = await criarPerfil(perfil);
    res.status(201).json(resultado);
  } catch (error) {
    console.error("Erro ao criar perfil:", error);
    res.status(500).json({ erro: "Erro ao criar perfil" });
  }
});

// Atualizar perfil por email — com proteção do mestre
router.put("/perfil/:email", async (req, res) => {
  const { email } = req.params;
  const updates = req.body;

  // ❌ Bloquear alteração do nível do mestre
  if (
    email === EMAIL_MESTRE &&
    Object.prototype.hasOwnProperty.call(updates, "nivelAcesso")
  ) {
    return res
      .status(403)
      .json({ erro: "Você não pode alterar o nível do mestre." });
  }

  try {
    const { resource: perfil } = await container.item(email, email).read();
    const updatedPerfil = { ...perfil, ...updates };
    await container.item(email, email).replace(updatedPerfil);
    res.status(200).json({ mensagem: "Perfil atualizado com sucesso." });
  } catch (error) {
    console.error("Erro ao atualizar perfil:", error.message);
    res.status(500).json({ erro: "Erro ao atualizar o perfil." });
  }
});

export default router;

/*
import { CosmosClient } from "@azure/cosmos";
import dotenv from "dotenv";
dotenv.config();

// Configurações da instância do Cosmos
const uri = process.env.COSMOSDB_URI;
const key = process.env.COSMOSDB_KEY;
const databaseId = "graduados";
const containerId = "usuarios";

const client = new CosmosClient({ endpoint: uri, key });
const database = client.database(databaseId);
const container = database.container(containerId);

export async function listarPerfis() {
  const query = "SELECT * FROM c";
  const { resources } = await container.items.query(query).fetchAll();
  return resources;
}


// Buscar perfil por e-mail
export async function buscarPerfil(email) {
  const query = {
    query: "SELECT * FROM c WHERE c.email = @email",
    parameters: [{ name: "@email", value: email }],
  };

  const { resources } = await container.items.query(query).fetchAll();
  return resources?.[0] || null;
}

// Criar novo perfil
export async function criarPerfil(perfil) {
  if (!perfil.email) {
    throw new Error("Perfil sem email não pode ser salvo");
  }

  const { resource } = await container.items.create(perfil);
  return resource;
}

// Atualizar perfil existente
export async function atualizarPerfil(id, dadosAtualizados) {
  const { resource } = await container.item(id, id).replace(dadosAtualizados);
  return resource;
}

// Opcional: função health para teste de conexão
export async function testarConexao() {
  try {
    await container.items.query("SELECT VALUE COUNT(1) FROM c").fetchAll();
    return true;
  } catch (error) {
    console.error("Erro ao conectar com CosmosDB:", error.message);
    return false;
  }
}

*/
