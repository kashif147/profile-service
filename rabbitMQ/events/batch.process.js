// Batch process events: request processing (API → queue) and completion (worker → notification/frontend)
const BATCH_PROCESS_EVENTS = {
  BATCH_PROCESS_REQUESTED: "batch.process.requested",
  BATCH_PROCESS_COMPLETED: "batch.process.completed",
};

module.exports = {
  BATCH_PROCESS_EVENTS,
};
