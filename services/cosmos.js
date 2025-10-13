import { CosmosClient } from "@azure/cosmos";
import crypto from "node:crypto";
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

/* ============================ CPF Utils ============================ */
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

/* ============================ Canonicidade ============================ */
const PERFIL_KEYS = [
  "id",
  "email",
  "criadoVia",
  "createdAt",
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
  "nivelAcesso",
  "permissaoEventos",
  "aceitouTermos",
  "cordaVerificada",
  "certificadosTimeline",
  "podeEditarQuestionario",
  "questionarios",
  "_attachments",
  "_etag",
  "_ts",
];

export function canonicalizePerfil(input = {}) {
  const id = input.email || input.id;
  if (!id) throw new Error("Perfil precisa ter email/id");

  const defaults = {
    criadoVia: input.criadoVia || undefined,
    createdAt: input.createdAt || new Date().toISOString(),
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
    podeEditarQuestionario: false,
  };

  const src = { ...defaults, ...input, id, email: id }; // força id=email
  const out = {};
  for (const k of PERFIL_KEYS) if (src[k] !== undefined) out[k] = src[k];
  for (const k of Object.keys(src)) if (!(k in out)) out[k] = src[k];
  return out;
}

/* ============================ Busca/Migração ============================ */
/**
 * Procura um perfil por e-mail considerando formatos legados:
 * - c.id = email (canônico atual)
 * - c.email = email
 * - c.primaryEmail = email
 * - c.emails[].value contém email
 * Se achar doc com id !== email, migra para id=email e remove duplicados.
 */
export async function buscarPerfilSmart(email) {
  if (!email) return null;

  // 1) tentativa rápida (point read)
  try {
    const { resource } = await container.item(email, email).read();
    if (resource) return resource;
  } catch (e) {
    /* pode ser 404, seguimos para a query */
  }

  // 2) query cross-partition por campos legados
  const q = {
    query: `
      SELECT * FROM c
      WHERE c.id = @e
         OR c.email = @e
         OR c.primaryEmail = @e
         OR EXISTS(SELECT VALUE 1 FROM e IN c.emails WHERE e.value = @e)
    `,
    parameters: [{ name: "@e", value: email }],
  };

  const { resources = [] } = await container.items
    .query(q, { enableCrossPartitionQuery: true })
    .fetchAll();

  if (resources.length === 0) return null;

  // Preferir o que já está no formato canônico
  const canonical = resources.find((r) => r.id === email);
  if (canonical) {
    // Se houver outros duplicados, apaga-os
    for (const r of resources) {
      if (r.id !== email) {
        try {
          await container.item(r.id, r.id).delete();
        } catch {}
      }
    }
    return canonical;
  }

  // 3) Migrar o legado (id≠email) para o canônico
  const legacy = resources[0];
  const merged = canonicalizePerfil({
    ...legacy,
    id: email,
    email,
  });

  // cria/atualiza doc canônico
  const { resource: created } = await container.items.upsert(merged, {
    partitionKey: email,
  });

  // remove todos os antigos
  for (const r of resources) {
    if (r.id !== email) {
      try {
        await container.item(r.id, r.id).delete();
      } catch {}
    }
  }

  return created;
}

/* ============================ Consultas auxiliares ============================ */
export async function listarPerfis() {
  const { resources } = await container.items
    .query("SELECT * FROM c")
    .fetchAll();
  return resources;
}

/** Mantido por compat: point-read apenas (rápido quando já está canônico) */
export async function buscarPerfil(email) {
  if (!email) return null;
  try {
    const { resource } = await container.item(email, email).read();
    return resource || null;
  } catch (e) {
    if (e?.code === 404) return null;
    throw e;
  }
}

/* ============================ Gravação ============================ */
export async function upsertPerfil(perfilParcial) {
  const perfil = canonicalizePerfil(perfilParcial);
  const { resource } = await container.items.upsert(perfil, {
    partitionKey: perfil.id, // id=email
  });
  return resource;
}
export async function atualizarPerfil(email, patch) {
  if (!email) throw new Error("Email é obrigatório");

  // base atual (smart = já migra se for legado)
  const current = (await buscarPerfilSmart(email)) || { id: email, email };

  // normalização de CPF se vier
  if (patch.cpf) {
    const digits = normalizeCpf(patch.cpf);
    patch.cpf = digits.length === 11 ? digits : undefined;
    patch.cpfHash = digits.length === 11 ? hashCpf(digits) : undefined;
  }

  const merged = canonicalizePerfil({ ...current, ...patch, id: email, email });
  const { resource } = await container.items.upsert(merged, {
    partitionKey: email,
  });
  return resource;
}

/* ============================ CPF: existência ============================ */
export async function checkCpfExists({ cpfHash, cpfDigits }) {
  if (cpfHash) {
    const q = {
      query:
        "SELECT c.id, c.email FROM c WHERE c.cpfHash = @h OFFSET 0 LIMIT 1",
      parameters: [{ name: "@h", value: cpfHash }],
    };
    const { resources = [] } = await container.items
      .query(q, { enableCrossPartitionQuery: true })
      .fetchAll();
    if (resources.length > 0) {
      const r = resources[0];
      return { id: r.id, email: r.email || r.id };
    }
  }

  if (cpfDigits) {
    const q = {
      query: "SELECT c.id, c.email FROM c WHERE c.cpf = @c OFFSET 0 LIMIT 1",
      parameters: [{ name: "@c", value: cpfDigits }],
    };
    const { resources = [] } = await container.items
      .query(q, { enableCrossPartitionQuery: true })
      .fetchAll();
    if (resources.length > 0) {
      const r = resources[0];
      return { id: r.id, email: r.email || r.id };
    }
  }
  return false;
}

/* ============================ Health e Timeline ============================ */
export async function testarConexao() {
  try {
    await container.items.query("SELECT VALUE COUNT(1) FROM c").fetchAll();
    return true;
  } catch (error) {
    console.error("Erro ao conectar com CosmosDB:", error.message);
    return false;
  }
}

export async function appendCertificado(email, entry) {
  const cur = (await buscarPerfilSmart(email)) || { id: email, email };
  const next = canonicalizePerfil({
    ...cur,
    certificadosTimeline: [...(cur.certificadosTimeline || []), entry],
  });
  const { resource } = await container.items.upsert(next, {
    partitionKey: email,
  });
  return resource;
}

export async function updateCertificado(email, certId, patch) {
  const cur = await buscarPerfilSmart(email);
  if (!cur) throw new Error("Perfil não encontrado");

  const list = [...(cur.certificadosTimeline || [])];
  const idx = list.findIndex((x) => x.id === certId);
  if (idx < 0) throw new Error("Certificado não encontrado");

  list[idx] = { ...list[idx], ...patch };
  const next = canonicalizePerfil({ ...cur, certificadosTimeline: list });
  const { resource } = await container.items.upsert(next, {
    partitionKey: email,
  });
  return resource;
}
