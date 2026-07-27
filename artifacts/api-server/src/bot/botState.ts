/**
 * botState.ts — Persistent bot admin state stored in the config table.
 * Covers: frozen users (blocked from gambling/withdrawing) and disabled games.
 */

import { sqlite } from "@workspace/db";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readConfig(key: string): string[] {
  try {
    const row = sqlite
      .prepare("SELECT value FROM config WHERE key = ?")
      .get(key) as { value: string } | undefined;
    if (!row) return [];
    return JSON.parse(row.value) as string[];
  } catch {
    return [];
  }
}

function writeConfig(key: string, values: string[]): void {
  sqlite
    .prepare(
      `INSERT INTO config (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, JSON.stringify(values));
}

// ─── Frozen users ─────────────────────────────────────────────────────────────

export function getFrozenUsers(): string[] {
  return readConfig("frozen_users");
}

export function isFrozen(userId: string): boolean {
  return getFrozenUsers().includes(userId);
}

export function freezeUser(userId: string): void {
  const current = getFrozenUsers();
  if (!current.includes(userId)) writeConfig("frozen_users", [...current, userId]);
}

export function unfreezeUser(userId: string): void {
  writeConfig("frozen_users", getFrozenUsers().filter((id) => id !== userId));
}

// ─── Disabled games ───────────────────────────────────────────────────────────

export function getDisabledGames(): string[] {
  return readConfig("disabled_games");
}

export function isGameDisabled(game: string): boolean {
  return getDisabledGames().includes(game);
}

export function disableGame(game: string): void {
  const current = getDisabledGames();
  if (!current.includes(game)) writeConfig("disabled_games", [...current, game]);
}

export function enableGame(game: string): void {
  writeConfig("disabled_games", getDisabledGames().filter((g) => g !== game));
}
