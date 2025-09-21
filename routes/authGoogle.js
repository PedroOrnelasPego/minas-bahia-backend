import express from "express";
import { OAuth2Client } from "google-auth-library";
import { buscarPerfil, upsertPerfil } from "../services/cosmos.js";

const router = express.Router();

const { GOOGLE_CLIENT_ID } = process.env;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

router.post("/google", async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ erro: "Token ausente" });

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    if (!payload?.email) {
      return res.status(401).json({ erro: "Email não encontrado no token" });
    }
    if (!payload.email_verified) {
      return res.status(401).json({ erro: "Email do Google não verificado" });
    }

    const email = payload.email;

    // Se não existir, grava casca padronizada; se existir, apenas garante canonicidade.
    const jaExiste = !!(await buscarPerfil(email));
    await upsertPerfil({
      id: email,
      email,
      criadoVia: "google",
      // não preenche nome aqui — o front coleta no CadastroInicial
      nivelAcesso: "visitante",
      permissaoEventos: "leitor",
      aceitouTermos: false,
    });

    return res.status(200).json({ ok: true, email, novo: !jaExiste });
  } catch (err) {
    console.error("Erro /auth/google:", err?.message || err);
    return res.status(401).json({ erro: "Token inválido ou rejeitado" });
  }
});

export default router;
