import express from "express";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";

import authRoutes from "./routes/auth.routes.js";
import booksRoutes from "./routes/books.routes.js";
import loansRoutes from "./routes/loans.routes.js";
import finesRoutes from "./routes/fines.routes.js";
import alertsRoutes from "./routes/alerts.routes.js";
import analyticsRoutes from "./routes/analytics.routes.js";
import demandRoutes from "./routes/demand.routes.js";
import searchRoutes from "./routes/search.routes.js";
import researchRoutes from "./routes/research.routes.js";
import aiRoutes from "./routes/ai.routes.js";
import navigationRoutes from "./routes/navigation.routes.js";

dotenv.config();

const app = express();

const allowedOrigins = [
  process.env.CLIENT_ORIGIN,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Allow server-to-server calls and non-browser tools with no Origin header.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(morgan("dev"));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", name: "library-server" });
});

app.use("/api/auth", authRoutes);
app.use("/api/books", booksRoutes);
app.use("/api/loans", loansRoutes);
app.use("/api/fines", finesRoutes);
app.use("/api/alerts", alertsRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/demand", demandRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/research", researchRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/navigation", navigationRoutes);

app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: "Internal server error", error: err.message });
});

export default app;
