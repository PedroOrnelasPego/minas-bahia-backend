import { BlobServiceClient, StorageSharedKeyCredential } from "@azure/storage-blob";
import dotenv from "dotenv";

dotenv.config();

const containerName = "certificados";

function createBlobServiceClient() {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const account = process.env.AZURE_STORAGE_ACCOUNT;
  const key = process.env.AZURE_STORAGE_KEY;
  const sasUrl = process.env.AZURE_BLOB_SAS_URL;

  if (conn && typeof conn === "string" && conn.trim()) {
    return BlobServiceClient.fromConnectionString(conn);
  }

  if (account && key) {
    const credential = new StorageSharedKeyCredential(account, key);
    const serviceUrl = `https://${account}.blob.core.windows.net`;
    return new BlobServiceClient(serviceUrl, credential);
  }

  if (sasUrl && typeof sasUrl === "string" && sasUrl.trim()) {
    return new BlobServiceClient(sasUrl);
  }

  console.warn("Azure Storage configuration missing. Using dummy client.");
  return {
    getContainerClient() {
      return {
        async createIfNotExists() {},
        async exists() { return false; },
        getBlockBlobClient() {
          return {
            async exists() { return false; },
            async deleteIfExists() {},
            url: "https://dummy-account.blob.core.windows.net/certificados/dummy-file"
          };
        },
        getBlobClient() {
          return {
            async exists() { return false; },
            async deleteIfExists() {},
            url: "https://dummy-account.blob.core.windows.net/certificados/dummy-file"
          };
        },
        async *listBlobsFlat() {
          // empty iterator
        }
      };
    }
  };
}

export const blobServiceClient = createBlobServiceClient();
export const containerClient = blobServiceClient.getContainerClient(containerName);

export const PUBLIC_BASE =
  process.env.AZURE_BLOB_URL ||
  (process.env.AZURE_STORAGE_ACCOUNT
    ? `https://${process.env.AZURE_STORAGE_ACCOUNT}.blob.core.windows.net`
    : "");

export function publicUrlFor(blobName) {
  return PUBLIC_BASE
    ? `${PUBLIC_BASE}/${containerName}/${blobName}`
    : `/${containerName}/${blobName}`;
}
