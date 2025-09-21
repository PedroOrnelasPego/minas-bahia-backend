import express from "express";
import {
  buscarPerfil,
  listarPerfis,
  upsertPerfil,
  atualizarPerfil,
} from "../services/cosmos.js";

const router = express.Router();

/** GET /perfil */
router.get("/", async (_req, res) => {
  try {
    const perfis = await listarPerfis();
    res.status(200).json(perfis);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao listar perfis." });
  }
});

/** GET /perfil/:email */
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

/**
 * POST /perfil
 * Agora é UPSERT:
 *  - 201 se criou
 *  - 200 se já existia e apenas consolidou
 */
router.post("/", async (req, res) => {
  try {
    const body = req.body || {};
    const email = body.email || body.id;
    if (!email) return res.status(400).json({ erro: "Email é obrigatório" });

    const existed = !!(await buscarPerfil(email));
    const salvo = await upsertPerfil(body);
    res.status(existed ? 200 : 201).json(salvo);
  } catch (err) {
    console.error("POST /perfil erro:", err?.message || err);
    res.status(500).json({ erro: "Erro ao criar/atualizar perfil." });
  }
});

/** PUT /perfil/:email (merge + canonicidade) */
router.put("/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const updates = req.body || {};
    const salvo = await atualizarPerfil(email, updates);
    res.json(salvo);
  } catch (err) {
    console.error("PUT /perfil erro:", err?.message || err);
    res.status(500).json({ erro: "Erro ao atualizar perfil." });
  }
});

export default router;
