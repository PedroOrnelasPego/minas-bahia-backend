import express from "express";
import {
  buscarPerfil,
  criarPerfil,
  atualizarPerfil,
} from "../services/cosmos.js";

const router = express.Router();

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
});

export default router;
