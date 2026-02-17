/**
 * Background job: process a batch detail (call account-service in chunks, then mark processed/failed).
 * Used by the RabbitMQ consumer; not by the HTTP request.
 */
const BatchDetail = require("../models/batch.detail.model.js");
const axios = require("axios");

const PROCESS_BATCH_CHUNK_SIZE = parseInt(process.env.PROCESS_BATCH_CHUNK_SIZE, 10) || 250;

/**
 * Run the full batch processing for a batch detail: chunk loop → account-service → update status.
 * @param {string} batchDetailId - Mongo _id of the batch detail
 * @param {string|null} tenantId - Tenant ID for x-tenant-id header
 * @param {object} options - { authorization: string } optional Bearer token for account-service
 * @returns {Promise<{ success: boolean, processed?: number, failed?: number, errors?: array, message?: string }>}
 */
async function runBatchProcessing(batchDetailId, tenantId = null, options = {}) {
  const batch = await BatchDetail.findOne({ _id: batchDetailId, isDeleted: false }).lean();
  if (!batch) {
    return { success: false, message: "Batch detail not found" };
  }
  if (batch.batchStatus === "processed") {
    return { success: true, message: "Batch was already processed", processed: 0, failed: 0 };
  }

  const batchPayments = Array.isArray(batch.batchPayments) ? batch.batchPayments : [];
  if (batchPayments.length === 0) {
    await BatchDetail.updateOne(
      { _id: batchDetailId, isDeleted: false },
      { $set: { batchStatus: "failed" } }
    );
    return { success: false, message: "Batch has no batchPayments to process" };
  }

  const accountServiceUrl = process.env.ACCOUNT_SERVICE_URL || "https://projectshell-vm.northeurope.cloudapp.azure.com/account-service";
  const url = `${accountServiceUrl}/api/journal/process-batch`;
  const headers = {
    "Content-Type": "application/json",
    ...(options.authorization && { Authorization: options.authorization }),
    ...(tenantId && { "x-tenant-id": tenantId }),
  };

  const chunkSize = Math.max(1, PROCESS_BATCH_CHUNK_SIZE);
  const allResults = [];
  const allErrors = [];
  let totalProcessed = 0;
  let totalFailed = 0;

  try {
    for (let offset = 0; offset < batchPayments.length; offset += chunkSize) {
      const chunk = batchPayments.slice(offset, offset + chunkSize);
      const response = await axios.post(
        url,
        {
          paymentDate: batch.paymentDate,
          batchPayments: chunk,
        },
        {
          headers,
          timeout: 60000,
          validateStatus: (status) => status < 500,
        }
      );

      if (response.status >= 400) {
        await BatchDetail.updateOne(
          { _id: batchDetailId, isDeleted: false },
          { $set: { batchStatus: "failed" } }
        );
        return {
          success: false,
          message: response.data?.message || response.data?.error || "Account service error",
          processed: totalProcessed,
          failed: totalFailed,
          errors: allErrors.length ? allErrors : undefined,
        };
      }

      const data = response.data || {};
      totalProcessed += data.processed ?? 0;
      totalFailed += data.failed ?? 0;
      if (Array.isArray(data.results)) allResults.push(...data.results);
      if (Array.isArray(data.errors)) allErrors.push(...data.errors);
    }

    await BatchDetail.updateOne(
      { _id: batchDetailId, isDeleted: false },
      { $set: { batchStatus: "processed" } }
    );

    return {
      success: true,
      processed: totalProcessed,
      failed: totalFailed,
      results: allResults,
      errors: allErrors.length ? allErrors : undefined,
    };
  } catch (error) {
    const errMsg = error.response?.data?.message || error.message;
    console.error("[BatchProcessJob] runBatchProcessing error:", errMsg);
    await BatchDetail.updateOne(
      { _id: batchDetailId, isDeleted: false },
      { $set: { batchStatus: "failed" } }
    );
    return {
      success: false,
      message: errMsg,
      processed: totalProcessed,
      failed: totalFailed,
      errors: allErrors.length ? allErrors : undefined,
    };
  }
}

module.exports = {
  runBatchProcessing,
};
