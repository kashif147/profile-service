const {
  BlobServiceClient,
  StorageSharedKeyCredential,
} = require("@azure/storage-blob");

// Test defaults; for production set AZURE_STORAGE_* in env. Replace key below with Key1 from Azure Portal if auth fails.
// const connectionString = (process.env.AZURE_STORAGE_CONNECTION_STRING || "").replace(/\s+/g, " ").trim();
// const accountName = (process.env.AZURE_STORAGE_ACCOUNT || "commsvcazureblobstorage").trim();
// const accountKey = (process.env.AZURE_STORAGE_KEY || "MN1g6U7vmT0cY+WiyipWz1MMxy7QR7p9MfSHaY3WYwXv3sfDcvWwGHlwUEbMXZYf0+4ah2eT0qC+ASt5wkAOQ==").replace(/\r?\n/g, "").trim();
// const containerName = (process.env.AZURE_STORAGE_CONTAINER || "generated-letters").trim();



const connectionString = (process.env.AZURE_STORAGE_CONNECTION_STRING || "").replace(/\s+/g, " ").trim();
const accountName = (process.env.AZURE_STORAGE_ACCOUNT || "").trim();
const accountKey = (process.env.AZURE_STORAGE_KEY || "").replace(/\r?\n/g, "").trim();
const containerName = (process.env.AZURE_STORAGE_CONTAINER || "").trim();

let blobServiceClient = null;
let sharedKeyCredential = null;
let resolvedAccountName = accountName;

if (connectionString) {
  blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const match = connectionString.match(/AccountName=([^;]+)/);
  resolvedAccountName = match ? match[1].trim() : accountName;
  const keyMatch = connectionString.match(/AccountKey=([^;]+)/);
  if (keyMatch && keyMatch[1]) {
    sharedKeyCredential = new StorageSharedKeyCredential(resolvedAccountName, keyMatch[1].trim());
  }
} else if (accountName && accountKey) {
  sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
  blobServiceClient = new BlobServiceClient(
    `https://${accountName}.blob.core.windows.net`,
    sharedKeyCredential
  );
}

module.exports = {
  blobServiceClient,
  sharedKeyCredential,
  containerName,
  accountName: resolvedAccountName,
  isConfigured: Boolean(blobServiceClient),
};
