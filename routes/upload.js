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

// Utilitário: nome do blob formatado
const gerarNomeBlob = (email, originalName) =>
  `${email}/${Date.now()}-${originalName}`;

// POST - Upload de novo arquivo
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

// PUT - Substituir arquivo
router.put("/", upload.single("arquivo"), async (req, res) => {
  const { email, arquivoAntigo } = req.query;
  const novoArquivo = req.file;

  if (!email || !arquivoAntigo || !novoArquivo)
    return res.status(400).json({ erro: "Email, arquivo antigo e novo arquivo são obrigatórios." });

  try {
    const containerClient = blobServiceClient.getContainerClient(containerName);

    await containerClient
      .getBlockBlobClient(`${email}/${arquivoAntigo}`)
      .deleteIfExists();

    const novoNome = gerarNomeBlob(email, novoArquivo.originalname);
    await containerClient.getBlockBlobClient(novoNome).uploadData(novoArquivo.buffer, {
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

// DELETE - Deletar arquivo
router.delete("/", async (req, res) => {
  const { email, arquivo } = req.query;

  if (!email || !arquivo)
    return res.status(400).json({ erro: "Email e nome do arquivo são obrigatórios." });

  try {
    const containerClient = blobServiceClient.getContainerClient(containerName);
    await containerClient.getBlockBlobClient(`${email}/${arquivo}`).deleteIfExists();

    res.status(200).json({ mensagem: "Arquivo deletado com sucesso!" });
  } catch (erro) {
    console.error("Erro ao deletar arquivo:", erro.message);
    res.status(500).json({ erro: "Erro ao deletar arquivo." });
  }
});

// GET - Listar arquivos (com URL)
router.get("/", async (req, res) => {
  const { email } = req.query;

  if (!email)
    return res.status(400).json({ erro: "Email é obrigatório." });

  try {
    const containerClient = blobServiceClient.getContainerClient(containerName);
    const arquivos = [];

    for await (const blob of containerClient.listBlobsFlat({ prefix: `${email}/` })) {
      const nome = blob.name.replace(`${email}/`, "");
      const url = `${process.env.AZURE_BLOB_URL}/${blob.name}`;
      arquivos.push({ nome, url });
    }

    res.status(200).json({ arquivos });
  } catch (erro) {
    console.error("Erro ao listar arquivos:", erro.message);
    res.status(500).json({ erro: "Erro ao listar arquivos." });
  }
});

// GET - Visualizar/baixar arquivo diretamente
router.get("/certificados/:email/:arquivo", async (req, res) => {
  const { email, arquivo } = req.params;

  try {
    const containerClient = blobServiceClient.getContainerClient(containerName);
    const blobClient = containerClient.getBlobClient(`${email}/${arquivo}`);

    if (!(await blobClient.exists()))
      return res.status(404).send("Arquivo não encontrado.");

    const downloadResponse = await blobClient.download();
    res.set("Content-Type", downloadResponse.contentType || "application/octet-stream");

    downloadResponse.readableStreamBody.pipe(res);
  } catch (erro) {
    console.error("Erro ao buscar arquivo:", erro.message);
    res.status(500).send("Erro ao buscar o arquivo.");
  }
});

export default router;
