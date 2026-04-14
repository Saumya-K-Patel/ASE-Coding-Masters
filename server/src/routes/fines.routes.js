import express from "express";
import Fine from "../models/Fine.js";
import User from "../models/User.js";
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
  await fine.save();

  const pendingFines = await Fine.find({ user: fine.user, status: "pending" });
  const totalOutstanding = pendingFines.reduce((sum, item) => sum + item.amount, 0);

  const user = await User.findById(fine.user);
  user.finesOutstanding = Number(totalOutstanding.toFixed(2));
  user.isBlocked = user.finesOutstanding > 0;
  await user.save();

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
