import express from "express";
import Fine from "../models/Fine.js";
import User from "../models/User.js";
import Alert from "../models/Alert.js";
import { authRequired } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";

const router = express.Router();

router.get("/", authRequired, async (req, res) => {
  const query = ["student", "faculty"].includes(req.user.role) ? { user: req.user._id } : {};
  const fines = await Fine.find(query).populate("loan").populate("user", "name email").sort({ createdAt: -1 });
  return res.json(fines);
});

router.post("/:id/verify-payment", authRequired, requireRole("librarian", "staff", "admin"), async (req, res) => {
  const fine = await Fine.findById(req.params.id);
  if (!fine) return res.status(404).json({ message: "Fine not found" });

  fine.status = "paid";
  fine.verifiedBy = req.user._id;
  fine.verifiedAt = new Date();
  fine.resolutionNote = String(req.body.note || "").trim();
  await fine.save();

  const pendingFines = await Fine.find({ user: fine.user, status: "pending" });
  const totalOutstanding = pendingFines.reduce((sum, item) => sum + item.amount, 0);

  const user = await User.findById(fine.user);
  user.finesOutstanding = Number(totalOutstanding.toFixed(2));
  user.isBlocked = user.finesOutstanding > 0;
  await user.save();

  await Alert.create({
    type: "fine",
    message: fine.resolutionNote
      ? `Payment verified for fine of $${fine.amount.toFixed(2)}. Note: ${fine.resolutionNote}`
      : `Payment verified for fine of $${fine.amount.toFixed(2)}.`,
    recipient: user._id,
  });

  return res.json({ fine, user });
});

router.post("/:id/waive", authRequired, requireRole("admin"), async (req, res) => {
  const fine = await Fine.findById(req.params.id);
  if (!fine) return res.status(404).json({ message: "Fine not found" });
  if (fine.status !== "pending") return res.status(400).json({ message: "Only pending fines can be waived" });

  fine.status = "waived";
  fine.verifiedBy = req.user._id;
  fine.verifiedAt = new Date();
  fine.resolutionNote = String(req.body.note || "").trim() || "Fine waived by admin review.";
  await fine.save();

  const pendingFines = await Fine.find({ user: fine.user, status: "pending" });
  const totalOutstanding = pendingFines.reduce((sum, item) => sum + item.amount, 0);

  const user = await User.findById(fine.user);
  user.finesOutstanding = Number(totalOutstanding.toFixed(2));
  user.isBlocked = user.finesOutstanding > 0;
  await user.save();

  await Alert.create({
    type: "fine",
    message: `A fine of $${fine.amount.toFixed(2)} was waived. Note: ${fine.resolutionNote}`,
    recipient: user._id,
  });

  return res.json({ fine, user });
});

router.post("/:id/override-block", authRequired, requireRole("librarian", "staff", "admin"), async (req, res) => {
  const fine = await Fine.findById(req.params.id);
  if (!fine) return res.status(404).json({ message: "Fine not found" });

  const user = await User.findById(fine.user);
  if (!user) return res.status(404).json({ message: "User not found" });

  user.isBlocked = false;
  await user.save();

  return res.json({ message: "Borrowing block manually overridden", user });
});

export default router;
