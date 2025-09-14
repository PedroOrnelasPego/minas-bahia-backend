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

// converter stream em string (para ler _group.txt / _album.txt)
async function streamToString(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on("data", (d) => chunks.push(d.toString()));
    readable.on("end", () => resolve(chunks.join("")));
    readable.on("error", reject);
  });
}

// checagem simples de imagem
const isImageName = (name = "") =>
  /\.(png|jpg|jpeg|gif|webp|avif)$/i.test(name);

/** ===========================================================
 *                        GRUPOS
 *  ===========================================================
 */

// GET /eventos/groups
// Lista grupos com { slug, title, coverUrl }
router.get("/groups", async (_req, res) => {
  try {
    const groups = [];
    const prefix = "grupos/";

    // usa hierarquia para pegar APENAS pastas de 1º nível
    for await (const item of container.listBlobsByHierarchy("/", { prefix })) {
      if (item.kind !== "prefix") continue; // ignorar blobs, queremos "pastas"
      const slug = item.name.slice(prefix.length, -1); // remove prefixo e a barra final

      // Título: ler _group.txt se existir
      const titleBlob = container.getBlobClient(
        `${groupPrefix(slug)}_group.txt`
      );
      let title = slug;
      if (await titleBlob.exists()) {
        const dl = await titleBlob.download();
        title = (await streamToString(dl.readableStreamBody)).trim() || slug;
      }

      // Capa do grupo (opcional)
      const coverBlob = container.getBlockBlobClient(
        `${groupPrefix(slug)}_cover.jpg`
      );
      const coverUrl = (await coverBlob.exists()) ? coverBlob.url : "";

      groups.push({ slug, title, coverUrl });
    }

    res.json({ groups });
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
router.get("/:group/albums", async (req, res) => {
  try {
    const { group } = req.params;
    const albums = [];
    const prefix = albumsRootPrefix(group); // grupos/<g>/albuns/

    for await (const item of container.listBlobsByHierarchy("/", { prefix })) {
      if (item.kind !== "prefix") continue;
      const albumSlug = item.name.slice(prefix.length, -1);

      // título do álbum (opcional)
      const albumTitleBlob = container.getBlobClient(
        `${albumPrefix(group, albumSlug)}_album.txt`
      );
      let title = albumSlug;
      if (await albumTitleBlob.exists()) {
        const dl = await albumTitleBlob.download();
        title =
          (await streamToString(dl.readableStreamBody)).trim() || albumSlug;
      }

      // capa do álbum
      const coverBlob = container.getBlockBlobClient(
        `${albumPrefix(group, albumSlug)}_cover.jpg`
      );
      const coverUrl = (await coverBlob.exists()) ? coverBlob.url : "";

      // total de fotos (ignora nomes que começam com "_")
      let total = 0;
      const photoPrefix = albumPrefix(group, albumSlug);
      for await (const b of container.listBlobsFlat({ prefix: photoPrefix })) {
        const name = b.name.replace(photoPrefix, "");
        if (!name.startsWith("_") && isImageName(name)) total++;
      }

      albums.push({ slug: albumSlug, title, coverUrl, totalPhotos: total });
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
router.get("/:group/:album/photos", async (req, res) => {
  try {
    const { group, album } = req.params;
    const prefix = albumPrefix(group, album);
    const photos = [];

    for await (const b of container.listBlobsFlat({ prefix })) {
      const short = b.name.replace(prefix, "");
      if (short.startsWith("_")) continue; // ignora arquivos de meta (capa/títulos)
      if (!isImageName(short)) continue;

      photos.push({
        name: short,
        url: publicUrl(b.name),
        size: b.properties?.contentLength,
        contentType: b.properties?.contentType,
      });
    }

    res.json({ photos });
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

export default router;
