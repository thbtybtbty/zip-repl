import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = sqliteTable("users", {
  id:        text("id").primaryKey(),                         // Discord user ID
  username:  text("username").notNull(),
  balance:   integer("balance").notNull().default(0),         // starts at 0 gems
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const gamesTable = sqliteTable("games", {
  id:         text("id").primaryKey(),
  userId:     text("user_id").notNull().references(() => usersTable.id),
  gameType:   text("game_type").notNull(),                    // "mines" | "towers"
  bet:        integer("bet").notNull(),
  state:      text("state", { mode: "json" }).notNull().$type<Record<string, unknown>>().default({}),
  status:     text("status").notNull().default("active"),     // "active" | "won" | "lost" | "cashed"
  multiplier: text("multiplier").notNull().default("1.00"),
  createdAt:  integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt:  integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

/** Key/value store for bot config (e.g. server setup). */
export const configTable = sqliteTable("config", {
  key:   text("key").primaryKey(),
  value: text("value").notNull(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

export const insertGameSchema = createInsertSchema(gamesTable).omit({ createdAt: true, updatedAt: true });
export type InsertGame = z.infer<typeof insertGameSchema>;
export type Game = typeof gamesTable.$inferSelect;
