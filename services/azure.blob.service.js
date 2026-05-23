const { v4: uuidv4 } = require("uuid");
const {
  blobServiceClient,
  containerName,
  isConfigured,
  sharedKeyCredential,
  accountName,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
} = require("../config/azure.storage");

async function uploadToBlob(
  blobPath,
  buffer,
  contentType,
  downloadFileName = null
) {
  if (!isConfigured) {
    throw new Error(
      "Azure Storage is not configured. Set AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT and AZURE_STORAGE_KEY."
    );
  }
  const nameForDisposition =
    downloadFileName || blobPath.split("/").pop() || "file";
  const asciiFallback = nameForDisposition
    .replace(/[\r\n"]/g, "_")
    .replace(/[^\x20-\x7E]/g, "_")
    .slice(0, 200) || "file";

  const container = blobServiceClient.getContainerClient(containerName);
  await container.createIfNotExists();
  const blockBlob = container.getBlockBlobClient(blobPath);
  await blockBlob.uploadData(buffer, {
    blobHTTPHeaders: {
      blobContentType: contentType || "application/octet-stream",
      blobContentDisposition: `inline; filename="${asciiFallback}"`,
    },
  });
  return blockBlob.url;
}

function getDownloadSasUrl(blobPath, minutes = 15) {
  if (!isConfigured || !sharedKeyCredential || !blobPath) return null;
  const container = blobServiceClient.getContainerClient(containerName);
  const blobClient = container.getBlockBlobClient(blobPath);
  const expiresOn = new Date(Date.now() + minutes * 60 * 1000);
  const sas = generateBlobSASQueryParameters(
    {
      containerName,
      blobName: blobPath,
      permissions: BlobSASPermissions.parse("r"),
      expiresOn,
    },
    sharedKeyCredential
  ).toString();
  return `${blobClient.url}?${sas}`;
}

function buildPaymentFormBlobPath(tenantId, profileId, suffix) {
  return `payment-forms/${tenantId}/${profileId}/${uuidv4()}-${suffix}`;
}

module.exports = {
  uploadToBlob,
  getDownloadSasUrl,
  buildPaymentFormBlobPath,
  isConfigured,
};
