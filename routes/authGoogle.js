import express from "express";
import { OAuth2Client } from "google-auth-library";
import { buscarPerfil, upsertPerfil, isEmailAdmin } from "../services/cosmos.js";
import { makeSessionToken } from "../middleware/gate.js";

const router = express.Router();

const { GOOGLE_CLIENT_ID } = process.env;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// util simples p/ normalizar email
function cleanEmail(v) {
  if (!v) return null;
  const s = String(v)
    .trim()
    .replace(/^"+|"+$/g, "")
    .toLowerCase();
  return s.includes("@") ? s : null;
}

/**
 * @swagger
 * /auth/google:
 *   post:
 *     summary: Realiza o login utilizando o Token JWT fornecido pelo Google
 *     tags: [Autenticação]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - idToken
 *             properties:
 *               idToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Sucesso ao logar, retorna o perfil
 *       401:
 *         description: Token falso ou inválido
 */
router.post("/google", async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ erro: "Token ausente" });

    let email = null;
    if (process.env.NODE_ENV === "test" && idToken.startsWith("mock-google-token-")) {
      email = cleanEmail(idToken.replace("mock-google-token-", ""));
    } else {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();

      const emailRaw = payload?.email;
      email = cleanEmail(emailRaw);

      if (!email) {
        return res.status(401).json({ erro: "Email não encontrado no token" });
      }
      if (!payload.email_verified) {
        return res.status(401).json({ erro: "Email do Google não verificado" });
      }
    }

    // 👉 se já existe, NÃO sobrescreva (evita apagar cadastro)
    const existente = await buscarPerfil(email);

    if (!existente) {
      // cria casca padrão só na primeira vez
      await upsertPerfil({
        id: email,
        email,
        criadoVia: "google",
        nivelAcesso: "visitante",
        permissaoEventos: "leitor",
        aceitouTermos: false,
      });
    }

    const perfil = existente || { nivelAcesso: "visitante" };
    const role = isEmailAdmin(email) ? "admin" : (perfil.nivelAcesso === "administrador" ? "admin" : "user");
    const token = makeSessionToken(email, role);

    return res.status(200).json({ ok: true, email, token, novo: !existente });
  } catch (err) {
    console.error("Erro /auth/google:", err?.message || err);
    return res.status(401).json({ erro: "Token inválido ou rejeitado" });
  }
});

/**
 * @swagger
 * /auth/microsoft:
 *   post:
 *     summary: Realiza o login/validação utilizando o Token do Microsoft Graph
 *     tags: [Autenticação]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - accessToken
 *             properties:
 *               accessToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Retorna o email e o token assinado do backend
 *       401:
 *         description: Token inválido ou erro de comunicação com o Graph
 */
router.post("/microsoft", async (req, res) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken) return res.status(400).json({ erro: "Token ausente" });

    let email = null;
    if (process.env.NODE_ENV === "test" && accessToken.startsWith("mock-ms-token-")) {
      email = cleanEmail(accessToken.replace("mock-ms-token-", ""));
    } else {
      // Validar acessando o endpoint /me do Graph API
      const graphRes = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!graphRes.ok) {
        return res.status(401).json({ erro: "Token do AAD inválido ou rejeitado" });
      }

      const graphUser = await graphRes.json();
      const emailRaw = graphUser.mail || graphUser.userPrincipalName;
      email = cleanEmail(emailRaw);

      if (!email) {
        return res.status(401).json({ erro: "Email não encontrado no token do Microsoft Graph" });
      }
    }

    const existente = await buscarPerfil(email);

    if (!existente) {
      // cria casca padrão na primeira vez
      await upsertPerfil({
        id: email,
        email,
        criadoVia: "microsoft",
        nivelAcesso: "visitante",
        permissaoEventos: "leitor",
        aceitouTermos: false,
      });
    }

    const perfil = existente || { nivelAcesso: "visitante" };
    const role = isEmailAdmin(email) ? "admin" : (perfil.nivelAcesso === "administrador" ? "admin" : "user");
    const token = makeSessionToken(email, role);

    return res.status(200).json({ ok: true, email, token, novo: !existente });
  } catch (err) {
    console.error("Erro /auth/microsoft:", err?.message || err);
    return res.status(401).json({ erro: "Falha na autenticação Microsoft" });
  }
});

export default router;

