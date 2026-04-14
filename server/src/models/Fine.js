import mongoose from "mongoose";

const fineSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    loan: { type: mongoose.Schema.Types.ObjectId, ref: "Loan", required: true },
    amount: { type: Number, required: true, min: 0 },
    reason: { type: String, default: "Overdue return" },
    status: { type: String, enum: ["pending", "paid", "waived"], default: "pending" },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

const Fine = mongoose.model("Fine", fineSchema);
export default Fine;
