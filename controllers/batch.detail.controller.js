const BatchDetail = require("../models/batch.detail.model.js");
const Profile = require("../models/profile.model.js");
const User = require("../models/user.model.js");
const { AppError } = require("../errors/AppError");
const azureBlob = require("../services/azure.blob.service");
const batchPaymentProcess = require("../services/batch.payment.process.service");

/**
 * Resolve createdBy userId to userFullName for API responses
 */
async function resolveCreatedByName(createdBy, tenantId) {
  if (!createdBy || createdBy === "unknown") return createdBy;
  const user = await User.findOne({ userId: createdBy, tenantId })
    .select("userFullName")
    .lean();
  return user?.userFullName || createdBy;
}
const { v4: uuidv4 } = require("uuid");


async function createBatchDetail(req, res) {
  try {
    const type = req.body?.type || req.query?.type;
    const batchDate = req.body?.batchDate || req.body?.date || req.query?.batchDate || req.query?.date;
    const paymentDate = req.body?.paymentDate || req.query?.paymentDate;
    const referenceNumber = req.body?.referenceNumber || req.query?.referenceNumber;
    const description = (req.body?.description || req.query?.description || "").trim();
    const comments = (req.body?.comments || req.query?.comments || "").trim();
    const workLocation = (req.body?.workLocation || req.query?.workLocation || "").trim() || null;
    const bank = (req.body?.bank || req.query?.bank || "").trim() || null;

    console.log("[BatchDetail] create:", {
      method: req.method,
      url: req.originalUrl,
      type, batchDate, referenceNumber,
      bodyKeys: Object.keys(req.body || {}),
      queryKeys: Object.keys(req.query || {}),
      hasFile: !!(req.file),
      contentType: req.headers["content-type"] || "NONE",
    });

    if (!type) return res.status(400).json({ success: false, message: "type is required" });
    if (!batchDate) return res.status(400).json({ success: false, message: "batchDate (or date) is required" });
    if (!paymentDate) return res.status(400).json({ success: false, message: "paymentDate is required" });
    if (!referenceNumber) return res.status(400).json({ success: false, message: "referenceNumber is required" });
    if (type === "deduction" && !workLocation) return res.status(400).json({ success: false, message: "workLocation is required when type is deduction" });
    if (type === "cheque" && !bank) return res.status(400).json({ success: false, message: "bank is required when type is cheque" });

    const tenantId = req.user?.tenantId || null;
    const createdBy = req.user?.userId || req.user?.id || "unknown";

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

    const batch = await BatchDetail.create({
      tenantId,
      type,
      batchDate: new Date(batchDate),
      paymentDate: new Date(paymentDate),
      workLocation,
      bank,
      batchStatus: "pending",
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

    if (req.file && req.file.buffer) {
      try {
        const result = await batchPaymentProcess.processBatchDetailWithBuffer(batch, req.file.buffer, tenantId);
        console.log("[BatchDetail] file processed:", result.message);
      } catch (err) {
        console.error("[BatchDetail] file processing error:", err.message);
        const saved = await BatchDetail.findById(batch._id).lean();
        const createdByName = await resolveCreatedByName(saved.createdBy, tenantId);
        return res.status(201).json({
          message: "Batch is created. File processing failed: " + err.message,
          data: { ...saved, createdBy: createdByName },
        });
      }
    }

    // Return the created batch with creator name instead of ID
    const saved = await BatchDetail.findById(batch._id).lean();
    const createdByName = await resolveCreatedByName(saved.createdBy, tenantId);
    return res.status(201).json({
      message: "Batch is created.",
      data: { ...saved, createdBy: createdByName },
    });
  } catch (error) {
    console.error("[BatchDetail] create error:", error.message);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create batch",
    });
  }
}
async function getBatchDetailById(req, res) {
  try {
    const { batchDetailId } = req.params;
    const batch = await BatchDetail.findOne({ _id: batchDetailId, isDeleted: false })
      .populate("batchPayments.profileId", "membershipNumber personalInfo contactInfo professionalDetails preferences")
      .lean();
    if (!batch) {
      return res.status(404).json({ success: false, message: "Batch detail not found" });
    }
    const tenantId = req.user?.tenantId || null;
    const createdByName = await resolveCreatedByName(batch.createdBy, tenantId);
    return res.json({ data: { ...batch, createdBy: createdByName } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function getAllBatchDetails(req, res) {
  try {
    if (req.user?.userType !== "CRM") {
      return res.status(403).json({ success: false, message: "Only CRM users can access batch details" });
    }

    const tenantId = req.user?.tenantId || null;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const skip = (page - 1) * limit;

    const query = { isDeleted: false };
    if (tenantId) query.tenantId = tenantId;

    if (req.query.type) {
      const validTypes = ["cheque", "deduction", "other"];
      if (validTypes.includes(req.query.type)) query.type = req.query.type;
    }

    const [batches, total] = await Promise.all([
      BatchDetail.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      BatchDetail.countDocuments(query),
    ]);

    // Resolve createdBy IDs to user names
    const creatorIds = [...new Set(batches.map((b) => b.createdBy).filter(Boolean))];
    const users = await User.find({
      userId: { $in: creatorIds },
      tenantId,
    })
      .select("userId userFullName")
      .lean();
    const userMap = new Map(users.map((u) => [u.userId, u.userFullName]));
    const batchesWithCreatorName = batches.map((b) => ({
      ...b,
      createdBy: userMap.get(b.createdBy) || b.createdBy,
    }));

    return res.json({
      data: batchesWithCreatorName,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("[BatchDetail] list error:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
}


async function resolveBatchException(req, res) {
  try {
    if (req.user?.userType !== "CRM") {
      return res.status(403).json({ success: false, message: "Only CRM users can resolve batch exceptions" });
    }

    const { batchDetailId } = req.params;
    const { membershipNumber, exceptionMembershipNumber } = req.body || {};
    const tenantId = req.user?.tenantId || null;

    const membershipNumberTrimmed = membershipNumber != null ? String(membershipNumber).trim() : "";
    const exceptionRefTrimmed = exceptionMembershipNumber != null ? String(exceptionMembershipNumber).trim() : "";

    if (!membershipNumberTrimmed) {
      return res.status(400).json({ success: false, message: "membershipNumber is required (correct profile membership number)" });
    }
    if (!exceptionRefTrimmed) {
      return res.status(400).json({ success: false, message: "exceptionMembershipNumber is required (reference number from batch exception row)" });
    }

    const batch = await BatchDetail.findOne({ _id: batchDetailId, isDeleted: false });
    if (!batch) {
      return res.status(404).json({
        success: false,
        message: "Batch not found. Please check the batch ID.",
      });
    }

    const exceptions = batch.batchExceptions || [];
    const matchingExceptions = exceptions.filter(
      (ex) => String(ex.membershipNumber || "").trim() === exceptionRefTrimmed
    );
    if (matchingExceptions.length === 0) {
      return res.status(404).json({
        success: false,
        message: `There is no member with this membership number in batch exceptions. No exception found for "${exceptionRefTrimmed}".`,
      });
    }

    const profileQuery = { membershipNumber: membershipNumberTrimmed };
    if (tenantId) profileQuery.tenantId = tenantId;
    const profile = await Profile.findOne(profileQuery)
      .select("membershipNumber personalInfo contactInfo professionalDetails preferences")
      .lean();

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Please provide the correct membership number. No profile found with this membership number.",
      });
    }

    // For each matching exception row: one payment entry with profile + that row's amount/rowIndex
    batch.batchPayments = batch.batchPayments || [];
    for (const exceptionRow of matchingExceptions) {
      const fileRow = {
        membershipNumber: exceptionRow.membershipNumber,
        lastName: exceptionRow.lastName,
        firstName: exceptionRow.firstName,
        fullName: exceptionRow.fullName,
        valueForPeriodSelected: exceptionRow.valueForPeriodSelected,
        rowIndex: exceptionRow.rowIndex,
      };
      const paymentEntry = batchPaymentProcess.buildBatchPaymentEntryFromProfile(profile, fileRow);
      batch.batchPayments.push(paymentEntry);
    }

    // Remove all matching exceptions from batch exceptions
    batch.batchExceptions = exceptions.filter(
      (ex) => String(ex.membershipNumber || "").trim() !== exceptionRefTrimmed
    );
    await batch.save();

    const updated = await BatchDetail.findById(batch._id)
      .populate("batchPayments.profileId", "membershipNumber personalInfo contactInfo professionalDetails preferences")
      .lean();

    const createdByName = await resolveCreatedByName(updated.createdBy, tenantId);

    const count = matchingExceptions.length;
    return res.status(200).json({
      message: count === 1
        ? "Batch exception resolved; 1 row moved to batch payment"
        : `Batch exception resolved; ${count} rows moved to batch payment`,
      data: { ...updated, createdBy: createdByName },
    });
  } catch (error) {
    console.error("[BatchDetail] resolveBatchException error:", error.message);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to resolve batch exception",
    });
  }
}

module.exports = { createBatchDetail, getBatchDetailById, getAllBatchDetails, resolveBatchException };
