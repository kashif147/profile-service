const { z } = require("zod");

// RFC 6902 op schema
const JsonPointer = z
  .string()
  .min(1)
  .regex(/^\/([^~\/]|~[01])*/); // basic pointer check

const PatchOp = z
  .object({
    op: z.enum(["add", "remove", "replace", "move", "copy", "test"]),
    path: JsonPointer,
    // value is required for add/replace/test, optional for others
    value: z.any().optional(),
    // from is required for move/copy
    from: JsonPointer.optional(),
  })
  .superRefine((op, ctx) => {
    const needsValue =
      op.op === "add" || op.op === "replace" || op.op === "test";
    if (needsValue && typeof op.value === "undefined") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"value" is required for op ${op.op}`,
        path: ["value"],
      });
    }
    const needsFrom = op.op === "move" || op.op === "copy";
    if (needsFrom && !op.from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"from" is required for op ${op.op}`,
        path: ["from"],
      });
    }
  });

const ProposedPatch = z
  .array(PatchOp)
  .nonempty({ message: "proposedPatch cannot be empty" });

// Minimal submission object (flexible, but must be an object)
const Submission = z.record(z.any());

// Review draft: client submits immutable submission + JSON Patch OR effectiveDocument
const ReviewDraftBody = z
  .object({
    submission: Submission,
    proposedPatch: ProposedPatch.optional(),
    effectiveDocument: Submission.optional(),
    notes: z.string().max(2000).optional(),
  })
  .superRefine((data, ctx) => {
    const hasPatch = !!data.proposedPatch;
    const hasEffective = !!data.effectiveDocument;

    if (!hasPatch && !hasEffective) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either proposedPatch OR effectiveDocument",
      });
    }
    if (hasPatch && hasEffective) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either proposedPatch OR effectiveDocument, not both",
      });
    }
  });

// Approve:
// Path A: overlayId + overlayVersion
// Path B: submission (approval with no changes)
// Path C: submission + proposedPatch (approval with changes)
const ApproveBody = z
  .object({
    overlayId: z.string().min(1).optional(),
    overlayVersion: z.number().int().nonnegative().optional(),
    submission: Submission.optional(),
    proposedPatch: z.array(PatchOp).optional(),
  })
  .superRefine((data, ctx) => {
    const hasOverlay =
      !!data.overlayId || typeof data.overlayVersion === "number";
    const hasSubmission = !!data.submission;
    const hasPatch = !!data.proposedPatch;
    const hasSubmissionWithPatch = hasSubmission && hasPatch;
    const hasSubmissionOnly = hasSubmission && !hasPatch;

    if (hasOverlay && (hasSubmission || hasPatch)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Provide either overlayId+overlayVersion OR submission (with optional proposedPatch), not both.",
      });
    }
    if (!hasOverlay && !hasSubmission) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Missing approval input. Provide overlayId+overlayVersion OR submission (with optional proposedPatch).",
      });
    }
    if (data.overlayId && typeof data.overlayVersion !== "number") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "overlayVersion is required when overlayId is provided.",
        path: ["overlayVersion"],
      });
    }
  });

// Reject: requires reason; overlay optional; optionally echo submission+proposedPatch for audit
// proposedPatch is optional and only needed when changes were made
const RejectBody = z
  .object({
    reason: z.string().min(2).max(500),
    notes: z.string().max(2000).optional(),
    overlayId: z.string().min(1).optional(),
    overlayVersion: z.number().int().nonnegative().optional(),
    submission: Submission.optional(),
    proposedPatch: z.array(PatchOp).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.overlayId && typeof data.overlayVersion !== "number") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "overlayVersion is required when overlayId is provided.",
        path: ["overlayVersion"],
      });
    }
  });

// Bulk approval: array of application IDs and optional processingDate for all subscriptions
const BulkApprovalBody = z.object({
  applicationIds: z
    .array(z.string().min(1))
    .min(1, { message: "At least one application ID is required" })
    .max(1000, {
      message: "Maximum 1000 applications can be approved at once",
    }),
  processingDate: z.union([z.string(), z.date()]).optional(), // Optional processingDate for all subscriptions in bulk approval
});

module.exports = {
  ReviewDraftBody,
  ApproveBody,
  RejectBody,
  BulkApprovalBody,
};
