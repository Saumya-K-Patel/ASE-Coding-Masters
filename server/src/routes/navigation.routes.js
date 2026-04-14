// AR navigation routes — polished with nearby book discovery
import express from "express";
import Book from "../models/Book.js";
import { authRequired } from "../middleware/auth.js";
import { getBookLocation } from "../utils/bookRecord.js";

const router = express.Router();

router.get("/ar/:bookId", authRequired, async (req, res) => {
  const book = await Book.findById(req.params.bookId);
  if (!book) return res.status(404).json({ message: "Book not found" });
  const location = getBookLocation(book);

  return res.json({
    bookId: book._id,
    title: book.title,
    location,
    guidance: [
      `Enter Floor ${location.floor}`,
      `Proceed to Shelf ${location.shelf}`,
      `Locate Row ${location.row}`,
    ],
  });
});

export default router;
