// api/routes/perfilPublico.js
import express from "express";
import {
  buscarPerfil,
  upsertPerfil,
  checkCpfExists,
  normalizeCpf,
  hashCpf,
} from "../services/cosmos.js";

const router = express.Router();

// mesma whitelist que você usa no gate()
const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "https://zealous-bay-00b08311e.6.azurestaticapps.net",
  "https://icmbc.com.br",
  "https://www.icmbc.com.br",
]);

/**
 * helper que valida se requisição está vindo do seu front
 * (isso aqui substitui a exigência do cookie mbc_gate, só pra esta rota pública)
 */
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
    // Safari iOS às vezes manda POST sem origin/referer em cenários MUITO restritos,
    // mas em geral vindo do seu site mobile ele manda.
    // Se isso começar a bloquear demais, você pode AFROUXAR esse retorno e aceitar tudo.
    res.status(401).json({ erro: "Sem Origin/Referer" });
    return false;
  }

  return true;
}

/**
 * GET /perfil/__check/exists-cpf
 * usado no front pra avisar se o CPF já está cadastrado
 *
 * Continua público para funcionar antes de salvar.
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
    // Em caso de erro de infra, não vamos travar o cadastro à força.
    res.status(200).json({ exists: false });
  }
});

/**
 * POST /perfil
 * cadastro inicial
 *
 * 🔓 Agora ESSA rota não passa mais pelo gate() do cookie.
 * mas ainda validamos Origin/Referer pra evitar robô aleatório.
 */
router.post("/", async (req, res) => {
  try {
    // validação leve de origem
    if (!validarOrigemMinima(req, res)) return;

    const body = req.body || {};
    const email = body.email || body.id;
    if (!email) {
      return res.status(400).json({ erro: "Email é obrigatório" });
    }

    // normalizar + verificar CPF duplicado
    if (body.cpf) {
      const cpfDigits = normalizeCpf(body.cpf);
      if (cpfDigits.length !== 11) {
        return res.status(400).json({ erro: "CPF inválido" });
      }

      const cpfHash = hashCpf(cpfDigits);
      const exists = await checkCpfExists({ cpfHash, cpfDigits });

      if (exists && exists.email && exists.email !== email) {
        // já tem esse CPF em outro email
        return res.status(409).json({ erro: "CPF já cadastrado" });
      }

      body.cpf = cpfDigits;
      body.cpfHash = cpfHash;
    }

    // upsertPerfil já cria se não tem, atualiza se já tinha
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

export default router;
