// routes/eventos.js
import express from "express";
import multer from "multer";
import { BlobServiceClient } from "@azure/storage-blob";
import sharp from "sharp";
import path from "node:path";
import dotenv from "dotenv";
import { buscarPerfil } from "../services/cosmos.js";

dotenv.config();

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const blobServiceClient = BlobServiceClient.fromConnectionString(
  process.env.AZURE_STORAGE_CONNECTION_STRING
);

// container onde ficarão as fotos
const EVENTS_CONTAINER = "eventos";
const containerClient = blobServiceClient.getContainerClient(EVENTS_CONTAINER);

// util
const NIVEIS = ["visitante","aluno","graduado","monitor","instrutor","professor","contramestre"];
const rankNivel = (n) => {
  const i = NIVEIS.indexOf((n || "").toLowerCase());
  return i < 0 ? -1 : i;
};
const AZ_BLOB_URL = process.env.AZURE_BLOB_EVENTS_URL; // https://.../eventos

// middleware simples: precisa de e-mail e permissão de editor (nível ≥ graduado)
async function requireEditor(req, res, next) {
  try {
    const email = req.header("x-user-email");
    if (!email) return res.status(401).json({ erro: "Não autenticado." });

    const perfil = await buscarPerfil(email);
    if (!perfil) return res.status(403).json({ erro: "Perfil não encontrado." });

    const nivelOk = rankNivel(perfil.nivelAcesso) >= rankNivel("graduado");
    const permOk = (perfil.permissaoEventos || "leitor") === "editor";

    if (!nivelOk || !permOk) {
      return res.status(403).json({ erro: "Sem permissão para editar eventos." });
    }

    req.user = { email, perfil };
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Falha na verificação de permissão." });
  }
}

// ---------- LISTAR FOTOS ----------
router.get("/fotos", async (req, res) => {
  const { group, album } = req.query;
  if (!group || !album) {
    return res.status(400).json({ erro: "Parâmetros 'group' e 'album' são obrigatórios." });
  }

  const prefix = `eventos/${group}/${album}/`;

  try {
    const fotos = [];
    for await (const blob of containerClient.listBlobsFlat({ prefix })) {
      // pula thumbs neste endpoint (retornamos ambas por conveniência abaixo)
      if (blob.name.endsWith(".thumb.jpg")) continue;

      const name = path.basename(blob.name);                 // id.jpg
      const url = `${AZ_BLOB_URL}/${blob.name}`;             // original
      const thumbUrl = `${AZ_BLOB_URL}/${blob.name}.thumb.jpg`; // thumb com sufixo

      fotos.push({ name, url, thumbUrl });
    }
    res.json({ fotos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao listar fotos." });
  }
});

// ---------- UPLOAD (até 5 por vez) ----------
router.post(
  "/fotos",
  requireEditor,
  upload.array("fotos", 5),
  async (req, res) => {
    const { group, album } = req.body; // pode vir por query também
    if (!group || !album) {
      return res.status(400).json({ erro: "Parâmetros 'group' e 'album' são obrigatórios." });
    }
    if (!req.files?.length) return res.status(400).json({ erro: "Anexe pelo menos 1 foto." });

    try {
      // garante que o container existe
      await containerClient.createIfNotExists();

      const results = [];

      for (const file of req.files) {
        // id seguro e curto
        const id =
          Date.now() + "-" + Math.random().toString(36).slice(2, 8);

        // sempre geramos JPEG otimizado pra baratear tráfego
        const fullBuf = await sharp(file.buffer)
          .rotate()
          .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();

        const thumbBuf = await sharp(file.buffer)
          .rotate()
          .resize({ width: 360, height: 360, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 70 })
          .toBuffer();

        const basePath = `eventos/${group}/${album}/${id}.jpg`;
        const fullBlob = containerClient.getBlockBlobClient(basePath);
        const thumbBlob = containerClient.getBlockBlobClient(`${basePath}.thumb.jpg`);

        await fullBlob.uploadData(fullBuf, {
          blobHTTPHeaders: { blobContentType: "image/jpeg" },
        });
        await thumbBlob.uploadData(thumbBuf, {
          blobHTTPHeaders: { blobContentType: "image/jpeg" },
        });

        results.push({
          name: `${id}.jpg`,
          url: `${AZ_BLOB_URL}/${basePath}`,
          thumbUrl: `${AZ_BLOB_URL}/${basePath}.thumb.jpg`,
        });
      }

      res.status(201).json({ uploaded: results });
    } catch (err) {
      console.error(err);
      res.status(500).json({ erro: "Erro ao enviar fotos." });
    }
  }
);

// ---------- DELETE ----------
router.delete("/fotos", requireEditor, async (req, res) => {
  const { group, album, name } = req.query;
  if (!group || !album || !name) {
    return res.status(400).json({ erro: "Parâmetros 'group', 'album' e 'name' são obrigatórios." });
  }

  const basePath = `eventos/${group}/${album}/${name}`;

  try {
    await containerClient.getBlockBlobClient(basePath).deleteIfExists();
    await containerClient.getBlockBlobClient(`${basePath}.thumb.jpg`).deleteIfExists();
    res.json({ mensagem: "Foto removida." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao remover foto." });
  }
});

export default router;
