// src/middleware/gate.js
import crypto from "crypto";
import cookie from "cookie";

const SECRET = process.env.PORTAL_GATE_SECRET || "dev-secret-change-me";

// helpers
function hmac(data) {
  return crypto.createHmac("sha256", SECRET).update(data).digest("hex");
}

function makeToken({ ip, ua, ts }) {
  const payload = JSON.stringify({ ip, ua, ts }); // ts = timestamp (segundos)
  const sig = hmac(payload);
  // base64url
  const enc = Buffer.from(payload).toString("base64url");
  return `${enc}.${sig}`;
}

function parseToken(tok) {
  if (!tok || !tok.includes(".")) return null;
  const [enc, sig] = tok.split(".");
  const payload = Buffer.from(enc, "base64url").toString("utf8");
  if (hmac(payload) !== sig) return null;
  try {
    return JSON.parse(payload); // { ip, ua, ts }
  } catch {
    return null;
  }
}

function isExpired(ts, ttlSec = 2 * 60 * 60) {
  // 2h
  const now = Math.floor(Date.now() / 1000);
  return ts + ttlSec < now;
}

// domínio permitido (prod/dev)
const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "https://zealous-bay-00b08311e.6.azurestaticapps.net",
  "https://www.icmbc.com.br",
  "https://icmbc.com.br",
]);

// Middleware principal
export function gate() {
  return (req, res, next) => {
    // 1) Em qualquer GET “de página” nós setamos o cookie (para o navegador)
    //    – não atrapalha APIs; apenas prepara o cookie.
    if (req.method === "GET") {
      const ip = (
        req.headers["x-forwarded-for"] ||
        req.socket.remoteAddress ||
        ""
      )
        .toString()
        .split(",")[0]
        .trim();
      const ua = (req.headers["user-agent"] || "").toString().slice(0, 200);
      const ts = Math.floor(Date.now() / 1000);
      const token = makeToken({ ip, ua, ts });

      res.setHeader(
        "Set-Cookie",
        cookie.serialize("mbc_gate", token, {
          httpOnly: true,
          sameSite: "lax",
          secure: true,
          path: "/",
          maxAge: 2 * 60 * 60, // 2h
        })
      );
      return next();
    }

    // 2) Para métodos que alteram estado, exigimos o cookie + Origin/Referer
    const needsGate = /^(POST|PUT|PATCH|DELETE)$/i.test(req.method);
    if (!needsGate) return next();

    const origin = (req.headers.origin || "").toString();
    const referer = (req.headers.referer || "").toString();
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return res.status(401).json({ error: "Origin não permitido" });
    }
    if (!origin && referer) {
      // fallback: validar o host do referer
      try {
        const u = new URL(referer);
        const refOrigin = `${u.protocol}//${u.host}`;
        if (!ALLOWED_ORIGINS.has(refOrigin)) {
          return res.status(401).json({ error: "Referer não permitido" });
        }
      } catch {
        return res.status(401).json({ error: "Referer inválido" });
      }
    } else if (!origin && !referer) {
      return res.status(401).json({ error: "Sem Origin/Referer" });
    }

    const cookies = cookie.parse(req.headers.cookie || "");
    const tok = cookies.mbc_gate;
    const data = parseToken(tok);
    if (!data) return res.status(401).json({ error: "Sessão inválida" });

    // opcional: amarrar ao IP/UA atuais (relaxa se sua rede troca IP)
    const ip = (
      req.headers["x-forwarded-for"] ||
      req.socket.remoteAddress ||
      ""
    )
      .toString()
      .split(",")[0]
      .trim();
    const ua = (req.headers["user-agent"] || "").toString().slice(0, 200);
    if (data.ua !== ua)
      return res.status(401).json({ error: "Sessão não reconhecida" });
    // if (data.ip !== ip) return res.status(401).json({ error: "IP mudou" });

    if (isExpired(data.ts))
      return res.status(401).json({ error: "Sessão expirada" });

    return next();
  };
}
