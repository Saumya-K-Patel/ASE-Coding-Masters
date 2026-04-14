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

const researchProjectSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    topic: { type: String, required: true },
    researchQuestion: { type: String, default: "" },
    methodology: { type: String, default: "" },
    keywords: [{ type: String }],
    status: {
      type: String,
      enum: ["planning", "literature-review", "drafting", "completed"],
      default: "planning",
    },
    milestones: [milestoneSchema],
  },
  { timestamps: true }
);

const ResearchProject = mongoose.model("ResearchProject", researchProjectSchema);
export default ResearchProject;
