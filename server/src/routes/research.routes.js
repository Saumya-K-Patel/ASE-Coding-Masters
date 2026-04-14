import express from "express";
import ResearchProject from "../models/ResearchProject.js";
import { authRequired } from "../middleware/auth.js";

const router = express.Router();

router.get("/", authRequired, async (req, res) => {
  const projects = await ResearchProject.find({ user: req.user._id }).sort({ createdAt: -1 });
  return res.json(projects);
});

router.post("/", authRequired, async (req, res) => {
  try {
    const project = await ResearchProject.create({
      user: req.user._id,
      topic: req.body.topic,
      milestones: req.body.milestones || [],
    });
    return res.status(201).json(project);
  } catch (error) {
    return res.status(400).json({ message: "Could not create research project", error: error.message });
  }
});

router.put("/:id", authRequired, async (req, res) => {
  const project = await ResearchProject.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    req.body,
    { new: true }
  );

  if (!project) return res.status(404).json({ message: "Project not found" });
  return res.json(project);
});

export default router;
