// api/routes/chamada.js
import express from "express";
import dotenv from "dotenv";
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
} from "@azure/storage-blob";

dotenv.config();

const router = express.Router();

/* ============================================================================
   CONFIGURAÇÃO DO AZURE BLOB (mesmo padrão do upload.js)
   ========================================================================== */
const containerName = "certificados";

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

const BASE_FOLDER = "chamada";

function normalizeMonthISO(v) {
  const s = String(v || "").trim();
  return /^\d{4}-\d{2}$/.test(s) ? s : "";
}

function blobNameForMonth(monthISO) {
  return `${BASE_FOLDER}/${monthISO}.json`;
}

async function downloadJsonIfExists(blobName) {
  const b = containerClient.getBlobClient(blobName);
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
    const json = await downloadJsonIfExists(blobName);
    if (!json) {
      return res.status(404).json({ exists: false });
    }

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

    const prefix = yearOk ? `${BASE_FOLDER}/${year}-` : `${BASE_FOLDER}/`;
    const months = [];

    for await (const blob of containerClient.listBlobsFlat({ prefix })) {
      const nameOnly = blob.name.slice(prefix.length);
      // quando prefix é chamada/ (sem ano), nameOnly começa com 2026-01.json
      const full = yearOk ? `${year}-${nameOnly}` : nameOnly;
      const m = full.replace(/\.json$/i, "");
      if (/^\d{4}-\d{2}$/.test(m)) months.push(m);
    }

    months.sort();
    return res.json({ months });
  } catch (e) {
    console.error("GET /chamada/months erro:", e?.message || e);
    return res.status(500).json({ erro: "Erro ao listar meses." });
  }
});

export default router;
