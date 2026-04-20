import test from "node:test";
import assert from "node:assert/strict";
import { buildBookMatchContext, normalizeModelText } from "../src/routes/ai.routes.js";

test("normalizeModelText unwraps structured AI payloads instead of returning object Object", () => {
  const value = {
    message: {
      content: [
        { text: "Machine learning overview" },
        { content: { summary: "Focus on neural networks and model evaluation." } },
      ],
    },
  };

  const normalized = normalizeModelText(value);

  assert.match(normalized, /Machine learning overview/);
  assert.match(normalized, /neural networks and model evaluation/i);
  assert.doesNotMatch(normalized, /\[object Object\]/);
});

test("buildBookMatchContext explains why a book fits the current query", () => {
  const book = {
    title: "Neural Networks for Beginners",
    author: "A. Kumar",
    category: "Computer Science",
    semanticTopics: ["machine learning", "neural networks", "deep learning"],
    tags: ["artificial intelligence"],
    courseCodes: ["CS-412"],
  };

  const match = buildBookMatchContext(book, "machine learning neural networks");

  assert.match(match.summary, /machine learning neural networks/i);
  assert.ok(match.matchedTerms.includes("machine learning") || match.matchedTerms.includes("neural networks"));
  assert.ok(match.matchedFields.includes("title") || match.matchedFields.includes("semantic topics"));
  assert.doesNotMatch(match.summary, /\[object Object\]/);
});
