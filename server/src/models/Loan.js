import mongoose from "mongoose";

const loanSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    book: { type: mongoose.Schema.Types.ObjectId, ref: "Book", required: true },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "returned"],
      default: "approved",
    },
    requestDate: { type: Date, default: Date.now },
    borrowDate: { type: Date, default: null },
    dueDate: { type: Date, default: null },
    returnedAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reservationDecisionAt: { type: Date, default: null },
    reservationDecisionBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    rejectionReason: { type: String, default: "" },
    renewalRequestStatus: {
      type: String,
      enum: ["none", "pending", "rejected"],
      default: "none",
    },
    renewalRequestedAt: { type: Date, default: null },
    renewalDecisionAt: { type: Date, default: null },
    renewalDecisionBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    renewalRejectionReason: { type: String, default: "" },
    returnRequestStatus: {
      type: String,
      enum: ["none", "pending", "rejected"],
      default: "none",
    },
    returnRequestedAt: { type: Date, default: null },
    returnDecisionAt: { type: Date, default: null },
    returnDecisionBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    returnRejectionReason: { type: String, default: "" },
    renewalCount: { type: Number, default: 0 },
    maxRenewals: { type: Number, default: 2 },
    borrowPolicyDays: { type: Number, default: 14 },
    policyTier: { type: String, default: "standard" },
    overdueDailyRate: { type: Number, default: 2.5 },
  },
  { timestamps: true }
);

loanSchema.virtual("isReturned").get(function isReturned() {
  return Boolean(this.returnedAt);
});

const Loan = mongoose.model("Loan", loanSchema);
export default Loan;
