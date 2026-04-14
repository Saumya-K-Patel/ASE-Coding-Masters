import mongoose from "mongoose";

const alertSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["due", "stock", "overdue", "system", "reservation"],
      required: true,
    },
    message: { type: String, required: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const Alert = mongoose.model("Alert", alertSchema);
export default Alert;
