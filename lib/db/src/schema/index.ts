import { pgTable, text, bigint, jsonb, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: text("id").primaryKey(), // Discord user ID
  username: text("username").notNull(),
  balance: bigint("balance", { mode: "number" }).notNull().default(10_000_000), // starts at 10M gems
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const gamesTable = pgTable("games", {
  id: text("id").primaryKey(), // interaction ID or custom
  userId: text("user_id").notNull().references(() => usersTable.id),
  gameType: text("game_type").notNull(), // "mines" | "towers"
  bet: bigint("bet", { mode: "number" }).notNull(),
  state: jsonb("state").notNull(), // game-specific state JSON
  status: text("status").notNull().default("active"), // "active" | "won" | "lost" | "cashed"
  multiplier: text("multiplier").notNull().default("1.00"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

export const insertGameSchema = createInsertSchema(gamesTable).omit({ createdAt: true, updatedAt: true });
export type InsertGame = z.infer<typeof insertGameSchema>;
export type Game = typeof gamesTable.$inferSelect;
