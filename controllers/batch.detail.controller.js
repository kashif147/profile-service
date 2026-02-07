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
    console.log("[BatchDetail] requireCrm: blocked — userType is not CRM", { userType: req.user?.userType });
    return next(AppError.badRequest("Only CRM users can perform this action"));
  }
  next();
}

/**
 * Create a batch detail. Required: type, date, referenceNumber, description.
 * Optional: comments, file.
 *
 * - When NO file is uploaded: create the document in the database and return it
 *   in the response (batchPayments and batchExceptions stay empty).
 *
 * - When a file IS uploaded: create the document, optionally upload to Azure if
 *   configured, then parse the file. The file must have a membership number column
 *   (column A). For each row: look up the membership number in Profile; if found,
 *   add that profile to batchPayments; if not found, add the row to batchExceptions.
 *   Return the created document with batchPayments and batchExceptions populated.
 *
 * CRM only. Expects multipart/form-data with optional file field "file".
 */
async function createBatchDetail(req, res, next) {
  try {
    console.log("[BatchDetail] createBatchDetail: request received", {
      hasFile: !!(req.file && req.file.buffer),
      fileName: req.file?.originalname,
      bodyKeys: Object.keys(req.body || {}),
      type: req.body?.type,
      date: req.body?.date,
      referenceNumber: req.body?.referenceNumber,
      tenantId: req.user?.tenantId,
    });

    const tenantId = req.user?.tenantId || null;
    const createdBy = req.user?.userId || req.user?.id || "unknown";

    const type = req.body.type;
    const date = req.body.date;
    const referenceNumber = req.body.referenceNumber;
    const description = (req.body.description || "").trim();
    const comments = (req.body.comments || "").trim();

    if (!type || !date || !referenceNumber) {
      console.log("[BatchDetail] createBatchDetail: validation failed — missing type/date/referenceNumber");
      return next(
        AppError.badRequest("type, date, and referenceNumber are required")
      );
    }
    if (!description) {
      console.log("[BatchDetail] createBatchDetail: validation failed — description required");
      return next(AppError.badRequest("description is required"));
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
    let fileUrl = null;
    let fileName = null;
    let fileContentType = null;

    if (req.file && req.file.buffer) {
      fileName = req.file.originalname || "file";
      fileContentType = req.file.mimetype || "application/octet-stream";
      if (azureBlob.isConfigured) {
        const safeName = (req.file.originalname || "file")
          .replace(/[^a-zA-Z0-9._-]/g, "_");
        const blobPath = `batch-details/${tenantId || "default"}/${uuidv4()}-${safeName}`;
        fileUrl = await azureBlob.uploadToBlob(
          blobPath,
          req.file.buffer,
          req.file.mimetype || "application/octet-stream"
        );
        fileBlobPath = blobPath;
      }
      // If Azure not configured, we still create the batch and process the file from buffer
      // (batchPayments/batchExceptions will be populated; fileUrl will stay null).
    }

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
    console.log("[BatchDetail] createBatchDetail: document saved", {
      batchDetailId: saved._id?.toString(),
      tenantId: saved.tenantId,
      type: saved.type,
      hasFile: !!(fileName || fileUrl),
      azureConfigured: azureBlob.isConfigured,
    });

    // When file was uploaded: match membership numbers to profiles → batchPayments;
    // rows not found in DB → batchExceptions. Always process from buffer when file present.
    if (req.file && req.file.buffer && saved._id) {
      try {
        console.log("[BatchDetail] createBatchDetail: processing file from buffer", { bufferLength: req.file.buffer.length });
        const processResult = await batchPaymentProcess.processBatchDetailWithBuffer(
          saved,
          req.file.buffer,
          tenantId
        );
        console.log("[BatchDetail] createBatchDetail: file processed", {
          batchDetailId: saved._id?.toString(),
          paymentsCount: processResult?.paymentsCount ?? 0,
          exceptionsCount: processResult?.exceptionsCount ?? 0,
          message: processResult?.message,
        });
      } catch (processErr) {
        console.error("[BatchDetail] createBatchDetail: error processing batch file:", processErr);
        return next(
          AppError.internalServerError(
            processErr.message || "Batch created but file processing failed"
          )
        );
      }
    }

    const toReturn = await BatchDetail.findById(saved._id).lean();
    console.log("[BatchDetail] createBatchDetail: responding 201", {
      batchDetailId: toReturn?._id?.toString(),
      batchPaymentsCount: toReturn?.batchPayments?.length ?? 0,
      batchExceptionsCount: toReturn?.batchExceptions?.length ?? 0,
    });
    return res.status(201).json({
      message: "Batch detail created successfully",
      data: toReturn,
    });
  } catch (error) {
    console.error("[BatchDetail] createBatchDetail: unexpected error", error);
    return next(
      AppError.internalServerError(
        error.message || "Failed to create batch detail"
      )
    );
  }
}

/**
 * Get all batch details with pagination and optional filters (type, tenantId).
 * When user has a tenantId, show batches for that tenant OR batches with no tenant (null),
 * so batches created without tenant (e.g. missing header) still appear.
 */
async function getAllBatchDetails(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;
    const type = req.query.type;
    const tenantId = req.user?.tenantId ?? req.query.tenantId;

    const query = { isDeleted: false };
    if (tenantId) {
      // Include batches for this tenant OR batches with no tenant (created without tenant context)
      query.$or = [
        { tenantId },
        { tenantId: null },
        { tenantId: { $exists: false } },
      ];
    }
    if (type) query.type = type;

    console.log("[BatchDetail] getAllBatchDetails: query", { page, limit, tenantId, type, query: JSON.stringify(query) });

    const [items, total] = await Promise.all([
      BatchDetail.find(query).sort({ date: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
      BatchDetail.countDocuments(query),
    ]);

    console.log("[BatchDetail] getAllBatchDetails: result", { total, returned: items.length });

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
 * Get a single batch detail by ID with all details populated (batchPayments with profile, batchExceptions, fileUrl).
 * File URL is stored permanently on the batch when file is uploaded at create/update (no expiry).
 */
async function getBatchDetailById(req, res, next) {
  try {
    const { batchDetailId } = req.params;
    const tenantId = req.user?.tenantId;

    const query = { _id: batchDetailId, isDeleted: false };
    if (tenantId) query.tenantId = tenantId;

    console.log("[BatchDetail] getBatchDetailById: request", { batchDetailId, tenantId });

    const batchDetail = await BatchDetail.findOne(query)
      .populate("batchPayments.profileId", "membershipNumber personalInfo contactInfo professionalDetails preferences")
      .lean();
    if (!batchDetail) {
      console.log("[BatchDetail] getBatchDetailById: not found", { batchDetailId });
      return next(AppError.notFound("Batch detail not found"));
    }

    console.log("[BatchDetail] getBatchDetailById: found", { batchDetailId, batchPaymentsCount: batchDetail.batchPayments?.length, batchExceptionsCount: batchDetail.batchExceptions?.length });
    return res.json({ data: batchDetail });
  } catch (error) {
    console.error("[BatchDetail] getBatchDetailById: error", error);
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

module.exports = {
  requireCrm,
  createBatchDetail,
  getAllBatchDetails,
  getBatchDetailById,
  updateBatchDetail,
  deleteBatchDetail,
};
