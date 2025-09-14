// routes/eventos.js
import express from "express";
import multer from "multer";
import { BlobServiceClient } from "@azure/storage-blob";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/** =================== STORAGE / CONTAINER =================== */
const blob = BlobServiceClient.fromConnectionString(
  process.env.AZURE_STORAGE_CONNECTION_STRING
);

// container exclusivo para eventos
const CONTAINER = "eventos";
const container = blob.getContainerClient(CONTAINER);

// cria se não existir (Node ESM permite top-level await)
await container.createIfNotExists();

/** =================== HELPERS =================== */
const groupPrefix = (group) => `grupos/${group}/`;
const albumsRootPrefix = (group) => `grupos/${group}/albuns/`;
const albumPrefix = (group, album) => `grupos/${group}/albuns/${album}/`;
const publicUrl = (name) => `${process.env.AZURE_BLOB_EVENTS_URL}/${name}`;

// checagem simples de imagem
const isImageName = (name = "") =>
  /\.(png|jpg|jpeg|gif|webp|avif)$/i.test(name);

/** ===========================================================
 *                        GRUPOS
 *  ===========================================================
 */

// GET /eventos/groups
// Lista grupos com { slug, title, coverUrl }
// GET /eventos/groups
router.get("/groups", async (_req, res) => {
  try {
    const groups = [];
    const basePrefix = "grupos/";

    // lista "pastas" de grupos
    for await (const item of container.listBlobsByHierarchy("/", {
      prefix: basePrefix,
    })) {
      if (item.kind !== "prefix") continue;

      const slug = item.name.slice(basePrefix.length, -1); // remove "grupos/" e a barra final

      // título salvo no _group.txt (fallback = slug)
      const titleBlob = container.getBlobClient(
        `${basePrefix}${slug}/_group.txt`
      );
      let title = slug;
      if (await titleBlob.exists()) {
        const dl = await titleBlob.download();
        title = (await streamToString(dl.readableStreamBody)).trim();
      }

      // capa se existir
      const coverBlob = container.getBlockBlobClient(
        `${basePrefix}${slug}/_cover.jpg`
      );
      const coverUrl = (await coverBlob.exists()) ? coverBlob.url : "";

      // conta álbuns = quantos "prefixes" existem em grupos/<slug>/albuns/
      const albumsPrefix = `${basePrefix}${slug}/albuns/`;
      let albumCount = 0;
      for await (const alb of container.listBlobsByHierarchy("/", {
        prefix: albumsPrefix,
      })) {
        if (alb.kind === "prefix") albumCount++; // cada subpasta é um álbum
      }

      groups.push({ slug, title, coverUrl, albumCount });
    }

    res.json({ groups });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar grupos" });
  }
});

// helper para ler streams
async function streamToString(readable) {
  if (!readable) return "";
  const chunks = [];
  for await (const chunk of readable) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf-8");
}

// POST /eventos/groups  body: {slug,title}
router.post("/groups", async (req, res) => {
  try {
    const { slug, title } = req.body || {};
    if (!slug || !title) {
      return res.status(400).json({ erro: "slug e title são obrigatórios" });
    }

    // força a "pasta" existir e persiste o título
    const marker = container.getBlockBlobClient(
      `${groupPrefix(slug)}_group.txt`
    );
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

// POST /eventos/groups/:groupSlug/cover  (enviar capa do GRUPO)
router.post(
  "/groups/:groupSlug/cover",
  upload.single("cover"),
  async (req, res) => {
    try {
      const { groupSlug } = req.params;
      const file = req.file;
      if (!file)
        return res.status(400).json({ erro: "Arquivo 'cover' é obrigatório." });

      const blobName = `${groupPrefix(groupSlug)}_cover.jpg`;
      const block = container.getBlockBlobClient(blobName);
      await block.uploadData(file.buffer, {
        blobHTTPHeaders: { blobContentType: file.mimetype },
      });

      res.json({ url: block.url });
    } catch (e) {
      console.error(e);
      res.status(500).json({ erro: "Erro ao enviar capa do grupo." });
    }
  }
);

/** ===========================================================
 *                        ÁLBUNS
 *  ===========================================================
 */

// GET /eventos/:group/albums
// Retorna [{ slug, title, coverUrl, totalPhotos }]
// GET /eventos/:group/albums
router.get("/:group/albums", async (req, res) => {
  try {
    const { group } = req.params;
    const albums = [];
    const albumPrefix = `grupos/${group}/albuns/`;

    for await (const item of container.listBlobsByHierarchy("/", {
      prefix: albumPrefix,
    })) {
      if (item.kind !== "prefix") continue;

      const albumSlug = item.name.slice(albumPrefix.length, -1);

      // título salvo no _album.txt (fallback = slug)
      const titleBlob = container.getBlobClient(
        `${albumPrefix}${albumSlug}/_album.txt`
      );
      let title = albumSlug;
      if (await titleBlob.exists()) {
        const dl = await titleBlob.download();
        title = (await streamToString(dl.readableStreamBody)).trim();
      }

      // capa
      const coverBlob = container.getBlockBlobClient(
        `${albumPrefix}${albumSlug}/_cover.jpg`
      );
      const coverUrl = (await coverBlob.exists()) ? coverBlob.url : "";

      // conta fotos (ignora arquivos que começam com "_")
      const photoPrefix = `${albumPrefix}${albumSlug}/`;
      let count = 0;
      for await (const b of container.listBlobsFlat({ prefix: photoPrefix })) {
        const name = b.name.replace(photoPrefix, "");
        if (!name.startsWith("_")) count++;
      }

      albums.push({ slug: albumSlug, title, coverUrl, count });
    }

    res.json({ albums });
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

    // cria estrutura e salva título
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

// POST /eventos/:groupSlug/albums/:albumSlug/cover  (enviar capa do ÁLBUM)
router.post(
  "/:groupSlug/albums/:albumSlug/cover",
  upload.single("cover"),
  async (req, res) => {
    try {
      const { groupSlug, albumSlug } = req.params;
      const file = req.file;
      if (!file)
        return res.status(400).json({ erro: "Arquivo 'cover' é obrigatório." });

      const blobName = `${albumPrefix(groupSlug, albumSlug)}_cover.jpg`;
      const block = container.getBlockBlobClient(blobName);
      await block.uploadData(file.buffer, {
        blobHTTPHeaders: { blobContentType: file.mimetype },
      });

      res.json({ url: block.url });
    } catch (e) {
      console.error(e);
      res.status(500).json({ erro: "Erro ao enviar capa do álbum." });
    }
  }
);

/** ===========================================================
 *                        FOTOS
 *  ===========================================================
 */

// GET /eventos/:group/:album/photos
// routes/eventos.js  (dentro de GET /:group/:album/photos)
router.get("/:group/:album/photos", async (req, res) => {
  try {
    const { group, album } = req.params;
    const prefix = `grupos/${group}/albuns/${album}/`;

    // lê o título salvo
    let title = album;
    const titleBlob = container.getBlobClient(`${prefix}_album.txt`);
    if (await titleBlob.exists()) {
      const dl = await titleBlob.download();
      title = (await streamToString(dl.readableStreamBody)).trim();
    }

    const clean = (n) => decodeURIComponent(n).replace(/^\d{10,}-/, "");

    const photos = [];
    for await (const b of container.listBlobsFlat({ prefix })) {
      const raw = b.name.replace(prefix, "");
      if (raw.startsWith("_")) continue;

      // >>> importante: encodeURI no caminho completo
      const url = `${process.env.AZURE_BLOB_EVENTS_URL}/${encodeURI(b.name)}`;

      photos.push({
        name: raw,
        displayName: clean(raw),
        url,
        size: b.properties?.contentLength ?? null,
        contentType: b.properties?.contentType ?? null,
      });
    }

    res.json({ title, photos });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar fotos" });
  }
});

// POST /eventos/:group/:album/photos   form-data: fotos[]
router.post(
  "/:group/:album/photos",
  upload.array("fotos"),
  async (req, res) => {
    try {
      const { group, album } = req.params;
      if (!req.files?.length) {
        return res.status(400).json({ erro: "Nenhuma foto enviada." });
      }

      const url = `${process.env.AZURE_BLOB_EVENTS_URL}/${encodeURI(blobName)}`;
      added.push({ name: blobName.split("/").pop(), url });

      const added = [];
      for (const f of req.files) {
        const blobName = `${albumPrefix(group, album)}${Date.now()}-${
          f.originalname
        }`;
        const block = container.getBlockBlobClient(blobName);
        await block.uploadData(f.buffer, {
          blobHTTPHeaders: { blobContentType: f.mimetype },
        });
        added.push({ name: blobName.split("/").pop(), url: block.url });
      }

      res.status(201).json({ added });
    } catch (e) {
      console.error(e);
      res.status(500).json({ erro: "Erro ao enviar fotos" });
    }
  }
);

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

// PUT /eventos/groups/:groupSlug/title  body: { title }
router.put("/groups/:groupSlug/title", async (req, res) => {
  try {
    const { groupSlug } = req.params;
    const { title } = req.body || {};
    if (!title?.trim())
      return res.status(400).json({ erro: "title é obrigatório" });

    const blob = container.getBlockBlobClient(
      `${groupPrefix(groupSlug)}_group.txt`
    );
    await blob.uploadData(Buffer.from(title.trim(), "utf8"), {
      overwrite: true,
      blobHTTPHeaders: { blobContentType: "text/plain" },
    });

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao atualizar título do grupo" });
  }
});

// PUT /eventos/:group/albums/:album/title   body: { title }
router.put("/:group/albums/:album/title", async (req, res) => {
  try {
    const { group, album } = req.params;
    const { title } = req.body || {};
    if (!title?.trim())
      return res.status(400).json({ erro: "title é obrigatório" });

    const blob = container.getBlockBlobClient(
      `${albumPrefix(group, album)}_album.txt`
    );
    await blob.uploadData(Buffer.from(title.trim(), "utf8"), {
      overwrite: true,
      blobHTTPHeaders: { blobContentType: "text/plain" },
    });

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao atualizar título do álbum" });
  }
});

export default router;
