const multer = require("multer");

// In-memory storage so we can send the buffer to Azure Blob
const storage = multer.memoryStorage();

// Optional single file, field name "file". Max 25MB.
const uploadSingleOptional = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
}).single("file");

module.exports = {
  uploadSingleOptional,
};
