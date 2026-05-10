import express from "express";
import ResearchProject from "../models/ResearchProject.js";
import { authRequired } from "../middleware/auth.js";

const router = express.Router();
const PROJECT_STATUS_ALIASES = {
  "literature-review": "reading",
  drafting: "writing",
};
const PROJECT_STATUSES = new Set(["planning", "sourcing", "reading", "writing", "revising", "completed"]);

function normalizeString(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function normalizeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeKeywords(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => normalizeString(item)).filter(Boolean))];
  }

  return [...new Set(
    normalizeString(value)
      .split(",")
      .map((item) => normalizeString(item))
      .filter(Boolean)
  )];
}

function normalizeProjectStatus(value, fallback = "planning") {
  const normalized = normalizeString(value, fallback).toLowerCase();
  const migrated = PROJECT_STATUS_ALIASES[normalized] || normalized;
  return PROJECT_STATUSES.has(migrated) ? migrated : "planning";
}

function normalizeTasks(tasks = [], fallbackTopic = "") {
  const normalized = Array.isArray(tasks)
    ? tasks
        .map((task) => ({
          title: normalizeString(task?.title),
          status: ["todo", "in_progress", "done"].includes(task?.status) ? task.status : "todo",
          dueDate: normalizeDate(task?.dueDate),
          notes: normalizeString(task?.notes),
        }))
        .filter((task) => task.title)
    : [];

  if (normalized.length) return normalized;

  const topic = normalizeString(fallbackTopic, "your topic");
  return [
    { title: `Refine research question for ${topic}`, status: "todo", dueDate: null, notes: "" },
    { title: "Collect and review core library sources", status: "todo", dueDate: null, notes: "" },
    { title: "Draft outline and evidence summary", status: "todo", dueDate: null, notes: "" },
  ];
}

function normalizeSourceBooks(sourceBooks = []) {
  if (!Array.isArray(sourceBooks)) return [];

  const seen = new Set();
  return sourceBooks
    .map((entry) => {
      const bookId = normalizeString(entry?.book?._id || entry?.book);
      return {
        book: bookId,
        status: ["saved", "reading", "cited"].includes(entry?.status) ? entry.status : "saved",
        notes: normalizeString(entry?.notes),
        addedAt: normalizeDate(entry?.addedAt) || new Date(),
      };
    })
    .filter((entry) => {
      if (!entry.book || seen.has(entry.book)) return false;
      seen.add(entry.book);
      return true;
    });
}

function milestoneToTaskStatus(progress) {
  const value = Number(progress) || 0;
  if (value >= 100) return "done";
  if (value > 0) return "in_progress";
  return "todo";
}

function serializeProject(project) {
  const plain = typeof project.toObject === "function" ? project.toObject({ virtuals: true }) : { ...project };
  const fallbackTasks = Array.isArray(plain.milestones)
    ? plain.milestones.map((milestone) => ({
        title: normalizeString(milestone?.milestone || milestone?.phase || "Research task"),
        status: milestoneToTaskStatus(milestone?.progress),
        dueDate: null,
        notes: normalizeString(milestone?.notes),
      }))
    : [];

  return {
    ...plain,
    status: normalizeProjectStatus(plain.status),
    keywords: normalizeKeywords(plain.keywords),
    tasks: Array.isArray(plain.tasks) && plain.tasks.length ? plain.tasks : fallbackTasks,
    sourceBooks: Array.isArray(plain.sourceBooks) ? plain.sourceBooks : [],
  };
}

function sanitizeProjectPayload(body, existingProject = null) {
  const topic = normalizeString(body.topic, existingProject?.topic);
  if (!topic) {
    throw new Error("Topic is required");
  }

  return {
    topic,
    researchQuestion: normalizeString(body.researchQuestion, existingProject?.researchQuestion),
    methodology: normalizeString(body.methodology, existingProject?.methodology),
    status: normalizeProjectStatus(body.status, existingProject?.status || "planning"),
    keywords: normalizeKeywords(body.keywords ?? existingProject?.keywords),
    notes: normalizeString(body.notes, existingProject?.notes),
    targetCompletionDate: normalizeDate(body.targetCompletionDate ?? existingProject?.targetCompletionDate),
    tasks: normalizeTasks(body.tasks ?? existingProject?.tasks, topic),
    sourceBooks: normalizeSourceBooks(body.sourceBooks ?? existingProject?.sourceBooks),
    milestones: Array.isArray(body.milestones ?? existingProject?.milestones)
      ? (body.milestones ?? existingProject?.milestones)
      : [],
  };
}

router.get("/", authRequired, async (req, res) => {
  const projects = await ResearchProject.find({ user: req.user._id })
    .populate("sourceBooks.book")
    .sort({ updatedAt: -1, createdAt: -1 });

  return res.json(projects.map(serializeProject));
});

router.post("/", authRequired, async (req, res) => {
  try {
    const payload = sanitizeProjectPayload(req.body);
    const project = await ResearchProject.create({
      user: req.user._id,
      ...payload,
    });
    const populatedProject = await ResearchProject.findById(project._id).populate("sourceBooks.book");
    return res.status(201).json(serializeProject(populatedProject));
  } catch (error) {
    return res.status(400).json({ message: "Could not create research project", error: error.message });
  }
});

router.put("/:id", authRequired, async (req, res) => {
  try {
    const existingProject = await ResearchProject.findOne({ _id: req.params.id, user: req.user._id });
    if (!existingProject) return res.status(404).json({ message: "Project not found" });

    const payload = sanitizeProjectPayload(req.body, existingProject);
    const project = await ResearchProject.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      payload,
      { new: true, runValidators: true }
    ).populate("sourceBooks.book");

    return res.json(serializeProject(project));
  } catch (error) {
    return res.status(400).json({ message: "Could not update research project", error: error.message });
  }
});

export default router;
