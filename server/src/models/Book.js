import mongoose from "mongoose";

const bookSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    author: { type: String, required: true },
    category: { type: String, required: true },
    isbn: { type: String, required: true },
    totalCopies: { type: Number, default: 1, min: 0 },
    stock: { type: Number, default: 1, min: 0 },
    location: {
      floor: { type: Number, default: 1 },
      shelf: { type: String, default: "GEN-01" },
      row: { type: Number, default: 1 },
    },
    demandScore: { type: Number, default: 0, min: 0, max: 100 },
    examSeasonImpact: {
      type: String,
      enum: ["Low", "Medium", "High", "Very High"],
      default: "Low",
    },
    tags: [{ type: String }],
    courseCodes: [{ type: String }],
    semanticTopics: [{ type: String }],
  },
  { timestamps: true }
);

const Book = mongoose.model("Book", bookSchema);
export default Book;
