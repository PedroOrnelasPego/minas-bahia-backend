// routes/perfil.js
import express from "express";
import {
  buscarPerfil,
  criarPerfil,
  listarPerfis,
  container,
} from "../services/cosmos.js";

const router = express.Router();

// GET /perfil
router.get("/", async (req, res) => {
  try {
    const perfis = await listarPerfis();
    res.status(200).json(perfis);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao listar perfis." });
  }
});

// GET /perfil/:email
router.get("/:email", async (req, res) => {
  try {
    const perfil = await buscarPerfil(req.params.email);
    if (!perfil) return res.status(404).json({ erro: "Perfil não encontrado" });
    res.json(perfil);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao buscar perfil." });
  }
});

// POST /perfil
router.post("/", async (req, res) => {
  try {
    const perfil = req.body;
    if (!perfil.email)
      return res.status(400).json({ erro: "Email é obrigatório" });
    const criado = await criarPerfil(perfil);
    res.status(201).json(criado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao criar perfil." });
  }
});

// PUT /perfil/:email
router.put("/:email", async (req, res) => {
  const { email } = req.params;
  const updates = req.body;

  try {
    // lê, mescla e substitui
    const { resource: perfil } = await container.item(email, email).read();
    const atualizado = { ...perfil, ...updates };
    await container.item(email, email).replace(atualizado);
    res.json({ mensagem: "Atualizado com sucesso." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao atualizar perfil." });
  }
});

// ❌ Remova todos os outros PUT, deixe só este:
router.put("/:email", async (req, res) => {
  const { email } = req.params;
  const updates = req.body;

  try {
    // lê o documento pelo partitionKey = email
    const { resource: perfil } = await container.item(email, email).read();
    // mescla o que veio na requisição
    const atualizado = { ...perfil, ...updates };
    // grava de volta
    await container.item(email, email).replace(atualizado);
    return res.json({ mensagem: "Perfil atualizado com sucesso." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao atualizar perfil." });
  }
});

export default router;
