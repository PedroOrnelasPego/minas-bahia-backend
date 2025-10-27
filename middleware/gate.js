// api/middleware/gate.js
import crypto from "crypto";
import cookie from "cookie";

const SECRET = process.env.PORTAL_GATE_SECRET || "dev-secret-change-me";

// -------- helpers --------
function hmac(data) {
  return crypto.createHmac("sha256", SECRET).update(data).digest("hex");
}
function makeToken({ ip, ua, ts }) {
  const payload = JSON.stringify({ ip, ua, ts });
  const sig = hmac(payload);
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
  const now = Math.floor(Date.now() / 1000);
  return ts + ttlSec < now;
}

const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "https://zealous-bay-00b08311e.6.azurestaticapps.net",
  "https://icmbc.com.br",
  "https://www.icmbc.com.br",
]);

export function gate() {
  return (req, res, next) => {
    // Sempre deixe preflight passar
    if (req.method === "OPTIONS") return res.sendStatus(204);

    // Rotas públicas que não devem ser bloqueadas
    if (req.path.startsWith("/auth/")) return next();
    if (req.path === "/" || req.path === "/health") return next();

    // Em GETs, apenas setamos um cookie de sessão leve
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
          sameSite: "none",
          secure: true,
          path: "/",
          maxAge: 2 * 60 * 60,
        })
      );
      return next();
    }

    // Para métodos que alteram estado, validar Origin/Referer + cookie
    const origin = (req.headers.origin || "").toString();
    const referer = (req.headers.referer || "").toString();

    if (origin) {
      if (!ALLOWED_ORIGINS.has(origin)) {
        return res.status(401).json({ error: "Origin não permitido" });
      }
    } else if (referer) {
      try {
        const u = new URL(referer);
        const refOrigin = `${u.protocol}//${u.host}`;
        if (!ALLOWED_ORIGINS.has(refOrigin)) {
          return res.status(401).json({ error: "Referer não permitido" });
        }
      } catch {
        return res.status(401).json({ error: "Referer inválido" });
      }
    } else {
      return res.status(401).json({ error: "Sem Origin/Referer" });
    }

    const cookies = cookie.parse(req.headers.cookie || "");
    const tok = cookies.mbc_gate;
    const data = parseToken(tok);
    if (!data) return res.status(401).json({ error: "Sessão inválida" });

    const ip = (
      req.headers["x-forwarded-for"] ||
      req.socket.remoteAddress ||
      ""
    )
      .toString()
      .split(",")[0]
      .trim();
    const ua = (req.headers["user-agent"] || "").toString().slice(0, 200);

    // Amarra ao user-agent atual (IP pode variar dependendo do provedor)
    if (data.ua !== ua)
      return res.status(401).json({ error: "Sessão não reconhecida" });
    if (isExpired(data.ts))
      return res.status(401).json({ error: "Sessão expirada" });

    return next();
  };
}
