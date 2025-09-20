// src/routes/authGoogle.js
import express from "express";
import { OAuth2Client } from "google-auth-library";
import { buscarPerfil, criarPerfil, container } from "../services/cosmos.js";

const router = express.Router();

const { GOOGLE_CLIENT_ID } = process.env;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

router.post("/google", async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ erro: "Token ausente" });

    // Valida assinatura e audiência
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload(); // sub, email, email_verified, name...

    if (!payload?.email) {
      return res.status(401).json({ erro: "Email não encontrado no token" });
    }
    if (!payload.email_verified) {
      return res.status(401).json({ erro: "Email do Google não verificado" });
    }

    const email = payload.email;

    // lookup por email (é o seu id e partition key)
    let perfil = await buscarPerfil(email);

    if (!perfil) {
      // cria só o mínimo; o restante você coleta no CadastroInicial
      perfil = await criarPerfil({
        id: email,                 // PK
        email,
        nome: "",                  // você usa o nome do seu cadastro próprio
        criadoVia: "google",
        nivelAcesso: "visitante",
        permissaoEventos: "leitor",
        aceitouTermos: false,
        createdAt: new Date().toISOString(),
      });
    }

    // (opcional) se preferir, dê um replace/upsert para garantir consistência:
    // await container.item(email, email).replace(perfil);

    // TODO: aqui você pode emitir a sessão da sua app (cookie httpOnly ou JWT)
    // res.cookie("app_session", token, { httpOnly: true, secure: true, sameSite: "lax" });

    return res.status(200).json({ ok: true, email });
  } catch (err) {
    console.error("Erro /auth/google:", err?.message || err);
    return res.status(401).json({ erro: "Token inválido ou rejeitado" });
  }
});

export default router;
