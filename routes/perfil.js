// api/routes/perfil.js
import express from "express";
import {
  buscarPerfil,
  listarPerfis,
  atualizarPerfil,
  checkCpfExists,
  normalizeCpf,
  hashCpf,
  listarAniversariosPorMes,
  listarAniversariosBasico,
} from "../services/cosmos.js";
import { updateCertificado } from "../services/cosmos.js";

const router = express.Router();

/**
 * @swagger
 * /perfil:
 *   get:
 *     summary: Lista todos os perfis cadastrados no sistema (Uso Administrativo)
 *     tags: [Perfil (Protegido)]
 *     responses:
 *       200:
 *         description: Retorna array com todos os perfis
 *       401:
 *         description: Acesso não autorizado (Necessita login)
 */
router.get("/", async (_req, res) => {
  try {
    const perfis = await listarPerfis();
    res.status(200).json(perfis);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao listar perfis." });
  }
});

/**
 * @swagger
 * /perfil/{email}:
 *   get:
 *     summary: Busca um perfil específico pelo ID (email)
 *     tags: [Perfil (Protegido)]
 *     parameters:
 *       - in: path
 *         name: email
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Perfil completo encontrado
 *       404:
 *         description: Usuário não existe
 */
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
 * @swagger
 * /perfil/{email}:
 *   put:
 *     summary: Atualiza/mergeia os dados de um perfil existente
 *     tags: [Perfil (Protegido)]
 *     parameters:
 *       - in: path
 *         name: email
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Atualizado com sucesso
 */
router.put("/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const updates = { ...(req.body || {}) };

    // validação/normalização do CPF
    if (updates.cpf) {
      const cpfDigits = normalizeCpf(updates.cpf);
      if (cpfDigits.length !== 11) {
        return res.status(400).json({ erro: "CPF inválido" });
      }

      const cpfHash = hashCpf(cpfDigits);
      const exists = await checkCpfExists({ cpfHash, cpfDigits });
      if (exists && exists.email !== email) {
        return res.status(409).json({ erro: "CPF já cadastrado" });
      }

      updates.cpf = cpfDigits;
      updates.cpfHash = cpfHash;
    }

    const salvo = await atualizarPerfil(email, updates);
    res.json(salvo);
  } catch (err) {
    console.error("PUT /perfil erro:", err?.message || err);
    res.status(500).json({ erro: "Erro ao atualizar perfil." });
  }
});

/** GET /perfil/:email/certificados
 * Timeline de certificados do usuário
 * PROTEGIDO PELO gate()
 */
router.get("/:email/certificados", async (req, res) => {
  try {
    const perfil = await buscarPerfil(req.params.email);
    if (!perfil) return res.status(404).json({ erro: "Perfil não encontrado" });
    res.json(perfil.certificadosTimeline || []);
  } catch (e) {
    res.status(500).json({ erro: "Erro ao buscar timeline." });
  }
});

/** PUT /perfil/:email/certificados/:id
 * Aprovar/reprovar certificado (Painel Admin)
 * PROTEGIDO PELO gate()
 */
router.put("/:email/certificados/:id", async (req, res) => {
  try {
    const { email, id } = req.params;
    const { status, observacao, atualizarCorda } = req.body || {};

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ erro: "status inválido" });
    }

    const perfil = await buscarPerfil(email);
    if (!perfil) return res.status(404).json({ erro: "Perfil não encontrado" });

    const atualizado = await updateCertificado(email, id, {
      status,
      revisao: {
        por: "contato@capoeiraminasbahia.com.br",
        em: new Date().toISOString(),
        observacao: observacao || "",
      },
    });

    if (status === "approved" && atualizarCorda === true) {
      const cert = (atualizado.certificadosTimeline || []).find(
        (c) => c.id === id
      );
      if (cert) {
        await atualizarPerfil(email, {
          corda: cert.corda,
          cordaVerificada: true,
        });
      }
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("PUT /perfil/:email/certificados/:id", e.message);
    res.status(500).json({ erro: "Erro ao atualizar certificado." });
  }
});

/** GET /perfil/__admin/pendentes
 * Lista global de certificados pendentes
 * PROTEGIDO PELO gate()
 */
router.get("/__admin/pendentes", async (_req, res) => {
  try {
    const todos = await listarPerfis();
    const pendentes = [];
    for (const p of todos) {
      for (const c of p.certificadosTimeline || []) {
        if (c.status === "pending") {
          pendentes.push({
            email: p.email,
            nome: p.nome,
            ...c,
          });
        }
      }
    }
    res.json(pendentes);
  } catch (e) {
    res.status(500).json({ erro: "Erro ao listar pendentes." });
  }
});

/**
 * @swagger
 * /perfil/__public/aniversarios:
 *   get:
 *     summary: Lista global de aniversariantes (Pode ser filtrada por mês)
 *     tags: [Perfil (Protegido)]
 *     parameters:
 *       - in: query
 *         name: month
 *         schema:
 *           type: integer
 *         description: Mês de vencimento (ex 1 a 12)
 *     responses:
 *       200:
 *         description: Retorna a lista de capoeiristas que fazem aniversário
 */
router.get("/__public/aniversarios", async (req, res) => {
  try {
    const month = req.query.month ? Number(req.query.month) : null;
    const limit = req.query.limit ? Number(req.query.limit) : 2000;

    const rows = month
      ? await listarAniversariosPorMes(month, { limit })
      : await listarAniversariosBasico({ limit });

    res.json(rows);
  } catch (e) {
    console.error("GET /perfil/__public/aniversarios", e?.message || e);
    res.status(500).json({ erro: "Erro ao listar aniversários." });
  }
});

export default router;
