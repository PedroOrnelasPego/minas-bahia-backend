// api/routes/upload.js
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

/* ============================================================================ */
/* ÁREAS PÚBLICAS (download e upload por nível)                                 */
/* ============================================================================ */
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

/* ============================================================================ */
/* FOTO DE PERFIL                                                               */
/* ============================================================================ */
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

/* ============================================================================ */
/* LAUDOS MÉDICOS (PASTA /laudos)                                               */
/* ============================================================================ */

function safeOriginalName(name) {
  return String(name || "arquivo")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .trim();
}

/** POST /upload/laudos?email=...  (envia um laudo para /{email}/laudos/) */
router.post("/laudos", upload.single("arquivo"), async (req, res) => {
  const { email } = req.query;
  const arquivo = req.file;

  if (!email || !arquivo) {
    return res.status(400).json({ erro: "Email e arquivo são obrigatórios." });
  }

  try {
    await containerClient.createIfNotExists();

    const original = safeOriginalName(arquivo.originalname);
    const blobName = `${email}/laudos/${Date.now()}-${original}`;

    await containerClient
      .getBlockBlobClient(blobName)
      .uploadData(arquivo.buffer, {
        blobHTTPHeaders: { blobContentType: arquivo.mimetype },
      });

    const url = `${process.env.AZURE_BLOB_URL}/${blobName}`;
    return res.json({
      mensagem: "Laudo enviado com sucesso!",
      caminho: blobName,
      url,
      nome: blobName.split("/").pop(),
    });
  } catch (e) {
    console.error("Erro no upload de laudo:", e?.message || e);
    return res.status(500).json({ erro: "Erro ao enviar laudo." });
  }
});

/** GET /upload/laudos?email=...  (lista todos os laudos do usuário) */
router.get("/laudos", async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ erro: "Email é obrigatório." });

  try {
    const prefix = `${email}/laudos/`;
    const arquivos = [];

    for await (const blob of containerClient.listBlobsFlat({ prefix })) {
      const url = `${process.env.AZURE_BLOB_URL}/${blob.name}`;
      const nome = blob.name.replace(prefix, "");
      arquivos.push({
        nome,
        url,
        path: `laudos/${nome}`, // para facilitar exclusão no front
        contentType: blob.properties.contentType || "",
        tamanho: blob.properties.contentLength || 0,
        atualizadoEm: blob.properties.lastModified || null,
      });
    }

    // Ordena mais novos primeiro (pelo nome com timestamp no começo)
    arquivos.sort((a, b) => (b.nome || "").localeCompare(a.nome || ""));

    return res.json({ arquivos });
  } catch (e) {
    console.error("Erro ao listar laudos:", e?.message || e);
    return res.status(500).json({ erro: "Erro ao listar laudos." });
  }
});

/** DELETE /upload/laudos?email=...&arquivo=laudos/<nome>  (remove um laudo) */
router.delete("/laudos", async (req, res) => {
  const { email, arquivo } = req.query;
  if (!email || !arquivo) {
    return res
      .status(400)
      .json({ erro: "Parâmetros obrigatórios: email e arquivo." });
  }

  try {
    const blobPath = `${email}/${arquivo}`;
    const deleted = await containerClient
      .getBlockBlobClient(blobPath)
      .deleteIfExists();
    if (!deleted.succeeded) {
      return res.status(404).json({ erro: "Arquivo não encontrado." });
    }
    return res.json({ mensagem: "Laudo removido." });
  } catch (e) {
    console.error("DELETE /upload/laudos erro:", e?.message || e);
    if (e?.statusCode === 404 || e?.details?.errorCode === "BlobNotFound") {
      return res.status(404).json({ erro: "Arquivo não encontrado." });
    }
    return res.status(500).json({ erro: "Erro ao remover laudo." });
  }
});

/* ============================================================================ */
/* CERTIFICADOS (PASTA POR DATA + META JSON)                                    */
/* ============================================================================ */

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

/** POST /upload  (salva arquivo + meta pendente) */
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

/** GET /upload  (lista somente os arquivos, ignora metas) */
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

/** DELETE /upload?email=...&arquivo=certificados/YYYY-MM-DD/arquivo.ext */
router.delete("/", async (req, res) => {
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
      for await (const b of containerClient.listBlobsFlat({ prefix: pasta })) {
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
});

/** GET /upload/certificados/:email/:arquivo  (proxy direto) */
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

/** GET /upload/timeline  (lê metas e monta a timeline) */
router.get("/timeline", async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ erro: "Email é obrigatório." });

  try {
    const basePrefix = `${email}/certificados/`;
    const items = [];
    const datas = new Set();

    // coleta pastas data
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
            url: `${process.env.AZURE_BLOB_URL}/${blob.name}`,
          });
        }
      }

      // casa metas com arquivos
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

      // se não houver meta (legado)
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

/** PUT /upload/timeline  (atualiza status no meta da pasta) */
router.put("/timeline", async (req, res) => {
  try {
    const { email, arquivo, status } = req.body || {};
    // arquivo esperado: "certificados/YYYY-MM-DD/arquivo.ext"
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

    const pasta = blobPath.slice(0, lastSlash + 1); // inclui "/"
    const fileName = blobPath.slice(lastSlash + 1);

    // procura meta existente
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
      // lê meta e apenas troca status (sem perder campos adicionais)
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
      // cria novo meta
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

export default router;
