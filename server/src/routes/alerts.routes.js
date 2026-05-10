import express from "express";
import Alert from "../models/Alert.js";
import Subscription from "../models/Subscription.js";
import Book from "../models/Book.js";
import { authRequired } from "../middleware/auth.js";

const router = express.Router();

router.get("/", authRequired, async (req, res) => {
  const canReadGlobalAlerts = ["librarian", "staff", "admin"].includes(req.user.role);
  const query = canReadGlobalAlerts
    ? { $or: [{ recipient: req.user._id }, { recipient: null }] }
    : { recipient: req.user._id };
  const alerts = await Alert.find(query).sort({ createdAt: -1 }).limit(50);
  return res.json(alerts);
});

router.post("/:id/read", authRequired, async (req, res) => {
  const alert = await Alert.findById(req.params.id);
  if (!alert) return res.status(404).json({ message: "Alert not found" });
  const canReadGlobalAlert = ["librarian", "staff", "admin"].includes(req.user.role) && !alert.recipient;
  if (!canReadGlobalAlert && alert.recipient?.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: "Forbidden" });
  }
  alert.read = true;
  await alert.save();
  return res.json(alert);
});

router.get("/subscriptions", authRequired, async (req, res) => {
  const subscriptions = await Subscription.find({ user: req.user._id }).populate("book");
  return res.json(subscriptions);
});

router.post("/subscriptions", authRequired, async (req, res) => {
  const { bookId } = req.body;
  const subscription = await Subscription.findOneAndUpdate(
    { user: req.user._id, book: bookId },
    { user: req.user._id, book: bookId },
    { new: true, upsert: true }
  );
  return res.status(201).json(subscription);
});

router.delete("/subscriptions/:bookId", authRequired, async (req, res) => {
  await Subscription.deleteOne({ user: req.user._id, book: req.params.bookId });
  return res.json({ message: "Unsubscribed" });
});

router.post("/stock-check", authRequired, async (req, res) => {
  const outToInStockBooks = await Book.find({ stock: { $gt: 0 } });
  const created = [];

  for (const book of outToInStockBooks) {
    const subs = await Subscription.find({ book: book._id });
    for (const sub of subs) {
      const alert = await Alert.create({
        type: "stock",
        message: `${book.title} is back in stock`,
        recipient: sub.user,
      });
      created.push(alert);
    }
  }

  return res.json({ notificationsCreated: created.length });
});

export default router;
