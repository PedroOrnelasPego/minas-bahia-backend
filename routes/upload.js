import express from "express";
import multer from "multer";
import { BlobServiceClient } from "@azure/storage-blob";
import dotenv from "dotenv";
import { v4 as uuid } from "uuid";

dotenv.config();

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Container principal
const containerName = "certificados";
const blobServiceClient = BlobServiceClient.fromConnectionString(
  process.env.AZURE_STORAGE_CONNECTION_STRING
);
const containerClient = blobServiceClient.getContainerClient(containerName);

// Pastas fixas públicas
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
   ÁREAS PÚBLICAS (download e upload por nível)
============================================================================ */
router.post("/public", upload.single("arquivo"), async (req, res) => {
  const { pasta } = req.query;
  if (!PASTAS.includes(pasta))
    return res.status(400).json({ erro: "Pasta inválida." });

  const blobName = `${BASE_FOLDER}/${pasta}/${Date.now()}-${
    req.file.originalname
  }`;

  try {
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
      const url = containerClient.getBlockBlobClient(blob.name).url;
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

/* ============================================================================
   FOTO DE PERFIL
============================================================================ */
router.post("/foto-perfil", upload.single("arquivo"), async (req, res) => {
  const { email, name } = req.query;
  const arquivo = req.file;

  if (!email || !arquivo)
    return res.status(400).json({ erro: "Email e arquivo são obrigatórios." });

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

    const url = `${process.env.AZURE_BLOB_URL}/${blobName}`;
    res.json({ mensagem: "Foto enviada com sucesso!", url });
  } catch (e) {
    console.error("Erro no upload de foto:", e.message);
    res.status(500).json({ erro: "Erro ao enviar a foto." });
  }
});

router.delete("/foto-perfil", async (req, res) => {
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
});

/* ============================================================================
   CERTIFICADOS (PASTA POR DATA + META JSON)
============================================================================ */

// Helpers
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

/**
 * POST /upload
 * Cria estrutura:
 *   certificados/<email>/certificados/<YYYY-MM-DD>/<arquivo>
 *   certificados/<email>/certificados/<YYYY-MM-DD>/.meta-xxxx.json
 */
router.post("/", upload.single("arquivo"), async (req, res) => {
  const { email } = req.query;
  const { data: dataInformada, corda } = req.body || {};
  const arquivo = req.file;

  if (!email || !arquivo)
    return res.status(400).json({ erro: "Email e arquivo são obrigatórios." });

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

    const url = `${process.env.AZURE_BLOB_URL}/${blobName}`;
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
});

/**
 * GET /upload
 * Lista apenas arquivos (ignora .meta-*.json)
 */
router.get("/", async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ erro: "Email é obrigatório." });

  try {
    const prefix = `${email}/certificados/`;
    const arquivos = [];

    for await (const blob of containerClient.listBlobsFlat({ prefix })) {
      const nomeArquivo = blob.name.split("/").pop();
      if (nomeArquivo.startsWith(".meta-")) continue;

      const url = `${process.env.AZURE_BLOB_URL}/${blob.name}`;
      arquivos.push({ nome: blob.name.replace(prefix, ""), url });
    }

    res.json({ arquivos });
  } catch (e) {
    console.error("Erro ao listar certificados:", e.message);
    res.status(500).json({ erro: "Erro ao listar arquivos." });
  }
});

/**
 * GET /upload/certificados/:email/:arquivo
 * Baixa o arquivo diretamente (proxy)
 */
router.get("/certificados/:email/:arquivo", async (req, res) => {
  const { email, arquivo } = req.params;

  try {
    const blobPath = `${email}/certificados/${arquivo}`;
    const blobClient = containerClient.getBlobClient(blobPath);

    if (!(await blobClient.exists()))
      return res.status(404).send("Arquivo não encontrado.");

    const download = await blobClient.download();
    res.set("Content-Type", download.contentType || "application/octet-stream");
    download.readableStreamBody.pipe(res);
  } catch (e) {
    console.error("Erro ao buscar arquivo:", e.message);
    res.status(500).send("Erro ao buscar o arquivo.");
  }
});

/**
 * GET /upload/timeline
 * Retorna a timeline consolidada (lendo .meta-*.json)
 */
router.get("/timeline", async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ erro: "Email é obrigatório." });

  try {
    const basePrefix = `${email}/certificados/`;
    const items = [];
    const datas = new Set();

    // coleta todas as pastas (YYYY-MM-DD)
    for await (const blob of containerClient.listBlobsFlat({
      prefix: basePrefix,
    })) {
      const rel = blob.name.replace(basePrefix, "");
      const parts = rel.split("/");
      if (parts.length >= 2) datas.add(parts[0]);
    }

    // para cada pasta, ler meta + arquivo real
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
            // ignora meta inválido
          }
        } else {
          arquivosDaPasta.push({
            nameOnly,
            fullName: blob.name,
            url: `${process.env.AZURE_BLOB_URL}/${blob.name}`,
          });
        }
      }

      // casa metadados e arquivos
      for (const meta of metas) {
        const match =
          arquivosDaPasta.find(
            (a) => a.nameOnly === (meta.originalName || "")
          ) || arquivosDaPasta[0];

        if (!match) continue;

        items.push({
          id: uuid(),
          corda: meta.corda || "",
          data: meta.dataInformada || pastaData,
          url: match.url,
          fileName: match.nameOnly,
          status: meta.status || "pending",
        });
      }

      // se não houver meta (legado)
      if (metas.length === 0) {
        for (const a of arquivosDaPasta) {
          items.push({
            id: uuid(),
            corda: "",
            data: pastaData,
            url: a.url,
            fileName: a.nameOnly,
            status: "pending",
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

export default router;
