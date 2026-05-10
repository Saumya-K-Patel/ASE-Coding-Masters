// Analytics dashboard — polished with extended metrics
import express from "express";
import Loan from "../models/Loan.js";
import Book from "../models/Book.js";
import User from "../models/User.js";
import Fine from "../models/Fine.js";
import { authRequired } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";

const router = express.Router();

router.get("/dashboard", authRequired, requireRole("librarian", "staff", "admin", "faculty"), async (req, res) => {
  const [totalBooks, activeLoans, users, topBooks, pendingFineRecords] = await Promise.all([
    Book.countDocuments(),
    Loan.countDocuments({ returnedAt: null }),
    User.find({}, "role isBlocked finesOutstanding").lean(),
    Loan.aggregate([
      { $group: { _id: "$book", borrows: { $sum: 1 } } },
      { $sort: { borrows: -1 } },
      { $limit: 5 },
    ]),
    Fine.countDocuments({ status: "pending" }),
  ]);

  const userSegments = users.reduce(
    (acc, u) => {
      const key = ["student", "faculty"].includes(u.role) ? u.role : "adminAndStaff";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    },
    { student: 0, faculty: 0, adminAndStaff: 0 }
  );

  const blockedUsers = users.filter((user) => ["student", "faculty"].includes(user.role) && user.isBlocked).length;
  const totalOutstandingFines = Number(
    users
      .filter((user) => ["student", "faculty"].includes(user.role))
      .reduce((sum, user) => sum + Number(user.finesOutstanding || 0), 0)
      .toFixed(2)
  );

  return res.json({
    totals: { totalBooks, activeLoans, totalUsers: users.length },
    userSegments,
    topBooks,
    fines: {
      blockedUsers,
      pendingRecords: pendingFineRecords,
      totalOutstanding: totalOutstandingFines,
    },
  });
});

export default router;
