// routes/authApp.js
import express from "express";
import crypto from "node:crypto";
import { saveOtp, verifyAndConsumeOtp } from "../services/otpStore.js";
import { issueAppToken } from "../middlewares/auth.js";
import { buscarPerfil } from "../services/cosmos.js";

const router = express.Router();

// sanitiza e-mail
function cleanEmail(v) {
  return String(v || "").trim().replace(/^"+|"+$/g, "").toLowerCase();
}

// ⛳ Inicia login: gera OTP (6 dígitos) e envia (por enquanto só loga no console)
router.post("/app/start", async (req, res) => {
  try {
    const email = cleanEmail(req.body?.email);
    if (!email || !email.includes("@")) {
      return res.status(400).json({ erro: "Email inválido" });
    }

    const code = ("" + crypto.randomInt(0, 999999)).padStart(6, "0");
    await saveOtp(email, code);

    // TODO: enviar via e-mail real (SMTP/SendGrid).
    console.log(`[OTP] ${email} -> ${code}`);

    return res.status(200).json({
      ok: true,
      // Em produção não retorne o code.
      code: process.env.NODE_ENV === "production" ? undefined : code,
      expiresInSec: 600,
    });
  } catch (e) {
    console.error("POST /auth/app/start", e);
    return res.status(500).json({ erro: "Falha ao iniciar login" });
  }
});

// ✅ Verifica OTP e devolve JWT da aplicação
router.post("/app/verify", async (req, res) => {
  try {
    const email = cleanEmail(req.body?.email);
    const code = String(req.body?.code || "");
    if (!email || !email.includes("@") || code.length !== 6) {
      return res.status(400).json({ erro: "Dados inválidos" });
    }

    const ok = await verifyAndConsumeOtp(email, code);
    if (!ok) return res.status(401).json({ erro: "Código inválido/expirado" });

    // opcional: carrega roles do perfil
    const perfil = await buscarPerfil(email);
    const roles = [];
    if (perfil?.nivelAcesso === "instrutor" || perfil?.nivelAcesso === "professor") {
      roles.push("admin");
    }

    const token = issueAppToken({ email, roles });
    return res.json({ ok: true, token });
  } catch (e) {
    console.error("POST /auth/app/verify", e);
    return res.status(500).json({ erro: "Falha ao verificar código" });
  }
});

export default router;
