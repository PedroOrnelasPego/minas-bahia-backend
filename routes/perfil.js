// api/routes/perfil.js
import express from "express";
import {
  buscarPerfil,
  listarPerfis,
  upsertPerfil,
  atualizarPerfil,
  checkCpfExists,
  normalizeCpf,
  hashCpf,
} from "../services/cosmos.js";
import { updateCertificado } from "../services/cosmos.js";

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
 * GET /perfil/exists-cpf?cpf=00000000000
 * (ou ?hash=sha256...)
 * Retorna { exists: true|false }
 */
router.get("/__check/exists-cpf", async (req, res) => {
  try {
    const cpfParam = String(req.query.cpf || "").trim();
    const hashParam = String(req.query.hash || "").trim();

    let cpfDigits = "";
    let cpfHash = "";

    if (cpfParam) {
      cpfDigits = normalizeCpf(cpfParam); // só dígitos
      if (cpfDigits.length !== 11) return res.json({ exists: false });
      cpfHash = hashCpf(cpfDigits);
    } else if (hashParam) {
      cpfHash = hashParam;
    } else {
      return res.json({ exists: false });
    }

    const exists = await checkCpfExists({
      cpfHash,
      cpfDigits: cpfDigits || null,
    });
    res.json({ exists: Boolean(exists) });
  } catch (err) {
    console.error("GET /perfil/__check/exists-cpf", err?.message || err);
    res.status(200).json({ exists: false }); // falha de rede não deve travar o fluxo
  }
});

/**
 * POST /perfil
 * - UPSERT com verificação de CPF (se vier no body)
 * 201 se criou, 200 se upsert (já existia)
 */
router.post("/", async (req, res) => {
  try {
    const body = req.body || {};
    const email = body.email || body.id;
    if (!email) return res.status(400).json({ erro: "Email é obrigatório" });

    // CPF (opcional) — se vier, normaliza, gera hash e verifica duplicidade
    if (body.cpf) {
      const cpfDigits = normalizeCpf(body.cpf);
      if (cpfDigits.length !== 11) {
        return res.status(400).json({ erro: "CPF inválido" });
      }
      const cpfHash = hashCpf(cpfDigits);

      const exists = await checkCpfExists({ cpfHash, cpfDigits });
      if (exists) {
        // Se já existe um perfil com esse CPF e NÃO é este email, bloqueia
        if (exists.email && exists.email !== email) {
          return res.status(409).json({ erro: "CPF já cadastrado" });
        }
      }

      body.cpf = cpfDigits;
      body.cpfHash = cpfHash;
    }

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
    const updates = { ...(req.body || {}) };

    // Se for atualizar/incluir CPF, verifica duplicidade
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

// timeline do usuário (ou já vem embutida no GET /perfil/:email)
router.get("/:email/certificados", async (req, res) => {
  try {
    const perfil = await buscarPerfil(req.params.email);
    if (!perfil) return res.status(404).json({ erro: "Perfil não encontrado" });
    res.json(perfil.certificadosTimeline || []);
  } catch (e) {
    res.status(500).json({ erro: "Erro ao buscar timeline." });
  }
});

// aprovar/reprovar um certificado (Painel Admin)
router.put("/:email/certificados/:id", async (req, res) => {
  try {
    const { email, id } = req.params;
    const { status, observacao, atualizarCorda } = req.body || {}; // status = "approved" | "rejected"

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

    // se aprovado e quiser refletir no perfil
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

// lista global de pendentes (para a página Admin)
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

export default router;
