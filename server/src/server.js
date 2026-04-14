import dotenv from "dotenv";
import app from "./app.js";
import { connectDB } from "./config/db.js";
import { ensureDemoUsers } from "./utils/ensureDemoUsers.js";

dotenv.config();

const port = process.env.PORT || 5000;

async function bootstrap() {
  await connectDB();
  await ensureDemoUsers();
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

bootstrap().catch((error) => {
  console.error("Server startup failed", error);
  process.exit(1);
});
