// api/routes/chamada.js
import express from "express";
import dotenv from "dotenv";
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
} from "@azure/storage-blob";
import { listarPessoasParaChamada } from "../services/cosmos.js";

dotenv.config();

const router = express.Router();

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

function blobNameForMonth(monthISO) {
  // No container "chamada" salvamos na raiz: YYYY-MM.json
  return `${monthISO}.json`;
}

function legacyBlobNameForMonth(monthISO) {
  // No legado (container "certificados") salvava em chamada/YYYY-MM.json
  return `chamada/${monthISO}.json`;
}

async function downloadJsonIfExists(container, blobName) {
  const existsContainer = await container.exists();
  if (!existsContainer) return null;

  const b = container.getBlobClient(blobName);
  const exists = await b.exists();
  if (!exists) return null;

  const buf = await b.downloadToBuffer();
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * GET /chamada?month=YYYY-MM
 * Retorna o JSON salvo do mês (ou 404 se não existir)
 */
router.get("/", async (req, res) => {
  try {
    const monthISO = normalizeMonthISO(req.query.month);
    if (!monthISO) {
      return res.status(400).json({ erro: "Parâmetro 'month' inválido." });
    }

    const blobName = blobNameForMonth(monthISO);
    let json = await downloadJsonIfExists(containerClient, blobName);

    // fallback: lê do legado, para não perder dados já salvos
    if (!json) {
      const legacyName = legacyBlobNameForMonth(monthISO);
      json = await downloadJsonIfExists(legacyContainerClient, legacyName);
    }

    if (!json) return res.status(404).json({ exists: false });

    return res.json({ exists: true, data: json });
  } catch (e) {
    console.error("GET /chamada erro:", e?.message || e);
    return res.status(500).json({ erro: "Erro ao buscar chamada." });
  }
});

/**
 * PUT /chamada?month=YYYY-MM
 * Body: payload JSON (ex.: { monthISO, preenchidoPor, entries, updatedAt, ... })
 * Salva/atualiza um único arquivo por mês.
 */
router.put("/", async (req, res) => {
  try {
    const monthISO = normalizeMonthISO(req.query.month);
    if (!monthISO) {
      return res.status(400).json({ erro: "Parâmetro 'month' inválido." });
    }

    const payload = req.body;
    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ erro: "Body JSON é obrigatório." });
    }

    await containerClient.createIfNotExists();

    const blobName = blobNameForMonth(monthISO);
    const json = JSON.stringify(
      {
        ...payload,
        monthISO,
        savedAt: new Date().toISOString(),
      },
      null,
      0,
    );

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
 * Lista mínima para a tabela: [{ email, nome }]
 */
router.get("/pessoas", async (_req, res) => {
  try {
    const items = await listarPessoasParaChamada({ limit: 5000 });
    return res.json({ items });
  } catch (e) {
    console.error("GET /chamada/pessoas erro:", e?.message || e);
    return res.status(500).json({ erro: "Erro ao listar pessoas." });
  }
});

export default router;
