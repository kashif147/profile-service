const BatchDetail = require("../models/batch.detail.model.js");
const { AppError } = require("../errors/AppError");
const azureBlob = require("../services/azure.blob.service");
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
 * Create a batch detail (type: check | deduction, date, referenceNumber, description, comments, file).
 * File is uploaded to Azure Blob Storage. CRM only.
 * Expects multipart/form-data with optional file field "file".
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

    let fileBlobPath = null;
    let fileName = null;
    let fileContentType = null;

    if (req.file && req.file.buffer) {
      if (!azureBlob.isConfigured) {
        return next(
          AppError.badRequest(
            "Azure Storage is not configured. File upload is unavailable."
          )
        );
      }
      const ext =
        req.file.originalname && req.file.originalname.includes(".")
          ? req.file.originalname.split(".").pop()
          : "bin";
      const safeName = (req.file.originalname || "file")
        .replace(/[^a-zA-Z0-9._-]/g, "_");
      const blobPath = `batch-details/${tenantId || "default"}/${uuidv4()}-${safeName}`;
      await azureBlob.uploadToBlob(
        blobPath,
        req.file.buffer,
        req.file.mimetype || "application/octet-stream"
      );
      fileBlobPath = blobPath;
      fileName = req.file.originalname || "file";
      fileContentType = req.file.mimetype || "application/octet-stream";
    }

    const batchDetail = new BatchDetail({
      tenantId,
      type,
      date: new Date(date),
      referenceNumber: referenceNumber.trim(),
      description,
      comments,
      fileBlobPath,
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
      const ext =
        req.file.originalname && req.file.originalname.includes(".")
          ? req.file.originalname.split(".").pop()
          : "bin";
      const safeName = (req.file.originalname || "file")
        .replace(/[^a-zA-Z0-9._-]/g, "_");
      const blobPath = `batch-details/${tenantId || "default"}/${uuidv4()}-${safeName}`;
      await azureBlob.uploadToBlob(
        blobPath,
        req.file.buffer,
        req.file.mimetype || "application/octet-stream"
      );
      batchDetail.fileBlobPath = blobPath;
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

module.exports = {
  requireCrm,
  createBatchDetail,
  getAllBatchDetails,
  getBatchDetailById,
  updateBatchDetail,
  deleteBatchDetail,
  getBatchDetailFileDownloadUrl,
};
