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

// Review draft: client submits immutable submission + JSON Patch
const ReviewDraftBody = z.object({
  submission: Submission,
  proposedPatch: ProposedPatch,
  notes: z.string().max(2000).optional(),
});

// Approve:
// Path A: overlayId + overlayVersion
// Path B: submission + proposedPatch (single-step approval)
const ApproveBody = z
  .object({
    overlayId: z.string().min(1).optional(),
    overlayVersion: z.number().int().nonnegative().optional(),
    submission: Submission.optional(),
    proposedPatch: ProposedPatch.optional(),
  })
  .superRefine((data, ctx) => {
    const hasOverlay =
      !!data.overlayId || typeof data.overlayVersion === "number";
    const hasPatch = !!data.submission && !!data.proposedPatch;

    if (hasOverlay && hasPatch) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Provide either overlayId+overlayVersion OR submission+proposedPatch, not both.",
      });
    }
    if (!hasOverlay && !hasPatch) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Missing approval input. Provide overlayId+overlayVersion OR submission+proposedPatch.",
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
const RejectBody = z
  .object({
    reason: z.string().min(2).max(500),
    notes: z.string().max(2000).optional(),
    overlayId: z.string().min(1).optional(),
    overlayVersion: z.number().int().nonnegative().optional(),
    submission: Submission.optional(),
    proposedPatch: ProposedPatch.optional(),
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

module.exports = {
  ReviewDraftBody,
  ApproveBody,
  RejectBody,
};
