import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = sqliteTable("users", {
  id:        text("id").primaryKey(),                         // Discord user ID
  username:  text("username").notNull(),
  balance:   integer("balance").notNull().default(0),         // current balance
  deposited: integer("deposited").notNull().default(0),       // lifetime approved deposits
  withdrawn: integer("withdrawn").notNull().default(0),       // lifetime approved withdrawals
  wagered:   integer("wagered").notNull().default(0),         // lifetime amount bet
  profit:        integer("profit").notNull().default(0),           // lifetime net profit (can be negative)
  lockedBalance: integer("locked_balance").notNull().default(0),    // bonus gems (rain/codes/tips/welcome) that must be wagered ≥1.8× before withdrawal
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

export const betLogTable = sqliteTable("bet_log", {
  id:        integer("id").primaryKey({ autoIncrement: true }),
  userId:    text("user_id").notNull(),
  command:   text("command").notNull(),
  bet:       integer("bet").notNull(),
  netDelta:  integer("net_delta").notNull(),
  adminBet:  integer("admin_bet").notNull().default(0),  // 1 = admin test bet; excluded from stats/economy
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

/** Tracks server invite usage for the invite-reward system. */
export const inviteLogTable = sqliteTable("invite_log", {
  id:               integer("id").primaryKey({ autoIncrement: true }),
  inviterId:        text("inviter_id").notNull(),
  invitedId:        text("invited_id").notNull(),
  inviteCode:       text("invite_code").notNull(),
  verified:         integer("verified").notNull().default(0),        // 1 when they get the verified role
  rewarded:         integer("rewarded").notNull().default(0),        // 1 when inviter was paid
  leftServer:       integer("left_server").notNull().default(0),     // 1 if invited user left
  joinedAt:         integer("joined_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
  verifiedAt:       integer("verified_at"),                          // unix seconds, nullable
  accountCreatedAt: integer("account_created_at").notNull(),         // unix seconds of Discord account creation
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

export const insertGameSchema = createInsertSchema(gamesTable).omit({ createdAt: true, updatedAt: true });
export type InsertGame = z.infer<typeof insertGameSchema>;
export type Game = typeof gamesTable.$inferSelect;
