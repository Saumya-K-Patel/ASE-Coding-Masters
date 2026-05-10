import test from "node:test";
import assert from "node:assert/strict";
import { rankBooksByQuery } from "../src/utils/librarySearch.js";

const books = [
  {
    _id: "1",
    title: "Deep Learning",
    author: "Ian Goodfellow",
    category: "Computer Science",
    stock: 3,
    semanticTopics: ["machine learning", "artificial intelligence", "neural networks"],
    tags: ["ai", "ml"],
    courseCodes: ["CS-440"],
  },
  {
    _id: "2",
    title: "Digital Libraries and Information Retrieval",
    author: "Karen Holt",
    category: "Information Science",
    stock: 2,
    semanticTopics: ["information retrieval", "semantic search", "digital libraries"],
    tags: ["library science", "search"],
    courseCodes: ["IS-310"],
  },
  {
    _id: "3",
    title: "Urban Poverty and Social Policy",
    author: "M. Rivera",
    category: "Economics",
    stock: 4,
    semanticTopics: ["urban poverty", "social policy", "income inequality", "development economics"],
    tags: ["economics", "policy"],
    courseCodes: ["EC-420"],
  },
  {
    _id: "4",
    title: "Cybersecurity Essentials",
    author: "R. Singh",
    category: "Computer Science",
    stock: 5,
    semanticTopics: ["cybersecurity", "information security", "cryptography"],
    tags: ["security", "networks"],
    courseCodes: ["CS-455"],
  },
  {
    _id: "5",
    title: "Public Health and Epidemiology",
    author: "Laura Chen",
    category: "Health Sciences",
    stock: 2,
    semanticTopics: ["public health", "epidemiology", "mental health"],
    tags: ["health", "wellbeing"],
    courseCodes: ["HS-210"],
  },
  {
    _id: "6",
    title: "Introduction to Algorithms",
    author: "Thomas Cormen",
    category: "Computer Science",
    stock: 1,
    semanticTopics: ["algorithms", "data structures", "complexity"],
    tags: ["cs", "programming"],
    courseCodes: ["CS-220"],
  },
];

test("machine learning query ranks deep learning first", () => {
  const ranked = rankBooksByQuery("machine learning", books, { limit: 3 });
  assert.equal(ranked[0]?.book.title, "Deep Learning");
  assert.match(ranked[0]?.relevance.summary || "", /machine learning/i);
});

test("urban poverty query prefers poverty-related policy and methods books", () => {
  const ranked = rankBooksByQuery("urban poverty", books, { limit: 3 });
  assert.equal(ranked[0]?.book.title, "Urban Poverty and Social Policy");
  assert.ok(ranked.every((entry) => entry.book.title !== "Deep Learning"));
});

test("cybersecurity query surfaces cybersecurity essentials ahead of generic cs books", () => {
  const ranked = rankBooksByQuery("cybersecurity", books, { limit: 3 });
  assert.equal(ranked[0]?.book.title, "Cybersecurity Essentials");
  assert.ok((ranked[0]?.score || 0) > (ranked[1]?.score || 0));
});

test("digital libraries query finds the information retrieval title", () => {
  const ranked = rankBooksByQuery("digital libraries", books, { limit: 3 });
  assert.equal(ranked[0]?.book.title, "Digital Libraries and Information Retrieval");
});

test("no close query does not invent random books", () => {
  const ranked = rankBooksByQuery("mesopotamian pottery glaze typology", books, { limit: 4, minScore: 0.12 });
  assert.equal(ranked.length, 0);
});
