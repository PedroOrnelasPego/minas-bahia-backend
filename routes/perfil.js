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
  reorganizarMatriculas,
  container,
} from "../services/cosmos.js";
import { updateCertificado } from "../services/cosmos.js";
import { containerClient } from "../services/storage.js";
import { requireAuth, requireAdmin } from "../middleware/gate.js";

const router = express.Router();

/**
 * @swagger
 * /perfil/reorganizar-matriculas:
 *   post:
 *     summary: Reorganiza e re-sequencia as matrículas de todos os alunos ativos (sem lacunas)
 *     tags: [Perfil (Protegido)]
 *     responses:
 *       200:
 *         description: Matrículas reorganizadas com sucesso
 *       500:
 *         description: Erro ao reorganizar matrículas
 */
router.post("/reorganizar-matriculas", async (_req, res) => {
  try {
    const resultado = await reorganizarMatriculas();
    res.status(200).json(resultado);
  } catch (err) {
    console.error("POST /perfil/reorganizar-matriculas erro:", err);
    res.status(500).json({ erro: "Erro ao reorganizar matrículas." });
  }
});


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
    const raw = await listarPerfis();

    // Verificamos a existência da foto para cada perfil em paralelo
    const perfis = await Promise.all(
      raw.map(async (u) => {
        const blobPath = `${u.email}/foto-perfil@1x.jpg`;
        const blobClient = containerClient.getBlobClient(blobPath);
        const hasFoto = await blobClient.exists();

        return {
          ...u,
          foto: hasFoto
            ? `https://certificadoscapoeira.blob.core.windows.net/certificados/${u.email}/foto-perfil@1x.jpg`
            : null,
        };
      })
    );

    res.status(200).json(perfis);
  } catch (err) {
    console.error("GET /perfil admin erro:", err);
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
    const { email } = req.params;
    const perfil = await buscarPerfil(email);
    if (!perfil) return res.status(404).json({ erro: "Perfil não encontrado" });

    // Verificamos a existência da foto para manter o front sincronizado
    const blobPath = `${email}/foto-perfil@1x.jpg`;
    const hasFoto = await containerClient.getBlobClient(blobPath).exists();

    res.json({
      ...perfil,
      foto: hasFoto
        ? `https://certificadoscapoeira.blob.core.windows.net/certificados/${email}/foto-perfil@1x.jpg`
        : null,
    });
  } catch (err) {
    console.error("GET /perfil/:email admin erro:", err);
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

/**
 * PUT /perfil/:email/nome
 * Atualiza apenas o nome do perfil
 */
router.put("/:email/nome", async (req, res) => {
  try {
    const { email } = req.params;
    const { nome } = req.body || {};
    if (typeof nome !== "string") {
      return res.status(400).json({ erro: "Nome é obrigatório." });
    }
    const salvo = await atualizarPerfil(email, { nome: nome.trim() });
    res.json(salvo);
  } catch (err) {
    console.error("PUT /perfil/:email/nome erro:", err);
    res.status(500).json({ erro: "Erro ao atualizar nome." });
  }
});

/**
 * PUT /perfil/:email/apelido
 * Atualiza apenas o apelido do perfil
 */
router.put("/:email/apelido", async (req, res) => {
  try {
    const { email } = req.params;
    const { apelido } = req.body || {};
    const valor = typeof apelido === "string" ? apelido.trim() : "";
    const salvo = await atualizarPerfil(email, { apelido: valor });
    res.json(salvo);
  } catch (err) {
    console.error("PUT /perfil/:email/apelido erro:", err);
    res.status(500).json({ erro: "Erro ao atualizar apelido." });
  }
});

/**
 * PUT /perfil/:email/data-nascimento
 * Atualiza a data de nascimento do perfil
 */
router.put("/:email/data-nascimento", async (req, res) => {
  try {
    const { email } = req.params;
    const { dataNascimento } = req.body || {};
    const salvo = await atualizarPerfil(email, { dataNascimento: (dataNascimento || "").trim() });
    res.json(salvo);
  } catch (err) {
    console.error("PUT /perfil/:email/data-nascimento erro:", err);
    res.status(500).json({ erro: "Erro ao atualizar data de nascimento." });
  }
});

/**
 * PUT /perfil/:email/inicio-no-grupo
 * Atualiza a data de início no grupo
 */
router.put("/:email/inicio-no-grupo", async (req, res) => {
  try {
    const { email } = req.params;
    const { inicioNoGrupo } = req.body || {};
    const salvo = await atualizarPerfil(email, { inicioNoGrupo: (inicioNoGrupo || "").trim() });
    res.json(salvo);
  } catch (err) {
    console.error("PUT /perfil/:email/inicio-no-grupo erro:", err);
    res.status(500).json({ erro: "Erro ao atualizar data de início no grupo." });
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
router.get("/__public/aniversarios", requireAuth(), async (req, res) => {
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

/**
 * DELETE /perfil/:email
 * Exclui o perfil do Cosmos DB de forma permanente.
 */
router.delete("/:email", requireAuth(), requireAdmin(), async (req, res) => {
  try {
    const { email } = req.params;
    await container.item(email, email).delete();
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /perfil/:email erro:", err?.message || err);
    res.status(500).json({ erro: "Erro ao excluir o perfil." });
  }
});

export default router;
