import { test, describe } from "node:test";
import assert from "node:assert";
import crypto from "crypto";
import { makeSessionToken, parseSessionToken, requireAuth, requireAdmin } from "./gate.js";

// Mock environment secret
process.env.PORTAL_GATE_SECRET = "test-secret-key-12345";

describe("Gate Middleware & Token Tests", () => {
  test("should generate and parse valid token", () => {
    const token = makeSessionToken("user@example.com", "user");
    assert.ok(token);
    assert.strictEqual(typeof token, "string");
    
    const parsed = parseSessionToken(token);
    assert.ok(parsed);
    assert.strictEqual(parsed.email, "user@example.com");
    assert.strictEqual(parsed.role, "user");
  });

  test("should reject token with invalid signature", () => {
    const token = makeSessionToken("user@example.com", "user");
    const corruptedToken = token + "extra";
    const parsed = parseSessionToken(corruptedToken);
    assert.strictEqual(parsed, null);
  });

  test("should reject token if payload is tampered", () => {
    const token = makeSessionToken("user@example.com", "user");
    const parts = token.split(".");
    const fakePayload = Buffer.from(JSON.stringify({ email: "admin@example.com", role: "admin" })).toString("base64url");
    const fakeToken = `${fakePayload}.${parts[1]}`;
    const parsed = parseSessionToken(fakeToken);
    assert.strictEqual(parsed, null);
  });

  test("requireAuth middleware - allowed request", () => {
    const token = makeSessionToken("user@example.com", "user");
    const req = {
      headers: {
        authorization: `Bearer ${token}`
      }
    };
    let nextCalled = false;
    const res = {};
    const next = () => {
      nextCalled = true;
    };

    const middleware = requireAuth();
    middleware(req, res, next);

    assert.ok(nextCalled);
    assert.ok(req.user);
    assert.strictEqual(req.user.email, "user@example.com");
    assert.strictEqual(req.user.role, "user");
  });

  test("requireAuth middleware - unauthorized request (no token)", () => {
    const req = {
      headers: {}
    };
    let statusSet = null;
    let jsonSent = null;
    const res = {
      status(code) {
        statusSet = code;
        return {
          json(data) {
            jsonSent = data;
          }
        };
      }
    };
    let nextCalled = false;
    const next = () => {
      nextCalled = true;
    };

    const middleware = requireAuth();
    middleware(req, res, next);

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(statusSet, 401);
    assert.strictEqual(jsonSent.erro, "Autenticação requerida");
  });

  test("requireAuth middleware - expired session", () => {
    // Generate token with an expired timestamp (e.g. 8 days ago)
    const eightDaysAgo = Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60;
    const payload = JSON.stringify({
      email: "user@example.com",
      role: "user",
      ts: eightDaysAgo
    });
    
    const hmac = crypto.createHmac("sha256", "test-secret-key-12345").update(payload).digest("hex");
    const enc = Buffer.from(payload).toString("base64url");
    const expiredToken = `${enc}.${hmac}`;

    const req = {
      headers: {
        authorization: `Bearer ${expiredToken}`
      }
    };
    let statusSet = null;
    let jsonSent = null;
    const res = {
      status(code) {
        statusSet = code;
        return {
          json(data) {
            jsonSent = data;
          }
        };
      }
    };
    let nextCalled = false;
    const next = () => {
      nextCalled = true;
    };

    const middleware = requireAuth();
    middleware(req, res, next);

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(statusSet, 401);
    assert.strictEqual(jsonSent.erro, "Sessão expirada");
  });

  test("requireAdmin middleware - allowed for admin", () => {
    const token = makeSessionToken("admin@example.com", "admin");
    const req = {
      headers: {
        authorization: `Bearer ${token}`
      }
    };
    let nextCalled = false;
    const res = {};
    const next = () => {
      nextCalled = true;
    };

    const middlewares = requireAdmin();
    // Run requireAuth first, then requireAdmin check
    middlewares[0](req, res, () => {
      middlewares[1](req, res, next);
    });

    assert.ok(nextCalled);
    assert.ok(req.user);
    assert.strictEqual(req.user.email, "admin@example.com");
    assert.strictEqual(req.user.role, "admin");
  });

  test("requireAdmin middleware - forbidden for standard user", () => {
    const token = makeSessionToken("user@example.com", "user");
    const req = {
      headers: {
        authorization: `Bearer ${token}`
      }
    };
    let statusSet = null;
    let jsonSent = null;
    const res = {
      status(code) {
        statusSet = code;
        return {
          json(data) {
            jsonSent = data;
          }
        };
      }
    };
    let nextCalled = false;
    const next = () => {
      nextCalled = true;
    };

    const middlewares = requireAdmin();
    middlewares[0](req, res, () => {
      middlewares[1](req, res, next);
    });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(statusSet, 403);
    assert.strictEqual(jsonSent.erro, "Acesso administrativo requerido");
  });
});
