import { CosmosClient } from "@azure/cosmos";
import dotenv from "dotenv";
dotenv.config();

// Configurações da instância do Cosmos
const uri = process.env.COSMOSDB_URI;
const key = process.env.COSMOSDB_KEY;
const databaseId = "graduados";
const containerId = "usuarios";

const client = new CosmosClient({ endpoint: uri, key });
const database = client.database(databaseId);
const container = database.container(containerId);

export async function listarPerfis() {
  const query = "SELECT * FROM c";
  const { resources } = await container.items.query(query).fetchAll();
  return resources;
}

// Buscar perfil por e-mail
export async function buscarPerfil(email) {
  const query = {
    query: "SELECT * FROM c WHERE c.email = @email",
    parameters: [{ name: "@email", value: email }],
  };

  const { resources } = await container.items.query(query).fetchAll();
  return resources?.[0] || null;
}

// Criar novo perfil
export async function criarPerfil(perfil) {
  if (!perfil.email) {
    throw new Error("Perfil sem email não pode ser salvo");
  }

  const { resource } = await container.items.create(perfil);
  return resource;
}

// Atualizar perfil existente
export async function atualizarPerfil(id, dadosAtualizados) {
  const { resource } = await container.item(id, id).replace(dadosAtualizados);
  return resource;
}

// Opcional: função health para teste de conexão
export async function testarConexao() {
  try {
    await container.items.query("SELECT VALUE COUNT(1) FROM c").fetchAll();
    return true;
  } catch (error) {
    console.error("Erro ao conectar com CosmosDB:", error.message);
    return false;
  }
}
