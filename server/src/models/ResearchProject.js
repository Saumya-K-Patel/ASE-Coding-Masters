import mongoose from "mongoose";

const milestoneSchema = new mongoose.Schema(
  {
    phase: { type: String, required: true },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    milestone: { type: String, required: true },
    notes: { type: String, default: "" },
  },
  { _id: false }
);

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    status: {
      type: String,
      enum: ["todo", "in_progress", "done"],
      default: "todo",
    },
    dueDate: { type: Date, default: null },
    notes: { type: String, default: "" },
  },
  { _id: false }
);

const sourceBookSchema = new mongoose.Schema(
  {
    book: { type: mongoose.Schema.Types.ObjectId, ref: "Book", required: true },
    status: {
      type: String,
      enum: ["saved", "reading", "cited"],
      default: "saved",
    },
    notes: { type: String, default: "" },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const researchProjectSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    topic: { type: String, required: true },
    researchQuestion: { type: String, default: "" },
    methodology: { type: String, default: "" },
    status: {
      type: String,
      enum: [
        "planning",
        "sourcing",
        "reading",
        "writing",
        "revising",
        "completed",
        "literature-review",
        "drafting",
      ],
      default: "planning",
    },
    keywords: [{ type: String }],
    notes: { type: String, default: "" },
    targetCompletionDate: { type: Date, default: null },
    tasks: [taskSchema],
    sourceBooks: [sourceBookSchema],
    milestones: [milestoneSchema],
  },
  { timestamps: true }
);

const ResearchProject = mongoose.model("ResearchProject", researchProjectSchema);
export default ResearchProject;
