import { CosmosClient } from "@azure/cosmos";
import crypto from "node:crypto";
import dotenv from "dotenv";
dotenv.config();

/**
 * ============================ Cosmos Config ============================
 */
const uri = process.env.COSMOSDB_URI;
const key = process.env.COSMOSDB_KEY;
const databaseId = "graduados";
const containerId = "usuarios";

const client = new CosmosClient({ endpoint: uri, key });
const database = client.database(databaseId);
const container = database.container(containerId);
export { container };

/**
 * ============================ CPF Utils ============================
 */
const CPF_SALT = process.env.CPF_HASH_SALT || "";

export function normalizeCpf(cpf = "") {
  return String(cpf).replace(/\D/g, "");
}

export function hashCpf(cpfDigits = "") {
  return crypto
    .createHash("sha256")
    .update(`${cpfDigits}${CPF_SALT}`)
    .digest("hex");
}

/**
 * ============================ Esquema de Perfil ============================
 * id            -> userId (UUID) [partitionKey]
 * userId        -> redundância igual ao id
 * primaryEmail  -> e-mail principal atual
 * emails        -> histórico de e-mails
 * (campo "email" é mantido por retrocompat, mas não usar no front novo)
 */

const PERFIL_KEYS = [
  "id",
  "userId",
  "primaryEmail",
  "emails",
  "criadoVia",
  "createdAt",

  // cadastro
  "nome",
  "apelido",
  "corda",
  "cpf",
  "cpfHash",
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

  // extras
  "cordaVerificada",
  "certificadosTimeline",

  // retrocompat/legado
  "email",
  "questionarios",
  "_attachments",
  "_etag",
  "_ts",
];

function newId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex");
}

/** Garante canonicidade e defaults */
export function canonicalizePerfil(input = {}) {
  const nowIso = new Date().toISOString();

  const primaryEmail =
    (input.primaryEmail || input.email || "").toString().trim().toLowerCase() ||
    undefined;

  const userId = input.userId || input.id || newId();

  const defaults = {
    id: userId,
    userId,
    primaryEmail,
    emails: primaryEmail
      ? [
          {
            value: primaryEmail,
            verified: undefined,
            provider: undefined,
            addedAt: nowIso,
          },
        ]
      : [],
    criadoVia: input.criadoVia || undefined,
    createdAt: input.createdAt || nowIso,

    nome: "",
    apelido: "",
    corda: "",
    cpf: undefined,
    cpfHash: undefined,
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

    cordaVerificada: false,
    certificadosTimeline: [],

    // retrocompat
    email: primaryEmail,
  };

  const src = {
    ...defaults,
    ...input,
    id: userId,
    userId,
    primaryEmail,
    email: primaryEmail,
  };

  const out = {};
  for (const k of PERFIL_KEYS) if (src[k] !== undefined) out[k] = src[k];
  for (const k of Object.keys(src)) if (!(k in out)) out[k] = src[k];
  return out;
}

/**
 * ============================ Repositório ============================
 */

// lista administrativa
export async function listarPerfis() {
  const { resources } = await container.items
    .query("SELECT * FROM c")
    .fetchAll();
  return resources;
}

// por id (partitionKey)
export async function buscarPerfilById(userId) {
  if (!userId) return null;
  try {
    const { resource } = await container.item(userId, userId).read();
    return resource || null;
  } catch (e) {
    if (e?.code === 404) return null;
    throw e;
  }
}

// por e-mail principal
export async function buscarPerfilByEmail(email) {
  if (!email) return null;
  const q = {
    query: "SELECT TOP 1 * FROM c WHERE c.primaryEmail = @e",
    parameters: [{ name: "@e", value: String(email).toLowerCase().trim() }],
  };
  const { resources = [] } = await container.items
    .query(q, { enableCrossPartitionQuery: true })
    .fetchAll();
  return resources[0] || null;
}

/** resolve email OR id → perfil */
export async function buscarPerfil(key) {
  if (!key) return null;
  if (String(key).includes("@")) return buscarPerfilByEmail(key);
  return buscarPerfilById(key);
}

export async function upsertPerfil(perfilParcial) {
  const perfil = canonicalizePerfil(perfilParcial);
  const { resource } = await container.items.upsert(perfil, {
    partitionKey: perfil.id,
  });
  return resource;
}

export async function atualizarPerfil(userId, patch) {
  if (!userId) throw new Error("userId é obrigatório");
  const current = (await buscarPerfilById(userId)) || { id: userId, userId };

  if (patch.cpf) {
    const digits = normalizeCpf(patch.cpf);
    patch.cpf = digits.length === 11 ? digits : undefined;
    patch.cpfHash = digits.length === 11 ? hashCpf(digits) : undefined;
  }

  if (patch.primaryEmail) {
    patch.primaryEmail = String(patch.primaryEmail).toLowerCase().trim();
    const list = new Set([
      ...(current.emails || []).map((e) => e.value),
      patch.primaryEmail,
    ]);
    patch.emails = [...list].map((v) => ({
      value: v,
      addedAt: new Date().toISOString(),
    }));
    patch.email = patch.primaryEmail; // retrocompat
  }

  const merged = canonicalizePerfil({
    ...current,
    ...patch,
    id: userId,
    userId,
  });
  const { resource } = await container.item(userId, userId).replace(merged);
  return resource;
}

/**
 * ============================ CPF exists ============================
 * Retorna false ou { id, email }
 */
export async function checkCpfExists({ cpfHash, cpfDigits }) {
  const by = cpfHash
    ? { field: "cpfHash", val: cpfHash }
    : cpfDigits
    ? { field: "cpf", val: cpfDigits }
    : null;

  if (!by) return false;

  const q = {
    query: `SELECT TOP 1 c.id, c.primaryEmail FROM c WHERE c.${by.field} = @v`,
    parameters: [{ name: "@v", value: by.val }],
  };
  const { resources = [] } = await container.items
    .query(q, { enableCrossPartitionQuery: true })
    .fetchAll();

  if (resources.length > 0) {
    return { id: resources[0].id, email: resources[0].primaryEmail };
  }
  return false;
}

/**
 * ============================ Certificados helpers ============================
 */
export async function appendCertificado(userId, entry) {
  const cur = (await buscarPerfilById(userId)) || { id: userId, userId };
  const next = canonicalizePerfil({
    ...cur,
    certificadosTimeline: [...(cur.certificadosTimeline || []), entry],
  });
  const { resource } = await container.item(userId, userId).replace(next);
  return resource;
}

export async function updateCertificado(userId, certId, patch) {
  const cur = await buscarPerfilById(userId);
  if (!cur) throw new Error("Perfil não encontrado");

  const list = [...(cur.certificadosTimeline || [])];
  const idx = list.findIndex((x) => x.id === certId);
  if (idx < 0) throw new Error("Certificado não encontrado");

  list[idx] = { ...list[idx], ...patch };
  const next = canonicalizePerfil({ ...cur, certificadosTimeline: list });
  const { resource } = await container.item(userId, userId).replace(next);
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
