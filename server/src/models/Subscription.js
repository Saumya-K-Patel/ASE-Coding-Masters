import mongoose from "mongoose";

const subscriptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    book: { type: mongoose.Schema.Types.ObjectId, ref: "Book", required: true },
  },
  { timestamps: true }
);

subscriptionSchema.index({ user: 1, book: 1 }, { unique: true });

const Subscription = mongoose.model("Subscription", subscriptionSchema);
export default Subscription;
