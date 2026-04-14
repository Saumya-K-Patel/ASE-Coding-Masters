import express from "express";
import Loan from "../models/Loan.js";
import Book from "../models/Book.js";
import { authRequired } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";

const router = express.Router();

router.get("/forecast", authRequired, requireRole("librarian", "staff", "admin", "faculty"), async (req, res) => {
  const borrowFrequency = await Loan.aggregate([
    {
      $group: {
        _id: "$book",
        borrows: { $sum: 1 },
      },
    },
  ]);

  const books = await Book.find();

  const mapped = books.map((book) => {
    const freq = borrowFrequency.find((x) => x._id.toString() === book._id.toString())?.borrows || 0;
    const demandScore = Math.min(100, Math.round(freq * 10 + (book.examSeasonImpact === "Very High" ? 35 : book.examSeasonImpact === "High" ? 25 : 10)));
    const recommendation = demandScore > 85 && book.stock <= 2 ? "Restock Urgently" : demandScore > 70 && book.stock <= 3 ? "Consider Restock" : "Adequate";

    return {
      bookId: book._id,
      title: book.title,
      category: book.category,
      demandScore,
      examSeasonImpact: book.examSeasonImpact,
      stock: book.stock,
      totalCopies: book.totalCopies,
      recommendation,
    };
  });

  return res.json(mapped.sort((a, b) => b.demandScore - a.demandScore));
});

export default router;
