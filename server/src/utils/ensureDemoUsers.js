import bcrypt from "bcryptjs";
import User from "../models/User.js";

const DEMO_USERS = [
  {
    name: "Library Admin",
    email: "admin@uni.edu",
    password: "password123",
    role: "admin",
    department: "Library Operations",
  },
  {
    name: "Aisha Rahman",
    email: "aisha@uni.edu",
    password: "password123",
    role: "student",
    department: "Computer Science",
  },
];

export async function ensureDemoUsers() {
  for (const demoUser of DEMO_USERS) {
    const existing = await User.findOne({ email: demoUser.email });
    if (existing) continue;

    const passwordHash = await bcrypt.hash(demoUser.password, 10);
    await User.create({
      name: demoUser.name,
      email: demoUser.email,
      passwordHash,
      role: demoUser.role,
      department: demoUser.department,
    });
  }
}
