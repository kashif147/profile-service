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
    console.log("[BatchDetail] requireCrm: BLOCKED — userType is not CRM", { userType: req.user?.userType });
    return next(AppError.badRequest("Only CRM users can perform this action"));
  }
  console.log("[BatchDetail] requireCrm: OK (userType=CRM)", { userId: req.user?.userId || req.user?.id, tenantId: req.user?.tenantId });
  next();
}

/**
 * Create a batch detail (POST only). Required: type, date, referenceNumber, description.
 * Optional: comments, file.
 *
 * Logic:
 * 1. Always create the batch document in the database.
 * 2. If file is given: process the file (membership number column → match profiles
 *    → batchPayments for found, batchExceptions for not found).
 * 3. If file is not given: skip file processing (batchPayments and batchExceptions stay empty).
 * 4. Always return the created batch in the response with message "Batch is created."
 *
 * CRM only. Expects multipart/form-data with optional file field "file".
 */
async function createBatchDetail(req, res, next) {
  try {
    // Read from body (normal POST) or query params (fallback when redirect strips body)
    const b = req.body || {};
    const q = req.query || {};

    const tenantId = req.user?.tenantId || null;
    const createdBy = req.user?.userId || req.user?.id || "unknown";

    const type = b.type || q.type;
    const date = b.date || q.date;
    const referenceNumber = b.referenceNumber || q.referenceNumber;
    const description = (b.description || q.description || "").trim();
    const comments = (b.comments || q.comments || "").trim();

    console.log("[BatchDetail] createBatchDetail:", {
      method: req.method,
      type, date, referenceNumber,
      description: description ? "(present)" : "(missing)",
      hasFile: !!(req.file && req.file.buffer),
      source: Object.keys(b).length > 0 ? "body" : "query",
      tenantId,
    });

    if (!type || !date || !referenceNumber) {
      return next(
        AppError.badRequest("type, date, and referenceNumber are required")
      );
    }
    if (!description) {
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

    console.log("[BatchDetail] createBatchDetail: about to SAVE to DB", {
      tenantId,
      type,
      date: batchDetail.date,
      referenceNumber: batchDetail.referenceNumber,
      createdBy,
      hasFile: !!(fileBlobPath || fileUrl),
    });
    let saved;
    try {
      saved = await batchDetail.save();
    } catch (saveErr) {
      console.error("[BatchDetail] createBatchDetail: DB SAVE FAILED", {
        message: saveErr.message,
        name: saveErr.name,
        code: saveErr.code,
      });
      throw saveErr;
    }
    console.log("[BatchDetail] createBatchDetail: document SAVED OK", {
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

    console.log("[BatchDetail] createBatchDetail: fetching saved doc from DB for response", { id: saved._id?.toString() });
    const toReturn = await BatchDetail.findById(saved._id).lean();
    if (!toReturn) {
      console.error("[BatchDetail] createBatchDetail: findById returned null after save!", { id: saved._id?.toString() });
    }
    console.log("[BatchDetail] createBatchDetail: responding 201", {
      batchDetailId: toReturn?._id?.toString(),
      batchPaymentsCount: toReturn?.batchPayments?.length ?? 0,
      batchExceptionsCount: toReturn?.batchExceptions?.length ?? 0,
    });
    res.setHeader("X-Batch-Detail-Action", "create");
    return res.status(201).json({
      message: "Batch is created.",
      data: toReturn || saved.toObject ? saved.toObject() : saved,
    });
  } catch (error) {
    console.error("[BatchDetail] createBatchDetail: UNEXPECTED ERROR", {
      message: error.message,
      name: error.name,
      stack: error.stack?.split("\n").slice(0, 5).join(" | "),
    });
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
    // SAFEGUARD: Check if someone is trying to CREATE but method is GET
    // This catches cases where POST was converted to GET but body params leaked through
    const hasCreateParams = req.query.type || req.query.referenceNumber || req.query.description || req.query.date;
    if (hasCreateParams) {
      console.error("[BatchDetail] ❌ getAllBatchDetails called with create-like params:", { type: req.query.type, referenceNumber: req.query.referenceNumber });
      return res.status(400).json({
        error: "WRONG_METHOD",
        message: "You're trying to CREATE a batch but using GET (list). Use POST method with form-data body (not query params).",
        receivedParams: { type: req.query.type, referenceNumber: req.query.referenceNumber, description: req.query.description },
        expectedMethod: "POST",
        receivedMethod: "GET",
        hint: "Check if your POST request is being redirected to GET. In Postman: turn OFF 'Follow redirects'.",
      });
    }

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

    res.setHeader("X-Batch-Detail-Action", "list");
    const response = {
      data: items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };

    // If no batches found, add a helpful hint for users trying to create
    if (total === 0) {
      response.message = "No batch details found. To create a new batch, send a POST request to this endpoint with form-data: type, date, referenceNumber, description (and optionally comments, file).";
    }

    return res.json(response);
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
