import { CosmosClient } from "@azure/cosmos";
import dotenv from "dotenv";
dotenv.config();

const uri = process.env.COSMOSDB_URI;
const key = process.env.COSMOSDB_KEY;
const databaseId = "graduados";
const containerId = "usuarios";

const client = new CosmosClient({ endpoint: uri, key });
const database = client.database(databaseId);
const container = database.container(containerId);
export { container };

/**
 * Campos do perfil em ORDEM canônica. Use isto para garantir que
 * Microsoft e Google tenham o mesmo objeto.
 */
const PERFIL_KEYS = [
  "id",
  "email",
  "criadoVia", // "google" | "microsoft"
  "createdAt",

  // cadastro
  "nome",
  "apelido",
  "corda",
  "genero",
  "racaCor",
  "dataNascimento",
  "whatsapp",
  "contatoEmergencia",
  "endereco",
  "numero",
  "localTreino",
  "horarioTreino",
  "professorReferencia",
  "inicioNoGrupo",

  // permissões/estado
  "nivelAcesso",
  "permissaoEventos",
  "aceitouTermos",

  // extras opcionais
  "questionarios",
  "_attachments",
  "_etag",
  "_ts",
];

/** Retorna um objeto somente com as chaves conhecidas e defaults */
export function canonicalizePerfil(input = {}) {
  const defaults = {
    criadoVia: input.criadoVia || undefined,
    createdAt: input.createdAt || new Date().toISOString(),

    nome: "",
    apelido: "",
    corda: "",
    genero: "",
    racaCor: "",
    dataNascimento: "",
    whatsapp: "",
    contatoEmergencia: "",
    endereco: "",
    numero: "",
    localTreino: "",
    horarioTreino: "",
    professorReferencia: "",
    inicioNoGrupo: "",

    nivelAcesso: "visitante",
    permissaoEventos: "leitor",
    aceitouTermos: false,
  };

  const id = input.email || input.id;
  if (!id) throw new Error("Perfil precisa ter email/id");

  const src = { ...defaults, ...input, id, email: id };

  // monta em ordem
  const out = {};
  for (const k of PERFIL_KEYS) {
    if (src[k] !== undefined) out[k] = src[k];
  }
  // inclui quaisquer campos extras (caso futuro), no final
  for (const k of Object.keys(src)) {
    if (!(k in out)) out[k] = src[k];
  }
  return out;
}

/** Lista (apenas uso administrativo) */
export async function listarPerfis() {
  const { resources } = await container.items
    .query("SELECT * FROM c")
    .fetchAll();
  return resources;
}

/** Busca por id/partitionKey = email. Evita query cross-partition. */
export async function buscarPerfil(email) {
  if (!email) return null;
  try {
    const { resource } = await container.item(email, email).read();
    return resource || null;
  } catch (e) {
    // 404 => não existe
    if (e?.code === 404) return null;
    throw e;
  }
}

/** Upsert canônico (cria se não existir, atualiza se existir) */
export async function upsertPerfil(perfilParcial) {
  const perfil = canonicalizePerfil(perfilParcial);
  const { resource } = await container.items.upsert(perfil, {
    // garante que a PK é o id/email
    partitionKey: perfil.id,
  });
  return resource;
}

/** Atualiza por replace preservando canonicidade */
export async function atualizarPerfil(email, patch) {
  if (!email) throw new Error("Email é obrigatório");
  const current = (await buscarPerfil(email)) || { id: email, email };
  const merged = canonicalizePerfil({ ...current, ...patch, id: email, email });
  const { resource } = await container.item(email, email).replace(merged);
  return resource;
}

/** Opcional: health-check */
export async function testarConexao() {
  try {
    await container.items.query("SELECT VALUE COUNT(1) FROM c").fetchAll();
    return true;
  } catch (error) {
    console.error("Erro ao conectar com CosmosDB:", error.message);
    return false;
  }
}
