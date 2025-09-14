// routes/eventos.js
import express from "express";
import multer from "multer";
import { BlobServiceClient } from "@azure/storage-blob";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/** CONFIG DO CONTAINER / CAMINHO BASE */
const blob = BlobServiceClient.fromConnectionString(
  process.env.AZURE_STORAGE_CONNECTION_STRING
);
// use um container separado para eventos (recomendado)
const CONTAINER = "eventos";
const container = blob.getContainerClient(CONTAINER);

// cria se não existir
await container.createIfNotExists();

/** helpers */
const groupPrefix = (group) => `grupos/${group}/`;
const albumPrefix = (group, album) => `grupos/${group}/albuns/${album}/`;
const publicUrl = (name) =>
  `${process.env.AZURE_BLOB_EVENTS_URL}/${name}`;

/** ================== GRUPOS ================== */
// GET /eventos/groups
router.get("/groups", async (_req, res) => {
  try {
    const groups = new Map(); // slug -> { slug, title }
    const prefix = "grupos/";
    for await (const b of container.listBlobsFlat({ prefix })) {
      // esperamos pastas: grupos/<slug>/marker.txt
      const parts = b.name.split("/");
      if (parts.length >= 2 && parts[0] === "grupos") {
        const slug = parts[1];
        if (!groups.has(slug)) groups.set(slug, { slug, title: slug });
      }
    }
    res.json({ groups: [...groups.values()] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar grupos" });
  }
});

// POST /eventos/groups  body: {slug,title}
router.post("/groups", async (req, res) => {
  try {
    const { slug, title } = req.body || {};
    if (!slug || !title) {
      return res.status(400).json({ erro: "slug e title são obrigatórios" });
    }
    // cria um "marcador" para forçar a pasta do grupo a existir
    const marker = container.getBlockBlobClient(`${groupPrefix(slug)}_group.txt`);
    await marker.uploadData(Buffer.from(title), {
      blobHTTPHeaders: { blobContentType: "text/plain" },
    });
    res.status(201).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao criar grupo" });
  }
});

// DELETE /eventos/groups/:groupSlug
router.delete("/groups/:group", async (req, res) => {
  try {
    const { group } = req.params;
    const prefix = groupPrefix(group);
    for await (const b of container.listBlobsFlat({ prefix })) {
      await container.getBlockBlobClient(b.name).deleteIfExists();
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao excluir grupo" });
  }
});

/** ================== ÁLBUNS ================== */
// GET /eventos/:group/albums
router.get("/:group/albums", async (req, res) => {
  try {
    const { group } = req.params;
    const albums = new Map();
    const prefix = `${groupPrefix(group)}albuns/`;
    for await (const b of container.listBlobsFlat({ prefix })) {
      // esperamos pastas: grupos/<g>/albuns/<album>/...
      const parts = b.name.split("/");
      if (parts.length >= 4) {
        const slug = parts[3];
        if (!albums.has(slug)) albums.set(slug, { slug, title: slug });
      }
    }
    res.json({ albums: [...albums.values()] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar álbuns" });
  }
});

// POST /eventos/:group/albums  body: {slug,title}
router.post("/:group/albums", async (req, res) => {
  try {
    const { group } = req.params;
    const { slug, title } = req.body || {};
    if (!slug || !title) {
      return res.status(400).json({ erro: "slug e title são obrigatórios" });
    }
    const marker = container.getBlockBlobClient(
      `${albumPrefix(group, slug)}_album.txt`
    );
    await marker.uploadData(Buffer.from(title), {
      blobHTTPHeaders: { blobContentType: "text/plain" },
    });
    res.status(201).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao criar álbum" });
  }
});

// DELETE /eventos/:group/albums/:album
router.delete("/:group/albums/:album", async (req, res) => {
  try {
    const { group, album } = req.params;
    const prefix = albumPrefix(group, album);
    for await (const b of container.listBlobsFlat({ prefix })) {
      await container.getBlockBlobClient(b.name).deleteIfExists();
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao excluir álbum" });
  }
});

/** ================== FOTOS ================== */
// GET /eventos/:group/:album/photos
router.get("/:group/:album/photos", async (req, res) => {
  try {
    const { group, album } = req.params;
    const prefix = albumPrefix(group, album);
    const photos = [];
    for await (const b of container.listBlobsFlat({ prefix })) {
      if (b.name.endsWith(".jpg") || b.name.endsWith(".jpeg") || b.name.endsWith(".png")) {
        photos.push({
          name: b.name.replace(prefix, ""),
          url: publicUrl(b.name),
          size: b.properties?.contentLength,
          contentType: b.properties?.contentType,
        });
      }
    }
    res.json({ photos });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar fotos" });
  }
});

// POST /eventos/:group/:album/photos   form-data: fotos[]
router.post("/:group/:album/photos", upload.array("fotos"), async (req, res) => {
  try {
    const { group, album } = req.params;
    if (!req.files?.length) return res.status(400).json({ erro: "Nenhuma foto enviada." });

    const added = [];
    for (const f of req.files) {
      const blobName = `${albumPrefix(group, album)}${Date.now()}-${f.originalname}`;
      await container.getBlockBlobClient(blobName).uploadData(f.buffer, {
        blobHTTPHeaders: { blobContentType: f.mimetype },
      });
      added.push({ name: blobName.split("/").pop(), url: publicUrl(blobName) });
    }
    res.status(201).json({ added });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao enviar fotos" });
  }
});

// DELETE /eventos/:group/:album/photos?name=arquivo.jpg
router.delete("/:group/:album/photos", async (req, res) => {
  try {
    const { group, album } = req.params;
    const { name } = req.query;
    if (!name) return res.status(400).json({ erro: "name é obrigatório" });

    const blobName = `${albumPrefix(group, album)}${name}`;
    await container.getBlockBlobClient(blobName).deleteIfExists();
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao deletar foto" });
  }
});

export default router;
