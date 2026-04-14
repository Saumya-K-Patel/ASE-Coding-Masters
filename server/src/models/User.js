import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ["student", "faculty", "librarian", "staff", "admin"],
      default: "student",
    },
    department: { type: String, default: "General" },
    finesOutstanding: { type: Number, default: 0 },
    isBlocked: { type: Boolean, default: false },
    notificationPreferences: {
      dueReminders: { type: Boolean, default: true },
      stockAlerts: { type: Boolean, default: true },
      systemUpdates: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);
export default User;
