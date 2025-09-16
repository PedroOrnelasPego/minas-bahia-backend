import express from "express";
import multer from "multer";
import { BlobServiceClient } from "@azure/storage-blob";
import dotenv from "dotenv";

dotenv.config();
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const containerName = "certificados";
const blobServiceClient = BlobServiceClient.fromConnectionString(
  process.env.AZURE_STORAGE_CONNECTION_STRING
);

const BASE_FOLDER = "documentos";

// **Aqui** você precisa instanciar o containerClient **UMA SÓ VEZ**:
const containerClient = blobServiceClient.getContainerClient(containerName);

// Pastas permitidas
const PASTAS = [
  "aluno",
  "graduado",
  "monitor",
  "instrutor",
  "professor",
  "contramestre",
];

// --- UPLOAD de arquivo público em pasta fixa ---
router.post("/public", upload.single("arquivo"), async (req, res) => {
  const { pasta } = req.query;
  if (!PASTAS.includes(pasta)) {
    return res.status(400).json({ erro: "Pasta inválida." });
  }
  const blobName = `${BASE_FOLDER}/${pasta}/${Date.now()}-${
    req.file.originalname
  }`;
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  try {
    await blockBlobClient.uploadData(req.file.buffer, {
      blobHTTPHeaders: { blobContentType: req.file.mimetype },
    });
    res.status(201).json({ mensagem: "Arquivo enviado." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao enviar arquivo." });
  }
});

// --- LISTAR arquivos de uma pasta pública ---
router.get("/public", async (req, res) => {
  const { pasta } = req.query;
  if (!PASTAS.includes(pasta)) {
    return res.status(400).json({ erro: "Pasta inválida." });
  }
  try {
    const arquivos = [];
    const prefix = `${BASE_FOLDER}/${pasta}/`;
    for await (const blob of containerClient.listBlobsFlat({ prefix })) {
      const url = containerClient.getBlockBlobClient(blob.name).url;
      const nomeLimpo = blob.name.replace(prefix, "");
      arquivos.push({ nome: nomeLimpo, url });
    }
    res.json({ arquivos });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao listar arquivos." });
  }
});

// --- DELETE de um arquivo público ---
router.delete("/public", async (req, res) => {
  const { pasta, arquivo } = req.query;
  if (!PASTAS.includes(pasta) || !arquivo) {
    return res.status(400).json({ erro: "Parâmetros inválidos." });
  }
  const blobName = `${BASE_FOLDER}/${pasta}/${arquivo}`;
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  try {
    await blockBlobClient.delete();
    res.json({ mensagem: "Arquivo removido." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao remover arquivo." });
  }
});

// FOTO PERFIL - Upload (agora aceita ?name=)
router.post("/foto-perfil", upload.single("arquivo"), async (req, res) => {
  const { email, name } = req.query;
  const arquivo = req.file;

  if (!email || !arquivo) {
    return res.status(400).json({ erro: "Email e arquivo são obrigatórios." });
  }

  try {
    const containerClient = blobServiceClient.getContainerClient(containerName);
    await containerClient.createIfNotExists();

    const safeName = (name || "foto-perfil.jpg").replace(
      /[^a-zA-Z0-9@._-]/g,
      ""
    );
    const blobName = `${email}/${safeName}`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    await blockBlobClient.uploadData(arquivo.buffer, {
      blobHTTPHeaders: {
        blobContentType: arquivo.mimetype,
        blobCacheControl: "public, max-age=31536000, immutable",
      },
    });

    const url = `${process.env.AZURE_BLOB_URL}/${blobName}`;
    res.status(200).json({ mensagem: "Foto enviada com sucesso!", url });
  } catch (erro) {
    console.error("Erro no upload de foto:", erro.message);
    res.status(500).json({ erro: "Erro ao enviar a foto." });
  }
});

// FOTO PERFIL - Delete (apaga @1x, @2x e legado)
router.delete("/foto-perfil", async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ erro: "Email é obrigatório." });

  try {
    const containerClient = blobServiceClient.getContainerClient(containerName);
    const names = [
      `${email}/foto-perfil@1x.jpg`,
      `${email}/foto-perfil@2x.jpg`,
      `${email}/foto-perfil.jpg`, // legado
    ];
    await Promise.all(
      names.map((n) => containerClient.getBlockBlobClient(n).deleteIfExists())
    );
    res.status(200).json({ mensagem: "Foto(s) deletada(s) com sucesso!" });
  } catch (erro) {
    console.error("Erro ao deletar foto:", erro.message);
    res.status(500).json({ erro: "Erro ao deletar a foto." });
  }
});

// GERAR NOME DE CERTIFICADO
const gerarNomeBlob = (email, originalName) =>
  `${email}/certificados/${Date.now()}-${originalName}`;

// CERTIFICADO - Upload
router.post("/", upload.single("arquivo"), async (req, res) => {
  const { email } = req.query;
  const arquivo = req.file;

  if (!email || !arquivo)
    return res.status(400).json({ erro: "Email e arquivo são obrigatórios." });

  try {
    const containerClient = blobServiceClient.getContainerClient(containerName);
    await containerClient.createIfNotExists();

    const blobName = gerarNomeBlob(email, arquivo.originalname);
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    await blockBlobClient.uploadData(arquivo.buffer, {
      blobHTTPHeaders: { blobContentType: arquivo.mimetype },
    });

    const url = `${process.env.AZURE_BLOB_URL}/${blobName}`;

    res.status(200).json({
      mensagem: "Arquivo enviado com sucesso!",
      caminho: blobName,
      url,
    });
  } catch (erro) {
    console.error("Erro no upload:", erro.message);
    res.status(500).json({ erro: "Erro ao enviar arquivo." });
  }
});

// CERTIFICADO - Substituir
router.put("/", upload.single("arquivo"), async (req, res) => {
  const { email, arquivoAntigo } = req.query;
  const novoArquivo = req.file;

  if (!email || !arquivoAntigo || !novoArquivo)
    return res
      .status(400)
      .json({ erro: "Email, arquivo antigo e novo arquivo são obrigatórios." });

  try {
    const containerClient = blobServiceClient.getContainerClient(containerName);
    await containerClient
      .getBlockBlobClient(`${email}/certificados/${arquivoAntigo}`)
      .deleteIfExists();

    const novoNome = gerarNomeBlob(email, novoArquivo.originalname);
    await containerClient
      .getBlockBlobClient(novoNome)
      .uploadData(novoArquivo.buffer, {
        blobHTTPHeaders: { blobContentType: novoArquivo.mimetype },
      });

    const url = `${process.env.AZURE_BLOB_URL}/${novoNome}`;

    res.status(200).json({
      mensagem: "Arquivo substituído com sucesso!",
      caminho: novoNome,
      url,
    });
  } catch (erro) {
    console.error("Erro ao substituir arquivo:", erro.message);
    res.status(500).json({ erro: "Erro ao substituir arquivo." });
  }
});

// CERTIFICADO - Deletar
router.delete("/", async (req, res) => {
  const { email, arquivo } = req.query;

  if (!email || !arquivo)
    return res
      .status(400)
      .json({ erro: "Email e nome do arquivo são obrigatórios." });

  try {
    const caminho = `${email}/certificados/${arquivo}`;
    const containerClient = blobServiceClient.getContainerClient(containerName);
    await containerClient.getBlockBlobClient(caminho).deleteIfExists();

    res.status(200).json({ mensagem: "Arquivo deletado com sucesso!" });
  } catch (erro) {
    console.error("Erro ao deletar arquivo:", erro.message);
    res.status(500).json({ erro: "Erro ao deletar arquivo." });
  }
});

// LISTAR CERTIFICADOS
router.get("/", async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ erro: "Email é obrigatório." });

  try {
    const prefix = `${email}/certificados/`;
    const containerClient = blobServiceClient.getContainerClient(containerName);
    const arquivos = [];

    for await (const blob of containerClient.listBlobsFlat({ prefix })) {
      const nome = blob.name.replace(prefix, "");
      const url = `${process.env.AZURE_BLOB_URL}/${blob.name}`;
      arquivos.push({ nome, url });
    }

    res.status(200).json({ arquivos });
  } catch (erro) {
    console.error("Erro ao listar certificados:", erro.message);
    res.status(500).json({ erro: "Erro ao listar arquivos." });
  }
});

// VISUALIZAR/DOWNLOAD INDIVIDUAL
router.get("/certificados/:email/:arquivo", async (req, res) => {
  const { email, arquivo } = req.params;

  try {
    const blobPath = `${email}/certificados/${arquivo}`;
    const containerClient = blobServiceClient.getContainerClient(containerName);
    const blobClient = containerClient.getBlobClient(blobPath);

    if (!(await blobClient.exists()))
      return res.status(404).send("Arquivo não encontrado.");

    const downloadResponse = await blobClient.download();
    res.set(
      "Content-Type",
      downloadResponse.contentType || "application/octet-stream"
    );
    downloadResponse.readableStreamBody.pipe(res);
  } catch (erro) {
    console.error("Erro ao buscar arquivo:", erro.message);
    res.status(500).send("Erro ao buscar o arquivo.");
  }
});

export default router;
