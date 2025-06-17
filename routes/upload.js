import express from "express";
import multer from "multer";
import { BlobServiceClient } from "@azure/storage-blob";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();

// Configuração do Multer para receber arquivos
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Conexão com o Azure Blob Storage
const AZURE_STORAGE_CONNECTION_STRING =
  process.env.AZURE_STORAGE_CONNECTION_STRING;
const blobServiceClient = BlobServiceClient.fromConnectionString(
  AZURE_STORAGE_CONNECTION_STRING
);
const containerName = "certificados";

// POST /upload?email=usuario@email.com
router.post("/", upload.single("arquivo"), async (req, res) => {
  const email = req.query.email;
  const arquivo = req.file;

  if (!email || !arquivo) {
    return res.status(400).json({ erro: "Email e arquivo são obrigatórios." });
  }

  try {
    const containerClient = blobServiceClient.getContainerClient(containerName);
    await containerClient.createIfNotExists();

    const blobName = `${email}/${Date.now()}-${arquivo.originalname}`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    await blockBlobClient.uploadData(arquivo.buffer, {
      blobHTTPHeaders: { blobContentType: arquivo.mimetype },
    });

    return res
      .status(200)
      .json({ mensagem: "Arquivo enviado com sucesso!", caminho: blobName });
  } catch (erro) {
    console.error("Erro no upload:", erro.message);
    return res.status(500).json({ erro: "Erro ao enviar arquivo." });
  }
});

// PUT /upload?email=usuario@email.com&arquivoAntigo=nome-antigo.ext
router.put("/", upload.single("arquivo"), async (req, res) => {
  const email = req.query.email;
  const arquivoAntigo = req.query.arquivoAntigo;
  const novoArquivo = req.file;

  if (!email || !arquivoAntigo || !novoArquivo) {
    return res
      .status(400)
      .json({ erro: "Email, arquivo antigo e novo arquivo são obrigatórios." });
  }

  try {
    const containerClient = blobServiceClient.getContainerClient(containerName);

    // Deletar o arquivo antigo
    const antigoBlob = containerClient.getBlockBlobClient(
      `${email}/${arquivoAntigo}`
    );
    await antigoBlob.deleteIfExists();

    // Fazer upload do novo arquivo
    const novoBlobName = `${email}/${Date.now()}-${novoArquivo.originalname}`;
    const novoBlob = containerClient.getBlockBlobClient(novoBlobName);

    await novoBlob.uploadData(novoArquivo.buffer, {
      blobHTTPHeaders: { blobContentType: novoArquivo.mimetype },
    });

    return res.status(200).json({
      mensagem: "Arquivo substituído com sucesso!",
      caminho: novoBlobName,
    });
  } catch (erro) {
    console.error("Erro ao substituir arquivo:", erro.message);
    return res.status(500).json({ erro: "Erro ao substituir arquivo." });
  }
});

// DELETE /upload?email=usuario@email.com&arquivo=nome.ext
router.delete("/", async (req, res) => {
  const email = req.query.email;
  const nomeArquivo = req.query.arquivo;

  if (!email || !nomeArquivo) {
    return res
      .status(400)
      .json({ erro: "Email e nome do arquivo são obrigatórios." });
  }

  try {
    const containerClient = blobServiceClient.getContainerClient(containerName);
    const blobClient = containerClient.getBlockBlobClient(
      `${email}/${nomeArquivo}`
    );

    await blobClient.deleteIfExists();

    return res.status(200).json({ mensagem: "Arquivo deletado com sucesso!" });
  } catch (erro) {
    console.error("Erro ao deletar arquivo:", erro.message);
    return res.status(500).json({ erro: "Erro ao deletar arquivo." });
  }
});

// GET /upload?email=usuario@email.com
router.get("/", async (req, res) => {
  const email = req.query.email;

  if (!email) {
    return res.status(400).json({ erro: "Email é obrigatório." });
  }

  try {
    const containerClient = blobServiceClient.getContainerClient(containerName);
    const blobs = containerClient.listBlobsFlat({ prefix: `${email}/` });

    const arquivos = [];
    for await (const blob of blobs) {
      arquivos.push(blob.name.replace(`${email}/`, ""));
    }

    return res.status(200).json({ arquivos });
  } catch (erro) {
    console.error("Erro ao listar arquivos:", erro.message);
    return res.status(500).json({ erro: "Erro ao listar arquivos." });
  }
});

// GET /certificados/:email/:arquivo
router.get("/certificados/:email/:arquivo", async (req, res) => {
  const { email, arquivo } = req.params;

  try {
    const containerClient = blobServiceClient.getContainerClient(containerName);
    const blobName = `${email}/${arquivo}`;
    const blobClient = containerClient.getBlobClient(blobName);

    if (!(await blobClient.exists())) {
      return res.status(404).send("Arquivo não encontrado.");
    }

    const downloadResponse = await blobClient.download();
    res.set("Content-Type", downloadResponse.contentType || "application/octet-stream");
    downloadResponse.readableStreamBody.pipe(res);
  } catch (erro) {
    console.error("Erro ao buscar arquivo:", erro.message);
    res.status(500).send("Erro ao buscar o arquivo.");
  }
});


export default router;
