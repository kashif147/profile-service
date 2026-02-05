const BatchDetail = require("../models/batch.detail.model.js");
const { AppError } = require("../errors/AppError");
const azureBlob = require("../services/azure.blob.service");
const batchPaymentProcess = require("../services/batch.payment.process.service");
const { v4: uuidv4 } = require("uuid");

/**
 * Ensure only CRM users can perform write operations.
 */
function requireCrm(req, res, next) {
  if (req.user?.userType !== "CRM") {
    return next(AppError.badRequest("Only CRM users can perform this action"));
  }
  next();
}

/**
 * Create a batch detail. All required: type, date, referenceNumber, description, comments, file.
 * File is uploaded to Azure Blob Storage (no expiration). fileUrl is stored in the model.
 * CRM only. Expects multipart/form-data with file field "file".
 */
async function createBatchDetail(req, res, next) {
  try {
    const tenantId = req.user?.tenantId || null;
    const createdBy = req.user?.userId || req.user?.id || "unknown";

    const type = req.body.type;
    const date = req.body.date;
    const referenceNumber = req.body.referenceNumber;
    const description = (req.body.description || "").trim();
    const comments = (req.body.comments || "").trim();

    if (!type || !date || !referenceNumber) {
      return next(
        AppError.badRequest("type, date, and referenceNumber are required")
      );
    }

    const BATCH_DETAIL_TYPES = require("../models/batch.detail.model.js")
      .BATCH_DETAIL_TYPES;
    if (!BATCH_DETAIL_TYPES.includes(type)) {
      return next(
        AppError.badRequest(
          `type must be one of: ${BATCH_DETAIL_TYPES.join(", ")}`
        )
      );
    }

    if (!req.file || !req.file.buffer) {
      return next(AppError.badRequest("File is required"));
    }

    if (!azureBlob.isConfigured) {
      return next(
        AppError.badRequest(
          "Azure Storage is not configured. File upload is unavailable."
        )
      );
    }

    const safeName = (req.file.originalname || "file")
      .replace(/[^a-zA-Z0-9._-]/g, "_");
    const blobPath = `batch-details/${tenantId || "default"}/${uuidv4()}-${safeName}`;
    const fileUrl = await azureBlob.uploadToBlob(
      blobPath,
      req.file.buffer,
      req.file.mimetype || "application/octet-stream"
    );
    const fileBlobPath = blobPath;
    const fileName = req.file.originalname || "file";
    const fileContentType = req.file.mimetype || "application/octet-stream";

    const batchDetail = new BatchDetail({
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

    const saved = await batchDetail.save();

    return res.status(201).json({
      message: "Batch detail created successfully",
      data: saved.toJSON(),
    });
  } catch (error) {
    console.error("Error creating batch detail:", error);
    return next(
      AppError.internalServerError(
        error.message || "Failed to create batch detail"
      )
    );
  }
}

/**
 * Get all batch details with pagination and optional filters (type, tenantId).
 */
async function getAllBatchDetails(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;
    const type = req.query.type;
    const tenantId = req.user?.tenantId ?? req.query.tenantId;

    const query = { isDeleted: false };
    if (tenantId) query.tenantId = tenantId;
    if (type) query.type = type;

    const [items, total] = await Promise.all([
      BatchDetail.find(query).sort({ date: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
      BatchDetail.countDocuments(query),
    ]);

    return res.json({
      data: items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching batch details:", error);
    return next(
      AppError.internalServerError(
        error.message || "Failed to fetch batch details"
      )
    );
  }
}

/**
 * Get a single batch detail by ID.
 */
async function getBatchDetailById(req, res, next) {
  try {
    const { batchDetailId } = req.params;
    const tenantId = req.user?.tenantId;

    const query = { _id: batchDetailId, isDeleted: false };
    if (tenantId) query.tenantId = tenantId;

    const batchDetail = await BatchDetail.findOne(query).lean();
    if (!batchDetail) {
      return next(AppError.notFound("Batch detail not found"));
    }

    return res.json({ data: batchDetail });
  } catch (error) {
    console.error("Error fetching batch detail:", error);
    return next(
      AppError.internalServerError(
        error.message || "Failed to fetch batch detail"
      )
    );
  }
}

/**
 * Update a batch detail. Optional file replacement. CRM only.
 */
async function updateBatchDetail(req, res, next) {
  try {
    const { batchDetailId } = req.params;
    const tenantId = req.user?.tenantId;

    const query = { _id: batchDetailId, isDeleted: false };
    if (tenantId) query.tenantId = tenantId;

    const batchDetail = await BatchDetail.findOne(query);
    if (!batchDetail) {
      return next(AppError.notFound("Batch detail not found"));
    }

    if (req.body.type !== undefined) {
      const BATCH_DETAIL_TYPES = require("../models/batch.detail.model.js")
        .BATCH_DETAIL_TYPES;
      if (!BATCH_DETAIL_TYPES.includes(req.body.type)) {
        return next(
          AppError.badRequest(
            `type must be one of: ${BATCH_DETAIL_TYPES.join(", ")}`
          )
        );
      }
      batchDetail.type = req.body.type;
    }
    if (req.body.date !== undefined) batchDetail.date = new Date(req.body.date);
    if (req.body.referenceNumber !== undefined)
      batchDetail.referenceNumber = req.body.referenceNumber.trim();
    if (req.body.description !== undefined)
      batchDetail.description = req.body.description.trim();
    if (req.body.comments !== undefined)
      batchDetail.comments = req.body.comments.trim();

    if (req.file && req.file.buffer && azureBlob.isConfigured) {
      const safeName = (req.file.originalname || "file")
        .replace(/[^a-zA-Z0-9._-]/g, "_");
      const blobPath = `batch-details/${tenantId || "default"}/${uuidv4()}-${safeName}`;
      const fileUrl = await azureBlob.uploadToBlob(
        blobPath,
        req.file.buffer,
        req.file.mimetype || "application/octet-stream"
      );
      batchDetail.fileBlobPath = blobPath;
      batchDetail.fileUrl = fileUrl;
      batchDetail.fileName = req.file.originalname || "file";
      batchDetail.fileContentType =
        req.file.mimetype || "application/octet-stream";
    }

    const updated = await batchDetail.save();
    return res.json({
      message: "Batch detail updated successfully",
      data: updated.toJSON(),
    });
  } catch (error) {
    console.error("Error updating batch detail:", error);
    return next(
      AppError.internalServerError(
        error.message || "Failed to update batch detail"
      )
    );
  }
}

/**
 * Soft delete a batch detail. CRM only.
 */
async function deleteBatchDetail(req, res, next) {
  try {
    const { batchDetailId } = req.params;
    const tenantId = req.user?.tenantId;

    const query = { _id: batchDetailId, isDeleted: false };
    if (tenantId) query.tenantId = tenantId;

    const batchDetail = await BatchDetail.findOne(query);
    if (!batchDetail) {
      return next(AppError.notFound("Batch detail not found"));
    }

    batchDetail.isDeleted = true;
    await batchDetail.save();

    return res.json({ message: "Batch detail deleted successfully" });
  } catch (error) {
    console.error("Error deleting batch detail:", error);
    return next(
      AppError.internalServerError(
        error.message || "Failed to delete batch detail"
      )
    );
  }
}

/**
 * Get a time-limited download URL for the batch detail file (Azure SAS).
 */
async function getBatchDetailFileDownloadUrl(req, res, next) {
  try {
    const { batchDetailId } = req.params;
    const tenantId = req.user?.tenantId;
    const expiryMinutes = Math.min(
      1440,
      Math.max(1, parseInt(req.query.expiryMinutes, 10) || 60)
    );

    const query = { _id: batchDetailId, isDeleted: false };
    if (tenantId) query.tenantId = tenantId;

    const batchDetail = await BatchDetail.findOne(query).lean();
    if (!batchDetail) {
      return next(AppError.notFound("Batch detail not found"));
    }
    if (!batchDetail.fileBlobPath) {
      return next(AppError.notFound("No file attached to this batch detail"));
    }

    if (!azureBlob.isConfigured) {
      return next(
        AppError.serviceUnavailable(
          "Azure Storage is not configured. Download is unavailable."
        )
      );
    }

    const downloadUrl = azureBlob.generateDownloadUrl(
      batchDetail.fileBlobPath,
      expiryMinutes
    );

    return res.json({
      data: {
        downloadUrl,
        expiresInMinutes: expiryMinutes,
        fileName: batchDetail.fileName || null,
      },
    });
  } catch (error) {
    console.error("Error generating download URL:", error);
    return next(
      AppError.internalServerError(
        error.message || "Failed to generate download URL"
      )
    );
  }
}

/**
 * Process batch detail (deduction): read file from Azure, match Column A (Membership No)
 * to profiles; create batch payments for found members, exceptions for not found.
 * CRM only.
 */
async function processBatchDetail(req, res, next) {
  try {
    const { batchDetailId } = req.params;
    const tenantId = req.user?.tenantId || null;

    const result = await batchPaymentProcess.processBatchDetail({
      batchDetailId,
      tenantId,
    });

    return res.json({
      message: result.message,
      data: {
        paymentsCount: result.paymentsCount,
        exceptionsCount: result.exceptionsCount,
        payments: result.payments,
        exceptions: result.exceptions,
      },
    });
  } catch (error) {
    if (error.message === "Batch detail not found") {
      return next(AppError.notFound(error.message));
    }
    if (error.message === "No file attached to this batch detail") {
      return next(AppError.badRequest(error.message));
    }
    if (error.message === "Azure Storage is not configured") {
      return next(AppError.serviceUnavailable(error.message));
    }
    console.error("Error processing batch detail:", error);
    return next(
      AppError.internalServerError(
        error.message || "Failed to process batch detail"
      )
    );
  }
}

/**
 * Get batch payments for a batch detail (members found in system). From BatchDetail.batchPayments.
 */
async function getBatchPayments(req, res, next) {
  try {
    const { batchDetailId } = req.params;
    const tenantId = req.user?.tenantId;
    const query = { _id: batchDetailId, isDeleted: false };
    if (tenantId) query.tenantId = tenantId;

    const batchDetail = await BatchDetail.findOne(query)
      .select("batchPayments")
      .populate("batchPayments.profileId", "membershipNumber personalInfo contactInfo")
      .lean();
    if (!batchDetail) {
      return next(AppError.notFound("Batch detail not found"));
    }

    const payments = (batchDetail.batchPayments || []).sort(
      (a, b) => (a.rowIndex || 0) - (b.rowIndex || 0)
    );
    return res.json({ data: payments });
  } catch (error) {
    console.error("Error fetching batch payments:", error);
    return next(
      AppError.internalServerError(
        error.message || "Failed to fetch batch payments"
      )
    );
  }
}

/**
 * Get batch payment exceptions for a batch detail (members not found). From BatchDetail.batchExceptions.
 */
async function getBatchPaymentExceptions(req, res, next) {
  try {
    const { batchDetailId } = req.params;
    const tenantId = req.user?.tenantId;
    const query = { _id: batchDetailId, isDeleted: false };
    if (tenantId) query.tenantId = tenantId;

    const batchDetail = await BatchDetail.findOne(query)
      .select("batchExceptions")
      .lean();
    if (!batchDetail) {
      return next(AppError.notFound("Batch detail not found"));
    }

    const exceptions = (batchDetail.batchExceptions || []).sort(
      (a, b) => (a.rowIndex || 0) - (b.rowIndex || 0)
    );
    return res.json({ data: exceptions });
  } catch (error) {
    console.error("Error fetching batch payment exceptions:", error);
    return next(
      AppError.internalServerError(
        error.message || "Failed to fetch batch payment exceptions"
      )
    );
  }
}

module.exports = {
  requireCrm,
  createBatchDetail,
  getAllBatchDetails,
  getBatchDetailById,
  updateBatchDetail,
  deleteBatchDetail,
  getBatchDetailFileDownloadUrl,
  processBatchDetail,
  getBatchPayments,
  getBatchPaymentExceptions,
};
