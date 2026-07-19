import { defineConfig } from "drizzle-kit";
import path from "path";

const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), "bot.db");

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "sqlite",
  dbCredentials: {
    url: DB_PATH,
  },
});
