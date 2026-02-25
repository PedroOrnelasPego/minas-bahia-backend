// api/routes/chamada.js
import express from "express";
import dotenv from "dotenv";
import crypto from "node:crypto";
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
} from "@azure/storage-blob";
import { listarPessoasParaChamada } from "../services/cosmos.js";

dotenv.config();

const router = express.Router();

const ID_SECRET =
  process.env.CHAMADA_ID_SECRET ||
  process.env.PORTAL_GATE_SECRET ||
  "dev-secret-change-me";

function pessoaIdFromEmail(email) {
  const clean = String(email || "")
    .trim()
    .toLowerCase();
  if (!clean) return "";
  // ID estável, não reversível sem o segredo.
  // Truncado para ficar curto no payload.
  return crypto
    .createHmac("sha256", ID_SECRET)
    .update(clean)
    .digest("base64url")
    .slice(0, 22);
}

function normalizeEntryId(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  // Legado: entries armazenavam emails. Convertemos para ID.
  if (s.includes("@")) return pessoaIdFromEmail(s);
  return s;
}

function normalizeEntries(entries) {
  if (!entries || typeof entries !== "object") return {};
  const out = {};
  for (const [dateISO, arr] of Object.entries(entries)) {
    const list = Array.isArray(arr) ? arr : [];
    const mapped = list.map(normalizeEntryId).filter(Boolean);
    out[dateISO] = Array.from(new Set(mapped));
  }
  return out;
}

function normalizePayload(payload, monthISO) {
  const p = payload && typeof payload === "object" ? payload : {};
  return {
    ...p,
    monthISO,
    entries: normalizeEntries(p.entries),
    schemaVersion: 2,
  };
}

/* ============================================================================
   CONFIGURAÇÃO DO AZURE BLOB (mesmo padrão do upload.js)
   ========================================================================== */
// Container próprio para não poluir o container de certificados
const containerName = process.env.CHAMADA_CONTAINER_NAME || "chamada";
// Legado (onde a chamada era salva antes): container "certificados" e prefixo "chamada/"
const legacyContainerName =
  process.env.CHAMADA_LEGACY_CONTAINER_NAME || "certificados";

function createBlobServiceClient() {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const account = process.env.AZURE_STORAGE_ACCOUNT;
  const key = process.env.AZURE_STORAGE_KEY;
  const sasUrl = process.env.AZURE_BLOB_SAS_URL;

  if (conn && typeof conn === "string" && conn.trim()) {
    return BlobServiceClient.fromConnectionString(conn);
  }

  if (account && key) {
    const credential = new StorageSharedKeyCredential(account, key);
    const serviceUrl = `https://${account}.blob.core.windows.net`;
    return new BlobServiceClient(serviceUrl, credential);
  }

  if (sasUrl && typeof sasUrl === "string" && sasUrl.trim()) {
    return new BlobServiceClient(sasUrl);
  }

  throw new Error(
    "Configuração do Azure Blob faltando. Defina AZURE_STORAGE_CONNECTION_STRING, " +
      "ou AZURE_STORAGE_ACCOUNT + AZURE_STORAGE_KEY, ou AZURE_BLOB_SAS_URL.",
  );
}

const blobServiceClient = createBlobServiceClient();
const containerClient = blobServiceClient.getContainerClient(containerName);

const legacyContainerClient =
  blobServiceClient.getContainerClient(legacyContainerName);

function normalizeMonthISO(v) {
  const s = String(v || "").trim();
  return /^\d{4}-\d{2}$/.test(s) ? s : "";
}

function legacyBlobNameForMonth(monthISO) {
  // No legado (container "certificados") salvava em chamada/YYYY-MM.json
  return `chamada/${monthISO}.json`;
}

function getBlobPath(monthISO, local, horario) {
  const l = String(local || "").trim().replace(/[^a-zA-Z0-9]/g, "_") || "Geral";
  const h = String(horario || "Unico").trim().replace(/[^a-zA-Z0-9]/g, "_");
  return `${l}/${monthISO}_${h}.json`;
}

async function downloadJsonIfExists(container, blobName) {
  try {
    const b = container.getBlobClient(blobName);
    const exists = await b.exists();
    if (!exists) return null;

    const buf = await b.downloadToBuffer();
    return JSON.parse(buf.toString("utf8"));
  } catch (err) {
    console.error(`Erro ao baixar blob ${blobName}:`, err.message);
    return null;
  }
}

/**
 * GET /chamada?month=YYYY-MM&local=...&horario=...
 * Retorna o JSON salvo do mês e local específico
 */
router.get("/", async (req, res) => {
  try {
    const monthISO = normalizeMonthISO(req.query.month);
    const { local, horario } = req.query;

    if (!monthISO) {
      return res.status(400).json({ erro: "Parâmetro 'month' inválido." });
    }

    const blobName = getBlobPath(monthISO, local, horario);
    let json = await downloadJsonIfExists(containerClient, blobName);

    // fallback: legado (na raiz do container 'chamada' ou no container antigo)
    if (!json) {
      // Tenta na raiz do container novo: YYYY-MM.json
      json = await downloadJsonIfExists(containerClient, `${monthISO}.json`);
      
      if (!json) {
        // Tenta no container legado: chamada/YYYY-MM.json
        const legacyName = legacyBlobNameForMonth(monthISO);
        json = await downloadJsonIfExists(legacyContainerClient, legacyName);
      }
    }

    if (!json) return res.status(404).json({ exists: false });

    // Normaliza para garantir que nunca retornaremos emails em entries.
    const normalized = normalizePayload(json, monthISO);
    return res.json({ exists: true, data: normalized });
  } catch (e) {
    console.error("GET /chamada erro:", e?.message || e);
    return res.status(500).json({ erro: "Erro ao buscar chamada." });
  }
});

/**
 * PUT /chamada?month=YYYY-MM&local=...&horario=...
 */
router.put("/", async (req, res) => {
  try {
    const monthISO = normalizeMonthISO(req.query.month);
    const { local, horario } = req.query;

    if (!monthISO) {
      return res.status(400).json({ erro: "Parâmetro 'month' inválido." });
    }

    const payload = req.body;
    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ erro: "Body JSON é obrigatório." });
    }

    await containerClient.createIfNotExists();

    const blobName = getBlobPath(monthISO, local, horario);
    const sanitized = {
      ...normalizePayload(payload, monthISO),
      local,
      horario,
      savedAt: new Date().toISOString(),
    };

    const json = JSON.stringify(sanitized, null, 0);

    await containerClient
      .getBlockBlobClient(blobName)
      .uploadData(Buffer.from(json, "utf8"), {
        blobHTTPHeaders: {
          blobContentType: "application/json",
          blobCacheControl: "no-cache, max-age=0",
        },
      });

    return res.json({ ok: true });
  } catch (e) {
    console.error("PUT /chamada erro:", e?.message || e);
    return res.status(500).json({ erro: "Erro ao salvar chamada." });
  }
});

/**
 * GET /chamada/months?year=YYYY
 * Lista os meses disponíveis para um ano (opcional).
 */
router.get("/months", async (req, res) => {
  try {
    const year = String(req.query.year || "").trim();
    const yearOk = year ? /^\d{4}$/.test(year) : false;

    const prefix = yearOk ? `${year}-` : "";
    const months = [];

    const existsContainer = await containerClient.exists();
    if (existsContainer) {
      for await (const blob of containerClient.listBlobsFlat({ prefix })) {
        const nameOnly = blob.name;
        const m = nameOnly.replace(/\.json$/i, "");
        if (/^\d{4}-\d{2}$/.test(m)) months.push(m);
      }
    }

    months.sort();
    return res.json({ months });
  } catch (e) {
    console.error("GET /chamada/months erro:", e?.message || e);
    return res.status(500).json({ erro: "Erro ao listar meses." });
  }
});

/**
 * GET /chamada/pessoas
 * Lista mínima para a tabela: [{ id, nome }]
 * (id é pseudônimo estável do email; email não é exposto)
 */
router.get("/pessoas", async (_req, res) => {
  try {
    const rows = await listarPessoasParaChamada({ limit: 5000 });
    const items = (Array.isArray(rows) ? rows : [])
      .map((r) => ({
        id: pessoaIdFromEmail(r.email),
        nome: (r.nome || "").trim(),
        localTreino: r.localTreino || "",
        horarioTreino: r.horarioTreino || "",
        daAula: !!r.daAula,
        nivelAcesso: r.nivelAcesso || "",
      }))
      .filter((r) => !!r.id)
      .sort((a, b) => (a.nome || a.id).localeCompare(b.nome || b.id));

    return res.json({ items });
  } catch (e) {
    console.error("GET /chamada/pessoas erro:", e?.message || e);
    return res.status(500).json({ erro: "Erro ao listar pessoas." });
  }
});

export default router;
