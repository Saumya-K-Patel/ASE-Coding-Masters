import express from "express";
import Loan from "../models/Loan.js";
import Book from "../models/Book.js";
import Subscription from "../models/Subscription.js";
import { authRequired } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { buildDemandForecast } from "../utils/demandForecast.js";
import { buildDemandCalibrationOperations } from "../utils/bookRecord.js";

const router = express.Router();

router.get("/forecast", authRequired, requireRole("librarian", "staff", "admin", "faculty"), async (req, res) => {
  const [books, loans, subscriptions] = await Promise.all([
    Book.find(),
    Loan.find({}, "book status requestDate createdAt borrowDate approvedAt returnedAt renewalRequestStatus returnRequestStatus"),
    Subscription.find({}, "book user createdAt"),
  ]);
  const demandCalibrationOperations = buildDemandCalibrationOperations(books);
  if (demandCalibrationOperations.length) {
    await Book.bulkWrite(demandCalibrationOperations);
  }

  return res.json(buildDemandForecast(books, loans, subscriptions));
});

export default router;
