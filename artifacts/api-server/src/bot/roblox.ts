import { randomBytes } from "node:crypto";

const ROBLOX_API_TIMEOUT_MS = 8_000;

export interface RobloxUser {
  id: string;
  name: string;
  displayName?: string;
}

export interface RobloxProfile extends RobloxUser {
  description: string;
}

export class RobloxApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "RobloxApiError";
  }
}

async function fetchJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(ROBLOX_API_TIMEOUT_MS),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  } catch {
    throw new RobloxApiError("Roblox is temporarily unreachable.");
  }

  if (!response.ok) {
    throw new RobloxApiError(
      response.status === 429
        ? "Roblox is rate-limiting requests. Please try again shortly."
        : "Roblox could not process the verification request.",
      response.status,
    );
  }

  try {
    return await response.json() as T;
  } catch {
    throw new RobloxApiError("Roblox returned an invalid response.");
  }
}

export async function findRobloxUser(username: string): Promise<RobloxUser | null> {
  const body = await fetchJson<{
    data?: Array<{ id: number; name: string; displayName?: string }>;
  }>("https://users.roblox.com/v1/usernames/users", {
    method: "POST",
    body: JSON.stringify({
      usernames: [username],
      excludeBannedUsers: false,
    }),
  });

  const match = body.data?.[0];
  return match
    ? {
        id: String(match.id),
        name: match.name,
        displayName: match.displayName,
      }
    : null;
}

export async function getRobloxProfile(userId: string): Promise<RobloxProfile> {
  const profile = await fetchJson<{
    id: number;
    name: string;
    displayName?: string;
    description?: string;
  }>(`https://users.roblox.com/v1/users/${encodeURIComponent(userId)}`);

  return {
    id: String(profile.id),
    name: profile.name,
    displayName: profile.displayName,
    description: profile.description ?? "",
  };
}

export function createVerificationPhrase(): string {
  return `VERIFY-${randomBytes(4).toString("hex").toUpperCase()}`;
}