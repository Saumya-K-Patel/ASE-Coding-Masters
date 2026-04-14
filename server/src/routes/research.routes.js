import express from "express";
import ResearchProject from "../models/ResearchProject.js";
import { authRequired } from "../middleware/auth.js";

const router = express.Router();

const ALLOWED_STATUSES = new Set(["planning", "literature-review", "drafting", "completed"]);

function normalizeKeywords(input) {
  const values = Array.isArray(input)
    ? input
    : String(input || "")
      .split(",")
      .map((value) => value.trim());

  const seen = new Set();
  return values.filter((value) => {
    const normalized = String(value || "").trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeStatus(input) {
  return ALLOWED_STATUSES.has(input) ? input : "planning";
}

function sanitizeProjectPayload(body) {
  return {
    topic: String(body.topic || "").trim(),
    researchQuestion: String(body.researchQuestion || "").trim(),
    methodology: String(body.methodology || "").trim(),
    keywords: normalizeKeywords(body.keywords),
    status: normalizeStatus(body.status),
    milestones: Array.isArray(body.milestones) ? body.milestones : [],
  };
}

router.get("/", authRequired, async (req, res) => {
  const projects = await ResearchProject.find({ user: req.user._id }).sort({ updatedAt: -1, createdAt: -1 });
  return res.json(projects);
});

router.post("/", authRequired, async (req, res) => {
  try {
    const payload = sanitizeProjectPayload(req.body);
    const project = await ResearchProject.create({
      user: req.user._id,
      topic: payload.topic,
      researchQuestion: payload.researchQuestion,
      methodology: payload.methodology,
      keywords: payload.keywords,
      status: payload.status,
      milestones: payload.milestones,
    });
    return res.status(201).json(project);
  } catch (error) {
    return res.status(400).json({ message: "Could not create research project", error: error.message });
  }
});

router.put("/:id", authRequired, async (req, res) => {
  const payload = sanitizeProjectPayload({
    ...req.body,
    topic: req.body.topic ?? undefined,
    researchQuestion: req.body.researchQuestion ?? undefined,
    methodology: req.body.methodology ?? undefined,
    keywords: req.body.keywords ?? undefined,
    status: req.body.status ?? undefined,
    milestones: req.body.milestones,
  });

  const updates = {};
  if (req.body.topic !== undefined) updates.topic = payload.topic;
  if (req.body.researchQuestion !== undefined) updates.researchQuestion = payload.researchQuestion;
  if (req.body.methodology !== undefined) updates.methodology = payload.methodology;
  if (req.body.keywords !== undefined) updates.keywords = payload.keywords;
  if (req.body.status !== undefined) updates.status = payload.status;
  if (req.body.milestones !== undefined) updates.milestones = payload.milestones;

  const project = await ResearchProject.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    updates,
    { new: true }
  );

  if (!project) return res.status(404).json({ message: "Project not found" });
  return res.json(project);
});

export default router;
