import express from "express";
import Loan from "../models/Loan.js";
import Book from "../models/Book.js";
import User from "../models/User.js";
import Fine from "../models/Fine.js";
import Alert from "../models/Alert.js";
import Subscription from "../models/Subscription.js";
import { authRequired } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { getLoanPolicyByDemand } from "../utils/loanPolicy.js";
import { calculateReturnFineOutcome } from "../utils/loanFineProcessing.js";
import { resolveDueDate, resolveLoanPolicy, synchronizeApprovedLoanSchedule } from "../utils/loanSchedule.js";
import {
  getBorrowDemandDelta,
  getBookDemandScore,
  getBookStock,
  increaseBookDemandScore,
  serializeBook,
  setBookStock,
} from "../utils/bookRecord.js";

const router = express.Router();
const LOAN_MANAGER_ROLES = ["librarian", "staff", "admin"];

function canManageOtherUsers(role) {
  return LOAN_MANAGER_ROLES.includes(role);
}

function isLoanPending(loan) {
  return loan.status === "pending";
}

function isLoanRejected(loan) {
  return loan.status === "rejected";
}

function isLoanReturned(loan) {
  return loan.status === "returned" || Boolean(loan.returnedAt);
}

function isLoanApproved(loan) {
  return !isLoanPending(loan) && !isLoanRejected(loan) && !isLoanReturned(loan);
}

function serializeLoan(loan) {
  const plain = typeof loan.toObject === "function" ? loan.toObject({ virtuals: true }) : { ...loan };
  const resolvedDueDate = plain.dueDate || resolveDueDate(plain, plain.book);
  const policy = resolveLoanPolicy(plain, plain.book);
  const derivedStatus = plain.status
    || (plain.returnedAt ? "returned" : resolvedDueDate || plain.borrowDate ? "approved" : "pending");

  return {
    ...plain,
    status: derivedStatus,
    requestDate: plain.requestDate || plain.createdAt || plain.borrowDate || null,
    borrowDate: plain.borrowDate || plain.approvedAt || plain.requestDate || plain.createdAt || null,
    dueDate: resolvedDueDate || null,
    renewalRequestStatus: plain.renewalRequestStatus || "none",
    returnRequestStatus: plain.returnRequestStatus || "none",
    returnRejectionReason: plain.returnRejectionReason || "",
    borrowPolicyDays: policy.loanDays,
    maxRenewals: policy.maxRenewals,
    overdueDailyRate: policy.overdueDailyRate,
    policyTier: policy.tier,
    policy,
    book: serializeBook(plain.book),
  };
}

async function persistBookAvailability(book, nextStock) {
  setBookStock(book, nextStock);
  await Book.updateOne(
    { _id: book._id },
    {
      $set: {
        demandScore: getBookDemandScore(book),
        demandVersion: Number(book.demandVersion) || 2,
        stock: book.stock,
        totalCopies: book.totalCopies,
        location: book.location,
        availableCopies: book.stock,
        floor: String(book.location?.floor ?? 1),
        shelfCode: book.location?.shelf ?? "GEN-01",
        row: String(book.location?.row ?? 1),
      },
    },
    { runValidators: false, strict: false }
  );
}

async function findLoanForUser(id) {
  const loan = await Loan.findById(id).populate("book").populate("user");
  if (!loan || !isLoanApproved(loan)) return loan;

  const { changed } = synchronizeApprovedLoanSchedule(loan, loan.book);
  if (changed) await loan.save();
  return loan;
}

function buildUnresolvedLoanQuery(userId, bookId) {
  return {
    user: userId,
    book: bookId,
    $or: [
      { status: "pending" },
      { status: "approved", returnedAt: null },
      { status: { $exists: false }, returnedAt: null },
    ],
  };
}

function buildActiveLoanQuery(extra = {}) {
  return {
    returnedAt: null,
    $or: [{ status: "approved" }, { status: { $exists: false } }],
    ...extra,
  };
}

router.get("/", authRequired, async (req, res) => {
  const query = req.user.role === "student" || req.user.role === "faculty" ? { user: req.user._id } : {};
  const loans = await Loan.find(query)
    .populate("book")
    .populate("user", "name email role finesOutstanding isBlocked")
    .sort({ createdAt: -1 });

  await Promise.all(loans.map(async (loan) => {
    if (!isLoanApproved(loan)) return;
    const { changed } = synchronizeApprovedLoanSchedule(loan, loan.book);
    if (changed) await loan.save();
  }));

  return res.json(loans.map(serializeLoan));
});

async function createReservation(req, res) {
  try {
    const { bookId } = req.body;
    if (!bookId) return res.status(400).json({ message: "bookId is required" });

    const [user, book] = await Promise.all([
      User.findById(req.user._id),
      Book.findById(bookId),
    ]);

    if (!user || !book) return res.status(404).json({ message: "User or book not found" });
    if (user.isBlocked || user.finesOutstanding > 0) {
      return res.status(400).json({ message: "Reservation blocked until outstanding fines are cleared." });
    }

    const existingLoan = await Loan.findOne(buildUnresolvedLoanQuery(req.user._id, bookId));
    if (existingLoan) {
      return res.status(400).json({ message: "You already have a pending or active request for this book." });
    }

    const policy = getLoanPolicyByDemand(getBookDemandScore(book));
    const reservation = await Loan.create({
      user: req.user._id,
      book: bookId,
      status: "pending",
      requestDate: new Date(),
      borrowDate: null,
      dueDate: null,
      maxRenewals: policy.maxRenewals,
      borrowPolicyDays: policy.loanDays,
      overdueDailyRate: policy.overdueDailyRate,
      policyTier: policy.tier,
    });

    await Alert.create([
      {
        type: "reservation",
        message: `${user.name} requested "${book.title}". Review the reservation queue for approval.`,
        recipient: null,
      },
      {
        type: "system",
        message: `Reservation submitted for "${book.title}". An admin will review and approve or reject it.`,
        recipient: req.user._id,
      },
    ]);

    const hydratedReservation = await Loan.findById(reservation._id)
      .populate("book")
      .populate("user", "name email role");

    return res.status(201).json(serializeLoan(hydratedReservation));
  } catch (error) {
    return res.status(400).json({ message: "Reservation failed", error: error.message });
  }
}

router.post("/reserve", authRequired, createReservation);
router.post("/borrow", authRequired, createReservation);

router.post("/:id/approve", authRequired, requireRole(...LOAN_MANAGER_ROLES), async (req, res) => {
  try {
    const loan = await findLoanForUser(req.params.id);
    if (!loan) return res.status(404).json({ message: "Reservation not found" });
    if (!isLoanPending(loan)) return res.status(400).json({ message: "Only pending reservations can be approved." });

    if (loan.user?.isBlocked || loan.user?.finesOutstanding > 0) {
      return res.status(400).json({ message: "This user cannot borrow until fines are cleared." });
    }

    const stock = getBookStock(loan.book);
    if (stock <= 0) {
      return res.status(400).json({ message: "Cannot approve because the book is currently out of stock." });
    }

    const policy = getLoanPolicyByDemand(getBookDemandScore(loan.book));
    const loanDays = policy.loanDays;
    const borrowDate = new Date();
    const dueDate = new Date(borrowDate.getTime() + loanDays * 24 * 60 * 60 * 1000);

    loan.status = "approved";
    loan.borrowDate = borrowDate;
    loan.dueDate = dueDate;
    loan.approvedAt = borrowDate;
    loan.approvedBy = req.user._id;
    loan.reservationDecisionAt = borrowDate;
    loan.reservationDecisionBy = req.user._id;
    loan.rejectionReason = "";
    loan.borrowPolicyDays = loanDays;
    loan.maxRenewals = policy.maxRenewals;
    loan.overdueDailyRate = policy.overdueDailyRate;
    loan.policyTier = policy.tier;
    await loan.save();

    const nextStock = stock - 1;
    increaseBookDemandScore(loan.book, getBorrowDemandDelta(loan.book, nextStock));
    await persistBookAvailability(loan.book, nextStock);

    await Alert.create({
      type: "reservation",
      message: `Your reservation for "${loan.book.title}" was approved. Due on ${dueDate.toISOString().slice(0, 10)}.`,
      recipient: loan.user._id,
    });

    const hydratedLoan = await Loan.findById(loan._id)
      .populate("book")
      .populate("user", "name email role finesOutstanding isBlocked");

    return res.json(serializeLoan(hydratedLoan));
  } catch (error) {
    return res.status(400).json({ message: "Approval failed", error: error.message });
  }
});

router.post("/:id/reject", authRequired, requireRole(...LOAN_MANAGER_ROLES), async (req, res) => {
  try {
    const loan = await findLoanForUser(req.params.id);
    if (!loan) return res.status(404).json({ message: "Reservation not found" });
    if (!isLoanPending(loan)) return res.status(400).json({ message: "Only pending reservations can be rejected." });

    const reason = String(req.body.reason || "").trim() || "Reservation was not approved by the admin.";
    loan.status = "rejected";
    loan.rejectionReason = reason;
    loan.reservationDecisionAt = new Date();
    loan.reservationDecisionBy = req.user._id;
    loan.approvedAt = null;
    loan.approvedBy = null;
    loan.borrowDate = null;
    loan.dueDate = null;
    await loan.save();

    await Alert.create({
      type: "reservation",
      message: `Your reservation for "${loan.book.title}" was rejected. Reason: ${reason}`,
      recipient: loan.user._id,
    });

    return res.json(serializeLoan(loan));
  } catch (error) {
    return res.status(400).json({ message: "Rejection failed", error: error.message });
  }
});

router.post("/:id/renew", authRequired, async (req, res) => {
  try {
    const loan = await findLoanForUser(req.params.id);
    if (!loan) return res.status(404).json({ message: "Loan not found" });

    const ownLoan = loan.user._id.toString() === req.user._id.toString();
    const elevated = canManageOtherUsers(req.user.role);
    if (!ownLoan && !elevated) return res.status(403).json({ message: "Forbidden" });

    if (!isLoanApproved(loan)) return res.status(400).json({ message: "Only approved active loans can be renewed." });
    const loanPolicy = resolveLoanPolicy(loan, loan.book);
    if (loan.renewalCount >= loanPolicy.maxRenewals) {
      return res.status(400).json({ message: "Maximum renewals reached for this demand level" });
    }
    if (loan.user.isBlocked || loan.user.finesOutstanding > 0) {
      return res.status(400).json({ message: "Cannot renew while fines are outstanding or account is blocked." });
    }
    if (!loan.dueDate) return res.status(400).json({ message: "Due date is missing for this loan." });

    const now = new Date();
    if (now > new Date(loan.dueDate)) {
      return res.status(400).json({ message: "Overdue loans must be returned before they can be borrowed again." });
    }

    if (loan.renewalRequestStatus === "pending") {
      return res.status(400).json({ message: "A renewal request is already waiting for admin approval." });
    }

    loan.renewalRequestStatus = "pending";
    loan.renewalRequestedAt = now;
    loan.renewalDecisionAt = null;
    loan.renewalDecisionBy = null;
    loan.renewalRejectionReason = "";
    await loan.save();

    await Alert.create([
      {
        type: "renewal",
        message: `Renewal request submitted for "${loan.book?.title || "book"}". An admin will review it.`,
        recipient: loan.user._id,
      },
      {
        type: "renewal",
        message: `${loan.user?.name || "A user"} requested a renewal for "${loan.book?.title || "book"}".`,
        recipient: null,
      },
    ]);

    return res.json(serializeLoan(loan));
  } catch (error) {
    return res.status(400).json({ message: "Renew request failed", error: error.message });
  }
});

router.post("/:id/renew/approve", authRequired, requireRole(...LOAN_MANAGER_ROLES), async (req, res) => {
  try {
    const loan = await findLoanForUser(req.params.id);
    if (!loan) return res.status(404).json({ message: "Loan not found" });
    if (!isLoanApproved(loan)) return res.status(400).json({ message: "Only approved active loans can be renewed." });
    if (loan.renewalRequestStatus !== "pending") {
      return res.status(400).json({ message: "There is no pending renewal request for this loan." });
    }

    const renewalPolicy = getLoanPolicyByDemand(getBookDemandScore(loan.book));
    if (loan.renewalCount >= renewalPolicy.maxRenewals) {
      return res.status(400).json({ message: "Demand for this book no longer allows another renewal." });
    }

    const extensionDays = renewalPolicy.loanDays;
    loan.renewalCount += 1;
    loan.dueDate = new Date(new Date(loan.dueDate).getTime() + extensionDays * 24 * 60 * 60 * 1000);
    loan.borrowPolicyDays = renewalPolicy.loanDays;
    loan.maxRenewals = renewalPolicy.maxRenewals;
    loan.overdueDailyRate = renewalPolicy.overdueDailyRate;
    loan.policyTier = renewalPolicy.tier;
    loan.renewalRequestStatus = "none";
    loan.renewalDecisionAt = new Date();
    loan.renewalDecisionBy = req.user._id;
    loan.renewalRequestedAt = null;
    loan.renewalRejectionReason = "";
    await loan.save();

    await Alert.create({
      type: "renewal",
      message: `Your renewal for "${loan.book?.title || "book"}" was approved. New due date: ${loan.dueDate.toISOString().slice(0, 10)}.`,
      recipient: loan.user._id,
    });

    return res.json(serializeLoan(loan));
  } catch (error) {
    return res.status(400).json({ message: "Renew approval failed", error: error.message });
  }
});

router.post("/:id/renew/reject", authRequired, requireRole(...LOAN_MANAGER_ROLES), async (req, res) => {
  try {
    const loan = await findLoanForUser(req.params.id);
    if (!loan) return res.status(404).json({ message: "Loan not found" });
    if (loan.renewalRequestStatus !== "pending") {
      return res.status(400).json({ message: "There is no pending renewal request for this loan." });
    }

    const reason = String(req.body.reason || "").trim() || "Renewal request was not approved.";
    loan.renewalRequestStatus = "rejected";
    loan.renewalDecisionAt = new Date();
    loan.renewalDecisionBy = req.user._id;
    loan.renewalRequestedAt = null;
    loan.renewalRejectionReason = reason;
    await loan.save();

    await Alert.create({
      type: "renewal",
      message: `Your renewal request for "${loan.book?.title || "book"}" was rejected. Reason: ${reason}`,
      recipient: loan.user._id,
    });

    return res.json(serializeLoan(loan));
  } catch (error) {
    return res.status(400).json({ message: "Renew rejection failed", error: error.message });
  }
});

router.post("/:id/return", authRequired, async (req, res) => {
  try {
    const loan = await findLoanForUser(req.params.id);
    if (!loan) return res.status(404).json({ message: "Loan not found" });
    if (isLoanReturned(loan)) return res.status(400).json({ message: "Already returned" });

    const ownLoan = loan.user._id.toString() === req.user._id.toString();
    const canProcessReturn = canManageOtherUsers(req.user.role);
    if (!ownLoan && !canProcessReturn) return res.status(403).json({ message: "Forbidden" });
    if (!isLoanApproved(loan)) return res.status(400).json({ message: "Only approved loans can be returned." });

    if (!canProcessReturn) {
      if (loan.returnRequestStatus === "pending") {
        return res.status(400).json({ message: "A return request is already waiting for admin processing." });
      }

      loan.returnRequestStatus = "pending";
      loan.returnRequestedAt = new Date();
      loan.returnDecisionAt = null;
      loan.returnDecisionBy = null;
      loan.returnRejectionReason = "";
      await loan.save();

      await Alert.create([
        {
          type: "return",
          message: `Return request submitted for "${loan.book?.title || "book"}". An admin will process it.`,
          recipient: loan.user._id,
        },
        {
          type: "return",
          message: `${loan.user?.name || "A user"} requested to return "${loan.book?.title || "book"}".`,
          recipient: null,
        },
      ]);

      return res.json(serializeLoan(loan));
    }

    if (loan.returnRequestStatus !== "pending") {
      return res.status(400).json({ message: "Only admin can process returns after a user submits a return request." });
    }

    const returnedAt = new Date();
    loan.returnedAt = returnedAt;
    loan.status = "returned";
    loan.returnRequestStatus = "none";
    loan.returnRequestedAt = null;
    loan.returnDecisionAt = returnedAt;
    loan.returnDecisionBy = req.user._id;
    loan.returnRejectionReason = "";
    loan.renewalRequestStatus = "none";
    await loan.save();

    await persistBookAvailability(loan.book, getBookStock(loan.book) + 1);

    const effectiveDueDate = loan.dueDate || resolveDueDate(loan, loan.book);
    const fineOutcome = calculateReturnFineOutcome({
      dueDate: effectiveDueDate,
      returnedAt,
      currentOutstanding: loan.user?.finesOutstanding,
      dailyRate: loan.overdueDailyRate,
      demandScore: getBookDemandScore(loan.book),
    });
    const { dailyRate, fineAmount } = fineOutcome;
    let updatedUser = null;

    if (fineOutcome.shouldCreateFine) {
      await Fine.create({
        user: loan.user._id,
        loan: loan._id,
        amount: fineAmount,
        reason: `Overdue return (${loan.policyTier || "standard"} demand at $${dailyRate.toFixed(2)}/day)`,
      });

      updatedUser = await User.findById(loan.user._id);
      updatedUser.finesOutstanding = fineOutcome.nextOutstanding;
      updatedUser.isBlocked = fineOutcome.isBlocked;
      await updatedUser.save();

      await Alert.create([
        {
          type: "overdue",
          message: `A fine of $${fineAmount.toFixed(2)} was added for overdue return of "${loan.book.title}" at $${dailyRate.toFixed(2)} per overdue day.`,
          recipient: loan.user._id,
        },
        {
          type: "fine",
          message: `${loan.user?.name || "A borrower"} now has a $${fineAmount.toFixed(2)} overdue fine for "${loan.book.title}" at $${dailyRate.toFixed(2)} per day. Outstanding balance: $${fineOutcome.nextOutstanding.toFixed(2)}.`,
          recipient: null,
        },
      ]);
    } else {
      await Alert.create({
        type: "return",
        message: `Your return for "${loan.book.title}" was processed by the admin. Thank you for returning it on time.`,
        recipient: loan.user._id,
      });
    }

    if (getBookStock(loan.book) > 0) {
      const subscriptions = await Subscription.find({ book: loan.book._id });
      if (subscriptions.length) {
        await Alert.insertMany(
          subscriptions.map((sub) => ({
            type: "stock",
            message: `${loan.book.title} is back in stock`,
            recipient: sub.user,
          }))
        );
        await Subscription.deleteMany({ book: loan.book._id });
      }
    }

    return res.json({ loan: serializeLoan(loan), fineAmount, user: updatedUser });
  } catch (error) {
    return res.status(400).json({ message: "Return failed", error: error.message });
  }
});

router.post("/:id/return/reject", authRequired, requireRole(...LOAN_MANAGER_ROLES), async (req, res) => {
  try {
    const loan = await findLoanForUser(req.params.id);
    if (!loan) return res.status(404).json({ message: "Loan not found" });
    if (!isLoanApproved(loan)) return res.status(400).json({ message: "Only approved loans can receive a return decision." });
    if (loan.returnRequestStatus !== "pending") {
      return res.status(400).json({ message: "There is no pending return request for this loan." });
    }

    const reason = String(req.body.reason || "").trim() || "Return request needs more review before processing.";
    loan.returnRequestStatus = "rejected";
    loan.returnDecisionAt = new Date();
    loan.returnDecisionBy = req.user._id;
    loan.returnRejectionReason = reason;
    await loan.save();

    await Alert.create({
      type: "return",
      message: `Your return request for "${loan.book?.title || "book"}" was rejected. Reason: ${reason}`,
      recipient: loan.user._id,
    });

    return res.json(serializeLoan(loan));
  } catch (error) {
    return res.status(400).json({ message: "Return rejection failed", error: error.message });
  }
});

router.get("/reminders/simulate", authRequired, requireRole(...LOAN_MANAGER_ROLES), async (req, res) => {
  const activeLoans = await Loan.find(buildActiveLoanQuery())
    .populate("user", "name email")
    .populate("book", "title");
  await Promise.all(activeLoans.map(async (loan) => {
    const { changed } = synchronizeApprovedLoanSchedule(loan, loan.book);
    if (changed) await loan.save();
  }));
  const now = new Date();

  const reminders = activeLoans
    .map((loan) => {
      const total = loan.borrowPolicyDays;
      const elapsed = Math.floor((now - loan.borrowDate) / (1000 * 60 * 60 * 24));
      const completion = total > 0 ? (elapsed / total) * 100 : 0;
      return { loan, completion };
    })
    .filter((x) => x.completion >= 60)
    .map((x) => ({
      loanId: x.loan._id,
      recipient: x.loan.user,
      bookTitle: x.loan.book.title,
      dueDate: x.loan.dueDate,
      stage: x.completion >= 100 ? "100%" : "60%",
    }));

  return res.json(reminders);
});

export default router;
