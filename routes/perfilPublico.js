// api/routes/perfilPublico.js
import express from "express";
import {
  buscarPerfil,
  upsertPerfil,
  atualizarPerfil,
  checkCpfExists,
  normalizeCpf,
  hashCpf,
} from "../services/cosmos.js";

const router = express.Router();

const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://localhost:4000",
  "https://zealous-bay-00b08311e.6.azurestaticapps.net",
  "https://icmbc.com.br",
  "https://www.icmbc.com.br",
]);

function validarOrigemMinima(req, res) {
  const origin = (req.headers.origin || "").toString();
  const referer = (req.headers.referer || "").toString();

  if (origin) {
    if (!ALLOWED_ORIGINS.has(origin)) {
      res.status(401).json({ erro: "Origin não permitido" });
      return false;
    }
  } else if (referer) {
    try {
      const u = new URL(referer);
      const refOrigin = `${u.protocol}//${u.host}`;
      if (!ALLOWED_ORIGINS.has(refOrigin)) {
        res.status(401).json({ erro: "Referer não permitido" });
        return false;
      }
    } catch {
      res.status(401).json({ erro: "Referer inválido" });
      return false;
    }
  } else {
    // se quiser ser ultra liberal pro Safari iOS, você pode trocar este bloco por `return true;`
    res.status(401).json({ erro: "Sem Origin/Referer" });
    return false;
  }

  return true;
}

/**
 * @swagger
 * /perfil/__check/exists-cpf:
 *   get:
 *     summary: Verifica se um CPF já possui cadastro no sistema
 *     tags: [Perfil Público]
 *     parameters:
 *       - in: query
 *         name: cpf
 *         schema:
 *           type: string
 *         description: Apenas os números do CPF a ser consultado
 *     responses:
 *       200:
 *         description: Retorna se existe ou não (booleano)
 */
router.get("/__check/exists-cpf", async (req, res) => {
  try {
    const cpfParam = String(req.query.cpf || "").trim();
    const hashParam = String(req.query.hash || "").trim();

    let cpfDigits = "";
    let cpfHash = "";

    if (cpfParam) {
      cpfDigits = normalizeCpf(cpfParam);
      if (cpfDigits.length !== 11) {
        return res.json({ exists: false });
      }
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
    res.status(200).json({ exists: false });
  }
});

/**
 * @swagger
 * /perfil:
 *   post:
 *     summary: Criação ou atualização do cadastro inicial
 *     tags: [Perfil Público]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *               cpf:
 *                 type: string
 *     responses:
 *       200:
 *         description: Usuário existente foi atualizado
 *       201:
 *         description: Novo usuário foi cadastrado
 */
router.post("/", async (req, res) => {
  try {
    if (!validarOrigemMinima(req, res)) return;

    const body = req.body || {};
    const email = body.email || body.id;
    if (!email) {
      return res.status(400).json({ erro: "Email é obrigatório" });
    }

    if (body.cpf) {
      const cpfDigits = normalizeCpf(body.cpf);
      if (cpfDigits.length !== 11) {
        return res.status(400).json({ erro: "CPF inválido" });
      }

      const cpfHash = hashCpf(cpfDigits);
      const exists = await checkCpfExists({ cpfHash, cpfDigits });

      if (exists && exists.email && exists.email !== email) {
        return res.status(409).json({ erro: "CPF já cadastrado" });
      }

      body.cpf = cpfDigits;
      body.cpfHash = cpfHash;
    }

    const already = await buscarPerfil(email);
    const salvo = await upsertPerfil({
      ...body,
      id: email,
      email,
    });

    res.status(already ? 200 : 201).json(salvo);
  } catch (err) {
    console.error("POST /perfil erro:", err?.message || err);
    res
      .status(500)
      .json({ erro: "Erro ao criar/atualizar perfil no cadastro inicial." });
  }
});

/**
 * PUT /perfil/self
 * atualização de perfil do PRÓPRIO usuário, sem gate()
 * o front vai mandar { email, ...dadosEditados }
 */
router.put("/self", async (req, res) => {
  try {
    if (!validarOrigemMinima(req, res)) return;

    const body = req.body || {};
    const email = body.email || body.id;
    if (!email) {
      return res.status(400).json({ erro: "Email é obrigatório" });
    }

    // não deixo mudar cpf pra um já usado por outro
    if (body.cpf) {
      const cpfDigits = normalizeCpf(body.cpf);
      if (cpfDigits.length !== 11) {
        return res.status(400).json({ erro: "CPF inválido" });
      }

      const cpfHash = hashCpf(cpfDigits);
      const exists = await checkCpfExists({ cpfHash, cpfDigits });
      if (exists && exists.email !== email) {
        return res.status(409).json({ erro: "CPF já cadastrado" });
      }

      body.cpf = cpfDigits;
      body.cpfHash = cpfHash;
    }

    // agora usa a mesma lógica de atualizarPerfil que a rota protegida usa
    const salvo = await atualizarPerfil(email, body);
    res.status(200).json(salvo);
  } catch (err) {
    console.error("PUT /perfil/self erro:", err?.message || err);
    res.status(500).json({ erro: "Erro ao atualizar seu perfil." });
  }
});

export default router;
