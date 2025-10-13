import express from "express";
import { OAuth2Client } from "google-auth-library";
import { buscarPerfilSmart, upsertPerfil } from "../services/cosmos.js";

const router = express.Router();

const { GOOGLE_CLIENT_ID } = process.env;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

function cleanEmail(v) {
  if (!v) return null;
  const s = String(v)
    .trim()
    .replace(/^"+|"+$/g, "")
    .toLowerCase();
  return s.includes("@") ? s : null;
}

router.post("/google", async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ erro: "Token ausente" });

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    const email = cleanEmail(payload?.email);
    if (!email)
      return res.status(401).json({ erro: "Email não encontrado no token" });
    if (!payload.email_verified) {
      return res.status(401).json({ erro: "Email do Google não verificado" });
    }

    // busca inteligente (migra se houver doc legado)
    const existente = await buscarPerfilSmart(email);

    if (!existente) {
      await upsertPerfil({
        id: email,
        email,
        criadoVia: "google",
        nivelAcesso: "visitante",
        permissaoEventos: "leitor",
        aceitouTermos: false,
        createdAt: new Date().toISOString(),
      });
    }

    return res.status(200).json({ ok: true, email, novo: !existente });
  } catch (err) {
    console.error("Erro /auth/google:", err?.message || err);
    return res.status(401).json({ erro: "Token inválido ou rejeitado" });
  }
});

export default router;
