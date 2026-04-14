import express from "express";
import Book from "../models/Book.js";
import { authRequired } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { serializeBook } from "../utils/bookRecord.js";

const router = express.Router();

router.get("/", authRequired, async (req, res) => {
  const { q = "", category = "" } = req.query;
  const query = {};

  if (category) query.category = category;
  if (q) {
    query.$or = [
      { title: { $regex: q, $options: "i" } },
      { author: { $regex: q, $options: "i" } },
      { semanticTopics: { $regex: q, $options: "i" } },
    ];
  }

  const books = await Book.find(query).sort({ createdAt: -1 });
  return res.json(books.map(serializeBook));
});

router.post("/", authRequired, requireRole("librarian", "staff", "admin"), async (req, res) => {
  try {
    const book = await Book.create(req.body);
    return res.status(201).json(serializeBook(book));
  } catch (error) {
    return res.status(400).json({ message: "Could not create book", error: error.message });
  }
});

router.put("/:id", authRequired, requireRole("librarian", "staff", "admin"), async (req, res) => {
  try {
    const book = await Book.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!book) return res.status(404).json({ message: "Book not found" });
    return res.json(serializeBook(book));
  } catch (error) {
    return res.status(400).json({ message: "Could not update book", error: error.message });
  }
});

router.delete("/:id", authRequired, requireRole("librarian", "staff", "admin"), async (req, res) => {
  const deleted = await Book.findByIdAndDelete(req.params.id);
  if (!deleted) return res.status(404).json({ message: "Book not found" });
  return res.json({ message: "Book removed" });
});

export default router;
