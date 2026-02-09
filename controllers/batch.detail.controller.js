const BatchDetail = require("../models/batch.detail.model.js");
const { AppError } = require("../errors/AppError");
const azureBlob = require("../services/azure.blob.service");
const batchPaymentProcess = require("../services/batch.payment.process.service");
const { v4: uuidv4 } = require("uuid");

/**
 * Create a batch detail. ONE simple API.
 *
 * Required: type, date, referenceNumber (from body OR query params)
 * Optional: description, comments, file
 *
 * - If file is uploaded → process it (match membership numbers to profiles)
 * - If no file → just save the batch
 * - Always return the created batch with "Batch is created."
 */
async function createBatchDetail(req, res) {
  try {
    // Read from body OR query (gateway redirect strips body, query params survive)
    const type = req.body?.type || req.query?.type;
    const date = req.body?.date || req.query?.date;
    const referenceNumber = req.body?.referenceNumber || req.query?.referenceNumber;
    const description = (req.body?.description || req.query?.description || "").trim();
    const comments = (req.body?.comments || req.query?.comments || "").trim();

    console.log("[BatchDetail] create:", { type, date, referenceNumber, description: description || "(empty)", hasFile: !!(req.file), method: req.method });

    // Validate required fields
    if (!type || !date || !referenceNumber) {
      return res.status(400).json({
        success: false,
        message: "type, date, and referenceNumber are required",
        received: { type: type || null, date: date || null, referenceNumber: referenceNumber || null },
      });
    }

    const tenantId = req.user?.tenantId || null;
    const createdBy = req.user?.userId || req.user?.id || "unknown";

    // File upload to Azure (optional)
    let fileBlobPath = null;
    let fileUrl = null;
    let fileName = null;
    let fileContentType = null;

    if (req.file && req.file.buffer) {
      fileName = req.file.originalname || "file";
      fileContentType = req.file.mimetype || "application/octet-stream";
      if (azureBlob.isConfigured) {
        const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
        const blobPath = `batch-details/${tenantId || "default"}/${uuidv4()}-${safeName}`;
        fileUrl = await azureBlob.uploadToBlob(blobPath, req.file.buffer, fileContentType);
        fileBlobPath = blobPath;
      }
    }

    // Save batch to DB
    const batch = await BatchDetail.create({
      tenantId,
      type,
      date: new Date(date),
      referenceNumber: referenceNumber.trim(),
      description,
      comments,
      fileBlobPath,
      fileUrl,
      fileName,
      fileContentType,
      createdBy,
    });

    console.log("[BatchDetail] saved:", batch._id.toString());

    // If file was uploaded, process it (match membership numbers → batchPayments / batchExceptions)
    if (req.file && req.file.buffer) {
      try {
        const result = await batchPaymentProcess.processBatchDetailWithBuffer(batch, req.file.buffer, tenantId);
        console.log("[BatchDetail] file processed:", result.message);
      } catch (err) {
        console.error("[BatchDetail] file processing error:", err.message);
        // Batch is already saved, return it with a warning
        const saved = await BatchDetail.findById(batch._id).lean();
        return res.status(201).json({
          message: "Batch is created. File processing failed: " + err.message,
          data: saved,
        });
      }
    }

    // Return the created batch
    const saved = await BatchDetail.findById(batch._id).lean();
    return res.status(201).json({
      message: "Batch is created.",
      data: saved,
    });
  } catch (error) {
    console.error("[BatchDetail] create error:", error.message);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create batch",
    });
  }
}

/**
 * Get one batch detail by ID.
 */
async function getBatchDetailById(req, res) {
  try {
    const { batchDetailId } = req.params;
    const batch = await BatchDetail.findOne({ _id: batchDetailId, isDeleted: false })
      .populate("batchPayments.profileId", "membershipNumber personalInfo contactInfo professionalDetails preferences")
      .lean();
    if (!batch) {
      return res.status(404).json({ success: false, message: "Batch detail not found" });
    }
    return res.json({ data: batch });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

module.exports = { createBatchDetail, getBatchDetailById };
