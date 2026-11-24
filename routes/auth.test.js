import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import app from "../index.js";
import { container } from "../services/cosmos.js";

process.env.NODE_ENV = "test";

describe("Auth & Profile Integration Tests", () => {
  let server;
  let port;
  const testEmail = "test-automation-user@example.com";
  const adminTestEmail = "contato@capoeiraminasbahia.com.br";

  before(async () => {
    // Start server on a dynamic port
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        port = server.address().port;
        resolve();
      });
    });

    // Pre-clean database in case a previous run crashed
    try {
      await container.item(testEmail, testEmail).delete();
    } catch {
      /* ignore */
    }
  });

  after(async () => {
    // Clean up test email from database
    try {
      await container.item(testEmail, testEmail).delete();
    } catch {
      /* ignore */
    }
    
    // Close server
    await new Promise((resolve) => server.close(resolve));
  });

  test("POST /auth/google - create new guest profile on login", async () => {
    const res = await fetch(`http://localhost:${port}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: `mock-google-token-${testEmail}` })
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.email, testEmail);
    assert.ok(data.token);
    assert.strictEqual(data.novo, true);

    // Verify it was created in Cosmos DB as a 'visitante'
    const { resource: dbPerfil } = await container.item(testEmail, testEmail).read();
    assert.ok(dbPerfil);
    assert.strictEqual(dbPerfil.email, testEmail);
    assert.strictEqual(dbPerfil.nivelAcesso, "visitante");
  });

  test("POST /auth/google - reuse existing profile", async () => {
    const res = await fetch(`http://localhost:${port}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: `mock-google-token-${testEmail}` })
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.novo, false);
  });

  test("POST /auth/microsoft - reuse/login microsoft user", async () => {
    const res = await fetch(`http://localhost:${port}/auth/microsoft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: `mock-ms-token-${testEmail}` })
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.email, testEmail);
    assert.strictEqual(data.novo, false);
  });

  test("POST /auth/google - admin detection", async () => {
    const res = await fetch(`http://localhost:${port}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: `mock-google-token-${adminTestEmail}` })
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.email, adminTestEmail);
    
    // Decode token and verify it contains role 'admin'
    const parts = data.token.split(".");
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    assert.strictEqual(payload.role, "admin");
  });

  test("POST /perfil - create profile initial payload (public)", async () => {
    // Delete profile first to test initial registration
    try {
      await container.item(testEmail, testEmail).delete();
    } catch {}

    const newProfilePayload = {
      id: testEmail,
      email: testEmail,
      nome: "Test Automated User",
      cpf: "123.456.789-00",
      localTreino: "Centro",
      graduacao: "aluno",
      genero: "Masculino",
      dataNascimento: "1995-05-10",
      whatsApp: "31999999999",
      aceitouTermos: true
    };

    const res = await fetch(`http://localhost:${port}/perfil`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "http://localhost:4000"
      },
      body: JSON.stringify(newProfilePayload)
    });

    assert.ok(res.status === 200 || res.status === 201);
    const data = await res.json();
    assert.ok(data);

    // Verify it was correctly saved to Cosmos DB
    const { resource: dbPerfil } = await container.item(testEmail, testEmail).read();
    assert.ok(dbPerfil);
    assert.strictEqual(dbPerfil.nome, "Test Automated User");
    assert.strictEqual(dbPerfil.localTreino, "Centro");
    assert.strictEqual(dbPerfil.whatsApp, "31999999999");
    assert.strictEqual(dbPerfil.aceitouTermos, true);
  });
});
