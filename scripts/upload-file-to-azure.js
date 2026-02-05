#!/usr/bin/env node
/**
 * Upload a file to Azure Blob Storage.
 * Requires env: AZURE_STORAGE_ACCOUNT, AZURE_STORAGE_KEY, AZURE_STORAGE_CONTAINER
 * Usage: node scripts/upload-file-to-azure.js <file-path>
 */

const path = require("path");
const fs = require("fs");
const {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
} = require("@azure/storage-blob");
const { v4: uuidv4 } = require("uuid");

// Load from environment (no secrets in repo)
const AZURE_STORAGE_ACCOUNT = (process.env.AZURE_STORAGE_ACCOUNT || "").trim();
const AZURE_STORAGE_KEY = (process.env.AZURE_STORAGE_KEY || "").trim();
const AZURE_STORAGE_CONTAINER = (process.env.AZURE_STORAGE_CONTAINER || "generated-letters").trim();

if (!AZURE_STORAGE_ACCOUNT || !AZURE_STORAGE_KEY) {
  console.error("Set AZURE_STORAGE_ACCOUNT and AZURE_STORAGE_KEY in environment (or .env).");
  process.exit(1);
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".csv": "text/csv",
    ".txt": "text/plain",
    ".json": "application/json",
  };
  return mime[ext] || "application/octet-stream";
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node scripts/upload-file-to-azure.js <file-path>");
    process.exit(1);
  }

  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error("File not found:", resolvedPath);
    process.exit(1);
  }

  const credential = new StorageSharedKeyCredential(AZURE_STORAGE_ACCOUNT, AZURE_STORAGE_KEY);
  const blobServiceClient = new BlobServiceClient(
    `https://${AZURE_STORAGE_ACCOUNT}.blob.core.windows.net`,
    credential
  );
  const containerClient = blobServiceClient.getContainerClient(AZURE_STORAGE_CONTAINER);

  const fileName = path.basename(resolvedPath);
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const blobPath = `batch-details/default/${uuidv4()}-${safeName}`;
  const contentType = getContentType(resolvedPath);
  const buffer = fs.readFileSync(resolvedPath);

  const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType },
  });

  const blobUrl = blockBlobClient.url;
  const now = new Date();
  const expiresOn = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour
  const sasToken = generateBlobSASQueryParameters(
    {
      containerName: AZURE_STORAGE_CONTAINER,
      blobName: blobPath,
      permissions: BlobSASPermissions.parse("r"),
      startsOn: now,
      expiresOn,
    },
    credential
  ).toString();
  const downloadUrl = `${blobUrl}?${sasToken}`;

  console.log("Uploaded successfully.");
  console.log("  blobPath:   ", blobPath);
  console.log("  container:  ", AZURE_STORAGE_CONTAINER);
  console.log("  fileName:  ", fileName);
  console.log("  blobUrl:    ", blobUrl);
  console.log("  downloadUrl:", downloadUrl);
}

main().catch((err) => {
  console.error("Upload failed:", err.message);
  process.exit(1);
});
