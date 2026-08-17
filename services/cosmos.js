// api/services/cosmos.js
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

/** Mantém apenas dígitos */
export function normalizeCpf(cpf = "") {
  return String(cpf).replace(/\D/g, "");
}

/** SHA-256(cpf + salt) -> hex */
export function hashCpf(cpfDigits = "") {
  return crypto
    .createHash("sha256")
    .update(`${cpfDigits}${CPF_SALT}`)
    .digest("hex");
}

/**
 * Checa existência por cpfHash (preferido) ou cpf puro.
 * Retorna:
 *   false        -> não existe
 *   { email, id} -> existe (perfil encontrado)
 */
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

/* ============================ Canonicidade ============================ */
const PERFIL_KEYS = [
  "id",
  "email",
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
  "matricula",

  // permissões/estado
  "nivelAcesso",
  "permissaoEventos",
  "permissaoAcervo",
  "categoriasAcervo",
  "aceitouTermos",

  // novos
  "cordaVerificada",
  "daAula",
  "certificadosTimeline",

  // extras
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
    matricula: input.matricula || undefined,

    nivelAcesso: "visitante",
    permissaoEventos: "leitor",
    permissaoAcervo: "leitor",
    categoriasAcervo: [],
    aceitouTermos: false,

    cordaVerificada: false,
    daAula: false,
    certificadosTimeline: [],
  };

  const id = input.email || input.id;
  if (!id) throw new Error("Perfil precisa ter email/id");

  const src = { ...defaults, ...input, id, email: id };

  const out = {};
  for (const k of PERFIL_KEYS) if (src[k] !== undefined) out[k] = src[k];
  for (const k of Object.keys(src)) if (!(k in out)) out[k] = src[k];
  return out;
}

/** Lista (apenas uso administrativo) */
export async function listarPerfis() {
  const { resources } = await container.items
    .query("SELECT * FROM c")
    .fetchAll();
  return resources;
}

/**
 * Lista mínima para a tela de chamada (somente nome + email).
 * Filtra perfis que já concluíram o cadastro (campos essenciais + aceitouTermos).
 */
export async function listarPessoasParaChamada({ limit = 5000 } = {}) {
  const q = {
    query: `
      SELECT
        c.id,
        c.email,
        c.nome,
        c.localTreino,
        c.horarioTreino,
        c.daAula,
        c.nivelAcesso,
        c.apelido
      FROM c
      WHERE
        c.aceitouTermos = true
        AND IS_DEFINED(c.nome) AND IS_STRING(c.nome) AND LENGTH(c.nome) > 0
        AND IS_DEFINED(c.corda) AND IS_STRING(c.corda) AND LENGTH(c.corda) > 0
        AND IS_DEFINED(c.genero) AND IS_STRING(c.genero) AND LENGTH(c.genero) > 0
        AND IS_DEFINED(c.racaCor) AND IS_STRING(c.racaCor) AND LENGTH(c.racaCor) > 0
        AND IS_DEFINED(c.dataNascimento) AND IS_STRING(c.dataNascimento) AND LENGTH(c.dataNascimento) > 0
        AND IS_DEFINED(c.whatsapp) AND IS_STRING(c.whatsapp) AND LENGTH(c.whatsapp) > 0
        AND IS_DEFINED(c.contatoEmergencia) AND IS_STRING(c.contatoEmergencia) AND LENGTH(c.contatoEmergencia) > 0
        AND IS_DEFINED(c.localTreino) AND IS_STRING(c.localTreino) AND LENGTH(c.localTreino) > 0
        AND IS_DEFINED(c.horarioTreino) AND IS_STRING(c.horarioTreino) AND LENGTH(c.horarioTreino) > 0
        AND IS_DEFINED(c.professorReferencia) AND IS_STRING(c.professorReferencia) AND LENGTH(c.professorReferencia) > 0
        AND IS_DEFINED(c.endereco) AND IS_STRING(c.endereco) AND LENGTH(c.endereco) > 0
        AND IS_DEFINED(c.numero) AND IS_STRING(c.numero) AND LENGTH(c.numero) > 0
        AND IS_DEFINED(c.inicioNoGrupo) AND IS_STRING(c.inicioNoGrupo) AND LENGTH(c.inicioNoGrupo) > 0
      OFFSET 0 LIMIT @lim
    `,
    parameters: [{ name: "@lim", value: Number(limit) || 5000 }],
  };

  const { resources = [] } = await container.items
    .query(q, { enableCrossPartitionQuery: true })
    .fetchAll();

  return (resources || [])
    .map((r) => ({
      email: r.email || r.id || "",
      nome: (r.nome || "").trim(),
      localTreino: r.localTreino || "",
      horarioTreino: r.horarioTreino || "",
      daAula: !!r.daAula,
      nivelAcesso: r.nivelAcesso || "aluno",
      apelido: (r.apelido || "").trim(),
    }))
    .filter((r) => !!r.email)
    .sort((a, b) => (a.nome || a.email).localeCompare(b.nome || b.email));
}

/* ============================ Aniversários ============================ */

function mapBirthdayRow(r = {}) {
  const raw = typeof r.dataNascimento === "string" ? r.dataNascimento : "";
  const iso = raw.length >= 10 ? raw.slice(0, 10) : "";
  return {
    nome: r.nome || "",
    apelido: r.apelido || "",
    email: r.email || r.id || "",
    corda: r.corda || "",
    dataNascimento: iso,
  };
}

/** Lista aniversários básicos (com limit) */
export async function listarAniversariosBasico({ limit = 2000 } = {}) {
  const q = {
    query: `
      SELECT
        c.id,
        c.email,
        c.nome,
        c.apelido,
        c.corda,
        SUBSTRING(c.dataNascimento, 0, 10) AS dataNascimento
      FROM c
      WHERE
        IS_DEFINED(c.dataNascimento) AND IS_STRING(c.dataNascimento)
        AND LENGTH(c.dataNascimento) >= 10
      OFFSET 0 LIMIT @lim
    `,
    parameters: [{ name: "@lim", value: Number(limit) || 2000 }],
  };

  const { resources = [] } = await container.items
    .query(q, { enableCrossPartitionQuery: true })
    .fetchAll();

  return resources.map(mapBirthdayRow).filter((x) => x.dataNascimento);
}

/** Lista aniversários por mês (1..12) */
export async function listarAniversariosPorMes(month, { limit = 2000 } = {}) {
  const mm = String(Number(month || 0)).padStart(2, "0");

  const q = {
    query: `
      SELECT
        c.id,
        c.email,
        c.nome,
        c.apelido,
        c.corda,
        SUBSTRING(c.dataNascimento, 0, 10) AS dataNascimento
      FROM c
      WHERE
        IS_DEFINED(c.dataNascimento) AND IS_STRING(c.dataNascimento)
        AND LENGTH(c.dataNascimento) >= 7
        AND SUBSTRING(c.dataNascimento, 5, 2) = @mm
      OFFSET 0 LIMIT @lim
    `,
    parameters: [
      { name: "@mm", value: mm },
      { name: "@lim", value: Number(limit) || 2000 },
    ],
  };

  const { resources = [] } = await container.items
    .query(q, { enableCrossPartitionQuery: true })
    .fetchAll();

  return resources.map(mapBirthdayRow).filter((x) => x.dataNascimento);
}

/**
 * Retorna uma lista leve de integrantes (para o diretório público).
 * Filtra apenas quem aceitou os termos e tem nome preenchido.
 */
export async function listarDiretorioPublico() {
  const q = {
    query: `
      SELECT 
        c.nome, 
        c.apelido, 
        c.email, 
        c.whatsapp,
        c.corda,
        c.localTreino,
        c.horarioTreino,
        c.inicioNoGrupo
      FROM c 
      WHERE c.aceitouTermos = true
        AND IS_DEFINED(c.nome) AND LENGTH(c.nome) > 0
    `
  };
  const { resources = [] } = await container.items
    .query(q, { enableCrossPartitionQuery: true })
    .fetchAll();

  return resources;
}

/* ============================ Matrícula Utils ============================ */


/** Extrai o ano de início de capoeira do grupo ou do createdAt */
export function extrairAnoInicio(perfil = {}) {
  const inicio = String(perfil.inicioNoGrupo || "").trim();
  const matchAno = inicio.match(/\b(19\d\d|20\d\d)\b/);
  if (matchAno) {
    return matchAno[1];
  }
  if (perfil.createdAt) {
    const d = new Date(perfil.createdAt);
    if (!isNaN(d.getFullYear())) {
      return String(d.getFullYear());
    }
  }
  return String(new Date().getFullYear());
}

/** Calcula a próxima matrícula livre no formato YYYYXXX */
export async function obterProximaMatricula(anoInicio) {
  const ano = anoInicio || String(new Date().getFullYear());
  const q = {
    query: "SELECT c.matricula FROM c WHERE IS_DEFINED(c.matricula) AND IS_STRING(c.matricula) AND LENGTH(c.matricula) >= 7",
  };
  const { resources = [] } = await container.items
    .query(q, { enableCrossPartitionQuery: true })
    .fetchAll();

  let maxSeq = 0;
  for (const r of resources) {
    const mat = String(r.matricula || "").trim();
    if (mat.length >= 7) {
      const seqStr = mat.slice(-3);
      const seqNum = parseInt(seqStr, 10);
      if (!isNaN(seqNum) && seqNum > maxSeq) {
        maxSeq = seqNum;
      }
    }
  }

  const proxSeq = maxSeq + 1;
  const seqPadded = String(proxSeq).padStart(3, "0");
  return `${ano}${seqPadded}`;
}

/** Busca por id/partitionKey = email. Evita query cross-partition. */
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

/** Busca perfil por número de matrícula */
export async function buscarPerfilPorMatricula(matricula) {
  if (!matricula) return null;
  const matClean = String(matricula).trim();
  const q = {
    query: "SELECT * FROM c WHERE c.matricula = @matricula",
    parameters: [{ name: "@matricula", value: matClean }],
  };
  const { resources = [] } = await container.items
    .query(q, { enableCrossPartitionQuery: true })
    .fetchAll();

  return resources.length > 0 ? resources[0] : null;
}

/** Upsert canônico (cria se não existir, atualiza se existir) */
export async function upsertPerfil(perfilParcial) {
  const id = perfilParcial.email || perfilParcial.id;
  const current = (await buscarPerfil(id)) || {};
  const mergedBefore = { ...current, ...perfilParcial };
  const nivel = (mergedBefore.nivelAcesso || "visitante").toLowerCase();

  if (nivel !== "visitante" && !mergedBefore.matricula) {
    const ano = extrairAnoInicio(mergedBefore);
    perfilParcial.matricula = await obterProximaMatricula(ano);
  }

  const perfil = canonicalizePerfil({ ...current, ...perfilParcial });
  const { resource } = await container.items.upsert(perfil, {
    partitionKey: perfil.id,
  });
  return resource;
}

/** Atualiza por replace preservando canonicidade */
export async function atualizarPerfil(email, patch) {
  if (!email) throw new Error("Email é obrigatório");
  const current = (await buscarPerfil(email)) || { id: email, email };

  if (patch.cpf) {
    const digits = normalizeCpf(patch.cpf);
    patch.cpf = digits.length === 11 ? digits : undefined;
    patch.cpfHash = digits.length === 11 ? hashCpf(digits) : undefined;
  }

  const mergedBefore = { ...current, ...patch };
  const nivel = (mergedBefore.nivelAcesso || "visitante").toLowerCase();

  if (nivel !== "visitante" && !mergedBefore.matricula) {
    const ano = extrairAnoInicio(mergedBefore);
    patch.matricula = await obterProximaMatricula(ano);
  }

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

export async function appendCertificado(email, entry) {
  const cur = (await buscarPerfil(email)) || { id: email, email };
  const next = canonicalizePerfil({
    ...cur,
    certificadosTimeline: [...(cur.certificadosTimeline || []), entry],
  });
  const { resource } = await container.item(email, email).replace(next);
  return resource;
}

export async function updateCertificado(email, certId, patch) {
  const cur = await buscarPerfil(email);
  if (!cur) throw new Error("Perfil não encontrado");

  const list = [...(cur.certificadosTimeline || [])];
  const idx = list.findIndex((x) => x.id === certId);
  if (idx < 0) throw new Error("Certificado não encontrado");

  list[idx] = { ...list[idx], ...patch };
  const next = canonicalizePerfil({ ...cur, certificadosTimeline: list });
  const { resource } = await container.item(email, email).replace(next);
  return resource;
}
