import express from "express";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { authRequired, signAccessToken } from "../middleware/auth.js";

const router = express.Router();

router.post("/register", async (req, res) => {
  try {
    const { name, email, password, role = "student", department } = req.body;
    const exists = await User.findOne({ email });
    if (exists) {
      return res.status(409).json({ message: "Email already in use" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, passwordHash, role, department });
    const token = signAccessToken(user);
    return res.status(201).json({ token, user: { ...user.toObject(), passwordHash: undefined } });
  } catch (error) {
    return res.status(400).json({ message: "Registration failed", error: error.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = signAccessToken(user);
    return res.json({ token, user: { ...user.toObject(), passwordHash: undefined } });
  } catch (error) {
    return res.status(500).json({ message: "Login failed", error: error.message });
  }
});

router.get("/me", authRequired, async (req, res) => {
  return res.json({ user: req.user });
});

export default router;
