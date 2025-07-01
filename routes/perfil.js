// routes/perfil.js
import express from "express";
import {
  buscarPerfil,
  criarPerfil,
  listarPerfis,
  container,
} from "../services/cosmos.js";

const router = express.Router();
const MESTRE_EMAIL = "contato@capoeiraminasbahia.com.br";

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
    if (!perfil.email) return res.status(400).json({ erro: "Email é obrigatório" });
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

  // bloqueia alteração do mestre
  if (
    email === MESTRE_EMAIL &&
    Object.prototype.hasOwnProperty.call(updates, "nivelAcesso")
  ) {
    return res.status(403).json({ erro: "Não é permitido alterar o mestre." });
  }

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

export default router;



/*
import express from "express";
import {
  buscarPerfil,
  criarPerfil,
  atualizarPerfil,
  listarPerfis,
  container
} from "../services/cosmos.js";

const router = express.Router();

// Garantir que GET /perfil sem barra funcione
router.get("/", async (req, res) => {
  try {
    const perfis = await listarPerfis();
    res.status(200).json(perfis);
  } catch (error) {
    console.error("Erro ao listar perfis:", error.message);
    res.status(500).json({ erro: "Erro ao listar perfis." });
  }
});


// Buscar perfil por ID (email)
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

// Atualizar perfil
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const dadosAtualizados = req.body;

  try {
    const resultado = await atualizarPerfil(id, dadosAtualizados);
    res.status(200).json(resultado);
  } catch (error) {
    console.error("Erro ao atualizar perfil:", error);
    res.status(500).json({
      erro: "Erro ao atualizar perfil",
      detalhe: error.message,
    });
  }
})

router.put("/perfil/:email", async (req, res) => {
  const { email } = req.params;
  const updates = req.body;

  try {
    const { resource: perfil } = await container.item(email, email).read();
    const updatedPerfil = { ...perfil, ...updates };
    await container.item(email, email).replace(updatedPerfil);
    res.status(200).json({ mensagem: "Perfil atualizado com sucesso." });
  } catch (error) {
    res.status(500).json({ erro: "Erro ao atualizar o perfil." });
  }
});


export default router;
*/