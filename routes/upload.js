// api/routes/upload.js
import express from "express";
import multer from "multer";
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
} from "@azure/storage-blob";
import dotenv from "dotenv";
import { v4 as uuid } from "uuid";
import {
  requireAuth,
  requireSelfOrAdmin,
  requireAdmin,
} from "../middlewares/auth.js";

dotenv.config();

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/* ============================================================================
   CONFIGURAÇÃO DO AZURE BLOB (robusta, com fallbacks)
   ========================================================================== */
const containerName = "certificados";

/** Cria um BlobServiceClient a partir das variáveis disponíveis */
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
    // Ex.: https://<account>.blob.core.windows.net/?sv=...
    return new BlobServiceClient(sasUrl);
  }

  throw new Error(
    "Configuração do Azure Blob faltando. Defina AZURE_STORAGE_CONNECTION_STRING, " +
      "ou AZURE_STORAGE_ACCOUNT + AZURE_STORAGE_KEY, ou AZURE_BLOB_SAS_URL."
  );
}

const blobServiceClient = createBlobServiceClient();
const containerClient = blobServiceClient.getContainerClient(containerName);

/** Base pública para montar links (fallback automático) */
const PUBLIC_BASE =
  process.env.AZURE_BLOB_URL ||
  (process.env.AZURE_STORAGE_ACCOUNT
    ? `https://${process.env.AZURE_STORAGE_ACCOUNT}.blob.core.windows.net`
    : "");

/* ============================================================================
   PASTAS FIXAS PÚBLICAS
   ========================================================================== */
const BASE_FOLDER = "documentos";
const PASTAS = [
  "aluno",
  "graduado",
  "monitor",
  "instrutor",
  "professor",
  "contramestre",
];

/* ============================================================================
   Helpers
   ========================================================================== */
function toIsoDateFolder(input) {
  try {
    if (!input) return new Date().toISOString().slice(0, 10);
    const d = new Date(input);
    if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function safeOriginalName(name) {
  return String(name || "arquivo")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .trim();
}

function publicUrlFor(blobName) {
  // Se PUBLIC_BASE estiver vazio, ainda devolvemos um path relativo
  // (mas o ideal é setar AZURE_BLOB_URL ou usar account para ter o host completo)
  return PUBLIC_BASE
    ? `${PUBLIC_BASE}/${blobName}`
    : `/${containerName}/${blobName}`;
}

/* ============================================================================ */
/* ÁREAS PÚBLICAS (download e upload por nível)                                 */
/* ============================================================================ */
router.post("/public", upload.single("arquivo"), async (req, res) => {
  const { pasta } = req.query;
  if (!PASTAS.includes(pasta))
    return res.status(400).json({ erro: "Pasta inválida." });

  const blobName = `${BASE_FOLDER}/${pasta}/${Date.now()}-${safeOriginalName(
    req.file?.originalname
  )}`;

  try {
    await containerClient.createIfNotExists();
    await containerClient
      .getBlockBlobClient(blobName)
      .uploadData(req.file.buffer, {
        blobHTTPHeaders: { blobContentType: req.file.mimetype },
      });
    res.status(201).json({ mensagem: "Arquivo enviado." });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao enviar arquivo." });
  }
});

router.get("/public", async (req, res) => {
  const { pasta } = req.query;
  if (!PASTAS.includes(pasta))
    return res.status(400).json({ erro: "Pasta inválida." });

  try {
    const prefix = `${BASE_FOLDER}/${pasta}/`;
    const arquivos = [];

    for await (const blob of containerClient.listBlobsFlat({ prefix })) {
      const url = publicUrlFor(blob.name);
      arquivos.push({ nome: blob.name.replace(prefix, ""), url });
    }

    res.json({ arquivos });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar arquivos." });
  }
});

router.delete("/public", async (req, res) => {
  const { pasta, arquivo } = req.query;
  if (!PASTAS.includes(pasta) || !arquivo)
    return res.status(400).json({ erro: "Parâmetros inválidos." });

  try {
    await containerClient
      .getBlockBlobClient(`${BASE_FOLDER}/${pasta}/${arquivo}`)
      .delete();

    res.json({ mensagem: "Arquivo removido." });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao remover arquivo." });
  }
});

/* ============================================================================ */
/* FOTO DE PERFIL                                                               */
/* ============================================================================ */
router.post(
  "/foto-perfil",
  requireAuth,
  requireSelfOrAdmin("email"),
  upload.single("arquivo"),
  async (req, res) => {
    const { email, name } = req.query;
    const arquivo = req.file;

    if (!email || !arquivo)
      return res
        .status(400)
        .json({ erro: "Email e arquivo são obrigatórios." });

    try {
      await containerClient.createIfNotExists();

      const safeName = (name || "foto-perfil.jpg").replace(
        /[^a-zA-Z0-9@._-]/g,
        ""
      );
      const blobName = `${email}/${safeName}`;
      await containerClient
        .getBlockBlobClient(blobName)
        .uploadData(arquivo.buffer, {
          blobHTTPHeaders: {
            blobContentType: arquivo.mimetype,
            blobCacheControl: "public, max-age=31536000, immutable",
          },
        });

      const url = publicUrlFor(blobName);
      res.json({ mensagem: "Foto enviada com sucesso!", url });
    } catch (e) {
      console.error("Erro no upload de foto:", e.message);
      res.status(500).json({ erro: "Erro ao enviar a foto." });
    }
  }
);

router.delete(
  "/foto-perfil",
  requireAuth,
  requireSelfOrAdmin("email"),
  async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({ erro: "Email é obrigatório." });

    try {
      await Promise.all(
        [
          `${email}/foto-perfil@1x.jpg`,
          `${email}/foto-perfil@2x.jpg`,
          `${email}/foto-perfil.jpg`,
        ].map((p) => containerClient.getBlockBlobClient(p).deleteIfExists())
      );
      res.json({ mensagem: "Foto(s) deletada(s) com sucesso!" });
    } catch (e) {
      console.error(e);
      res.status(500).json({ erro: "Erro ao deletar a foto." });
    }
  }
);

/* ============================================================================ */
/* CERTIFICADOS (PASTA POR DATA + META JSON)                                    */
/* ============================================================================ */
router.post(
  "/",
  requireAuth,
  requireSelfOrAdmin("email"),
  upload.single("arquivo"),
  async (req, res) => {
    const { email } = req.query;
    const { data: dataInformada, corda } = req.body || {};
    const arquivo = req.file;

    if (!email || !arquivo)
      return res
        .status(400)
        .json({ erro: "Email e arquivo são obrigatórios." });

    try {
      await containerClient.createIfNotExists();

      const pastaData = toIsoDateFolder(dataInformada);
      const original = safeOriginalName(arquivo.originalname);

      const blobName = `${email}/certificados/${pastaData}/${original}`;

      await containerClient
        .getBlockBlobClient(blobName)
        .uploadData(arquivo.buffer, {
          blobHTTPHeaders: { blobContentType: arquivo.mimetype },
        });

      // meta JSON
      try {
        const metaName = `${email}/certificados/${pastaData}/.meta-${Date.now()}.json`;
        const meta = {
          uploadedAt: new Date().toISOString(),
          dataInformada: pastaData,
          corda: corda || null,
          originalName: original,
          contentType: arquivo.mimetype,
          size: arquivo.size,
          status: "pending",
        };

        await containerClient
          .getBlockBlobClient(metaName)
          .uploadData(Buffer.from(JSON.stringify(meta)), {
            blobHTTPHeaders: { blobContentType: "application/json" },
          });
      } catch (e) {
        console.warn("Falha ao gravar meta:", e?.message || e);
      }

      const url = publicUrlFor(blobName);
      res.json({
        mensagem: "Arquivo enviado com sucesso!",
        caminho: blobName,
        url,
        data: pastaData,
      });
    } catch (e) {
      console.error("Erro no upload:", e.message);
      res.status(500).json({ erro: "Erro ao enviar arquivo." });
    }
  }
);

router.get("/", requireAuth, requireSelfOrAdmin("email"), async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ erro: "Email é obrigatório." });

  try {
    const prefix = `${email}/certificados/`;
    const arquivos = [];

    for await (const blob of containerClient.listBlobsFlat({ prefix })) {
      const nomeArquivo = blob.name.split("/").pop();
      if (nomeArquivo.startsWith(".meta-")) continue;

      const url = publicUrlFor(blob.name);
      arquivos.push({ nome: blob.name.replace(prefix, ""), url });
    }

    res.json({ arquivos });
  } catch (e) {
    console.error("Erro ao listar certificados:", e.message);
    res.status(500).json({ erro: "Erro ao listar arquivos." });
  }
});

router.delete(
  "/",
  requireAuth,
  requireSelfOrAdmin("email"),
  async (req, res) => {
    const { email, arquivo } = req.query;
    if (!email || !arquivo) {
      return res
        .status(400)
        .json({ erro: "Parâmetros obrigatórios: email e arquivo." });
    }

    const blobPath = `${email}/${arquivo}`;

    try {
      // 1) apaga o arquivo principal
      const blobClient = containerClient.getBlockBlobClient(blobPath);
      const deleted = await blobClient.deleteIfExists();
      if (!deleted.succeeded) {
        return res.status(404).json({ erro: "Arquivo não encontrado." });
      }

      // 2) remove meta-jsons da pasta (se existirem)
      const lastSlash = blobPath.lastIndexOf("/");
      if (lastSlash !== -1) {
        const pasta = blobPath.slice(0, lastSlash + 1);
        for await (const b of containerClient.listBlobsFlat({
          prefix: pasta,
        })) {
          const nameOnly = b.name.slice(pasta.length);
          if (nameOnly.startsWith(".meta-") && nameOnly.endsWith(".json")) {
            await containerClient.getBlockBlobClient(b.name).deleteIfExists();
          }
        }
      }

      return res.json({ mensagem: "Arquivo removido." });
    } catch (e) {
      console.error("DELETE /upload erro:", e?.message || e);
      if (e?.statusCode === 404 || e?.details?.errorCode === "BlobNotFound") {
        return res.status(404).json({ erro: "Arquivo não encontrado." });
      }
      return res.status(500).json({ erro: "Erro ao remover arquivo." });
    }
  }
);

/* Proxy direto para certificados (legado/visualização) */
router.get(
  "/certificados/:email/:arquivo",
  requireAuth,
  requireSelfOrAdmin("email"),
  async (req, res) => {
    const { email, arquivo } = req.params;

    try {
      const blobPath = `${email}/certificados/${arquivo}`;
      const blobClient = containerClient.getBlobClient(blobPath);

      if (!(await blobClient.exists()))
        return res.status(404).send("Arquivo não encontrado.");

      const download = await blobClient.download();
      res.set(
        "Content-Type",
        download.contentType || "application/octet-stream"
      );
      download.readableStreamBody.pipe(res);
    } catch (e) {
      console.error("Erro ao buscar arquivo:", e.message);
      res.status(500).send("Erro ao buscar o arquivo.");
    }
  }
);

/* Monta timeline lendo metas */
router.get("/timeline", async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ erro: "Email é obrigatório." });

  try {
    const basePrefix = `${email}/certificados/`;
    const items = [];
    const datas = new Set();

    for await (const blob of containerClient.listBlobsFlat({
      prefix: basePrefix,
    })) {
      const rel = blob.name.replace(basePrefix, "");
      const parts = rel.split("/");
      if (parts.length >= 2) datas.add(parts[0]);
    }

    for (const pastaData of [...datas].sort().reverse()) {
      const prefix = `${basePrefix}${pastaData}/`;
      const arquivosDaPasta = [];
      const metas = [];

      for await (const blob of containerClient.listBlobsFlat({ prefix })) {
        const nameOnly = blob.name.replace(prefix, "");
        if (nameOnly.startsWith(".meta-") && nameOnly.endsWith(".json")) {
          const dl = await containerClient
            .getBlobClient(blob.name)
            .downloadToBuffer();
          try {
            metas.push(JSON.parse(dl.toString("utf8")));
          } catch {
            /* ignora meta inválido */
          }
        } else {
          arquivosDaPasta.push({
            nameOnly,
            fullName: blob.name,
            url: publicUrlFor(blob.name),
          });
        }
      }

      for (const meta of metas) {
        const match =
          arquivosDaPasta.find(
            (a) => a.nameOnly === (meta.originalName || "")
          ) || arquivosDaPasta[0];
        if (!match) continue;

        const relativePath = match.fullName.replace(basePrefix, "");
        items.push({
          id: uuid(),
          corda: meta.corda || "",
          data: meta.dataInformada || pastaData,
          url: match.url,
          fileName: match.nameOnly,
          status: meta.status || "pending",
          path: relativePath,
        });
      }

      if (metas.length === 0) {
        for (const a of arquivosDaPasta) {
          const relativePath = a.fullName.replace(basePrefix, "");
          items.push({
            id: uuid(),
            corda: "",
            data: pastaData,
            url: a.url,
            fileName: a.nameOnly,
            status: "pending",
            path: relativePath,
          });
        }
      }
    }

    res.json({ items });
  } catch (e) {
    console.error("Erro em GET /upload/timeline:", e.message);
    res.status(500).json({ erro: "Erro ao montar timeline." });
  }
});

router.put("/timeline", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email, arquivo, status } = req.body || {};
    if (
      !email ||
      !arquivo ||
      !["approved", "rejected", "pending"].includes(status)
    ) {
      return res.status(400).json({ erro: "Parâmetros inválidos." });
    }

    const blobPath = `${email}/${arquivo}`;
    const lastSlash = blobPath.lastIndexOf("/");
    if (lastSlash < 0)
      return res.status(400).json({ erro: "Arquivo inválido." });

    const pasta = blobPath.slice(0, lastSlash + 1);
    const fileName = blobPath.slice(lastSlash + 1);

    let metaBlobName = null;
    for await (const b of containerClient.listBlobsFlat({ prefix: pasta })) {
      const nameOnly = b.name.slice(pasta.length);
      if (nameOnly.startsWith(".meta-") && nameOnly.endsWith(".json")) {
        metaBlobName = b.name;
        break;
      }
    }

    const meta = {
      uploadedAt: new Date().toISOString(),
      dataInformada: pasta.split("/").slice(-2, -1)[0] || "",
      corda: null,
      originalName: fileName,
      contentType: "",
      size: 0,
      status,
    };

    if (metaBlobName) {
      const buf = await containerClient
        .getBlobClient(metaBlobName)
        .downloadToBuffer();
      try {
        const old = JSON.parse(buf.toString("utf8"));
        old.status = status;
        await containerClient
          .getBlockBlobClient(metaBlobName)
          .uploadData(Buffer.from(JSON.stringify(old)), {
            blobHTTPHeaders: { blobContentType: "application/json" },
          });
      } catch {
        await containerClient
          .getBlockBlobClient(metaBlobName)
          .uploadData(Buffer.from(JSON.stringify(meta)), {
            blobHTTPHeaders: { blobContentType: "application/json" },
          });
      }
    } else {
      const newMetaName = `${pasta}.meta-${Date.now()}.json`;
      await containerClient
        .getBlockBlobClient(newMetaName)
        .uploadData(Buffer.from(JSON.stringify(meta)), {
          blobHTTPHeaders: { blobContentType: "application/json" },
        });
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("PUT /upload/timeline erro:", e?.message || e);
    res.status(500).json({ erro: "Erro ao atualizar status." });
  }
});

/* ============================================================================ */
/* LAUDOS (upload/list/delete em /<email>/laudos/)                               */
/* ============================================================================ */
router.post(
  "/laudos",
  requireAuth,
  requireSelfOrAdmin("email"),
  upload.single("arquivo"),
  async (req, res) => {
    const { email } = req.query;
    const arquivo = req.file;
    if (!email || !arquivo) {
      return res
        .status(400)
        .json({ erro: "Email e arquivo são obrigatórios." });
    }

    try {
      await containerClient.createIfNotExists();
      const blobName = `${email}/laudos/${Date.now()}-${safeOriginalName(
        arquivo.originalname
      )}`;
      await containerClient
        .getBlockBlobClient(blobName)
        .uploadData(arquivo.buffer, {
          blobHTTPHeaders: { blobContentType: arquivo.mimetype },
        });

      const url = publicUrlFor(blobName);
      return res.json({ mensagem: "Laudo enviado com sucesso!", url });
    } catch (e) {
      console.error("POST /upload/laudos erro:", e?.message || e);
      return res.status(500).json({ erro: "Erro ao enviar laudo." });
    }
  }
);

router.get(
  "/laudos",
  requireAuth,
  requireSelfOrAdmin("email"),
  async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({ erro: "Email é obrigatório." });

    try {
      const prefix = `${email}/laudos/`;
      const arquivos = [];
      for await (const blob of containerClient.listBlobsFlat({ prefix })) {
        arquivos.push({
          nome: blob.name.replace(prefix, ""),
          url: publicUrlFor(blob.name),
          atualizadoEm: blob.properties?.lastModified || null,
        });
      }
      return res.json({ arquivos });
    } catch (e) {
      console.error("GET /upload/laudos erro:", e?.message || e);
      return res.status(500).json({ erro: "Erro ao listar laudos." });
    }
  }
);

router.delete(
  "/laudos",
  requireAuth,
  requireSelfOrAdmin("email"),
  async (req, res) => {
    const { email, arquivo } = req.query;
    if (!email || !arquivo) {
      return res
        .status(400)
        .json({ erro: "Parâmetros obrigatórios: email e arquivo." });
    }

    try {
      // Aceita tanto "xxx.ext" quanto "laudos/xxx.ext"
      const blobPath = arquivo.startsWith("laudos/")
        ? `${email}/${arquivo}`
        : `${email}/laudos/${arquivo}`;

      const deleted = await containerClient
        .getBlockBlobClient(blobPath)
        .deleteIfExists();
      if (!deleted.succeeded) {
        return res.status(404).json({ erro: "Laudo não encontrado." });
      }
      return res.json({ mensagem: "Laudo removido." });
    } catch (e) {
      console.error("DELETE /upload/laudos erro:", e?.message || e);
      return res.status(500).json({ erro: "Erro ao remover laudo." });
    }
  }
);

export default router;
