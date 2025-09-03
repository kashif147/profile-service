import mongoose from "mongoose";
const ProfessionalSchema = new mongoose.Schema(
  {
    tenantId: { type: String, index: true },
    ApplicationId: { type: String, index: true }, // optional for traceability
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default: null,
    },
    professionalDetails: Object,
  },
  { timestamps: true, versionKey: "professionalVersion" }
);
export default mongoose.model("Professional", ProfessionalSchema);
