// api/middlewares/auth.js
import jwt from "jsonwebtoken";

const APP_JWT_SECRET = process.env.APP_JWT_SECRET || "troque-esta-chave"; // use 32+ chars

export function issueAppToken(payload, opts = {}) {
  // payload: { email, roles?: ["admin"] }
  return jwt.sign(payload, APP_JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: opts.expiresIn || "12h",
    audience: "icmbc-app",
    issuer: "icmbc-backend",
  });
}

export function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ erro: "Unauthorized" });
  try {
    const payload = jwt.verify(token, APP_JWT_SECRET, {
      audience: "icmbc-app",
      issuer: "icmbc-backend",
    });
    req.user = payload; // { email, roles? }
    return next();
  } catch (e) {
    return res.status(401).json({ erro: "Invalid token" });
  }
}

export function requireSelfOrAdmin(paramName = "email") {
  return (req, res, next) => {
    const target = (req.params?.[paramName] || "").toLowerCase();
    const userEmail = (req.user?.email || "").toLowerCase();
    const isAdmin =
      Array.isArray(req.user?.roles) && req.user.roles.includes("admin");
    if (isAdmin || (target && userEmail === target)) return next();
    return res.status(403).json({ erro: "Forbidden" });
  };
}

export function requireAdmin(_req, res, next) {
  const isAdmin =
    Array.isArray(_req.user?.roles) && _req.user.roles.includes("admin");
  if (!isAdmin) return res.status(403).json({ erro: "Admins only" });
  return next();
}
