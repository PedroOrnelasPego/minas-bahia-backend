import { CosmosClient } from "@azure/cosmos";
import dotenv from "dotenv";
dotenv.config();

const uri = process.env.COSMOSDB_URI;
const key = process.env.COSMOSDB_KEY;
const databaseId = "graduados";
const containerId = "usuarios";

const client = new CosmosClient({ endpoint: uri, key });

export async function buscarPerfil(email) {
  const query = {
    query: "SELECT * FROM c WHERE c.email = @email",
    parameters: [{ name: "@email", value: email }],
  };

  const { resources } = await client
    .database(databaseId)
    .container(containerId)
    .items.query(query)
    .fetchAll();

  return resources?.[0] || null;
}

export async function criarPerfil(perfil) {
  if (!perfil.email) {
    throw new Error("Perfil sem email não pode ser salvo");
  }

  const { resource } = await client
    .database(databaseId)
    .container(containerId)
    .items.create(perfil);

  return resource;
}

export async function atualizarPerfil(id, dadosAtualizados) {
  const { resource } = await client
    .database(databaseId)
    .container(containerId)
    .item(id, id) // id também é a partitionKey
    .replace(dadosAtualizados);

  return resource;
}
