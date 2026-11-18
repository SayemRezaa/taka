import { createHash } from "node:crypto";
import type { EntryKind } from "@/db/schema";

/**
 * Shaping what tools hand back to a model, plus the two bits of logic worth
 * testing on their own: matching a category name and binding a confirmation
 * to the thing that was previewed.
 */

/**
 * Every tool answers the same way: a one-line summary a model can repeat to
 * the user without re-reading the data, then compact JSON for when it needs
 * the detail. Pretty-printing the JSON would only spend tokens on whitespace.
 */
export function reply(summary: string, payload: unknown) {
  return {
    content: [
      { type: "text" as const, text: `${summary}\n${JSON.stringify(payload)}` },
    ],
  };
}

export function fail(summary: string, payload: Record<string, unknown> = {}) {
  return {
    content: [
      {
        type: "text" as const,
        text: `${summary}\n${JSON.stringify({ ok: false, ...payload })}`,
      },
    ],
    isError: true as const,
  };
}

export type NamedDomain = { id: string; name: string; kind: EntryKind };

/**
 * Case-insensitive match of a category name, within one kind.
 *
 * Deliberately refuses to guess. A near miss returns suggestions and the tool
 * stops, because silently creating "Trnsport" alongside "Transport" splits a
 * year of history in two and nobody notices until the totals look wrong.
 */
export function matchDomain(
  domains: NamedDomain[],
  name: string,
  kind: EntryKind,
): { matched: NamedDomain } | { matched: null; suggestions: string[] } {
  const pool = domains.filter((d) => d.kind === kind);
  const needle = name.trim().toLowerCase();

  const exact = pool.find((d) => d.name.toLowerCase() === needle);
  if (exact) return { matched: exact };

  const scored = pool
    .map((d) => ({ d, score: similarity(d.name.toLowerCase(), needle) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((x) => x.d.name);

  return { matched: null, suggestions: scored.length ? scored : pool.map((d) => d.name).slice(0, 5) };
}

/** Crude but stable: substring hits beat shared prefixes beat shared letters. */
function similarity(candidate: string, needle: string): number {
  if (!needle) return 0;
  if (candidate.includes(needle) || needle.includes(candidate)) return 100;

  let prefix = 0;
  while (
    prefix < candidate.length &&
    prefix < needle.length &&
    candidate[prefix] === needle[prefix]
  ) {
    prefix++;
  }
  if (prefix >= 3) return 50 + prefix;

  const letters = new Set(needle.split(""));
  const shared = [...new Set(candidate.split(""))].filter((c) =>
    letters.has(c),
  ).length;
  return shared >= Math.max(3, needle.length / 2) ? shared : 0;
}

/**
 * Binds a confirmation to the exact change that was previewed.
 *
 * Without this, an assistant could preview one entry, then send `confirm:
 * true` with different arguments and destroy a row the user never saw. The
 * token is a hash of the id plus the proposed values, so changing any of them
 * invalidates it. No storage needed: the same inputs always hash the same.
 */
export function confirmToken(action: string, id: string, proposed: unknown): string {
  return createHash("sha256")
    .update(`${action}:${id}:${stableStringify(proposed)}`)
    .digest("hex")
    .slice(0, 12);
}

/** Key order must not change the hash, or a token would be unreproducible. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

/**
 * The duplicate guard's decision, separated from the lookup so it can be
 * tested without a database. Block when a same-day/same-category/same-amount
 * row exists and the caller has not explicitly said it is genuinely separate.
 */
export function isDuplicateBlocked(
  existing: unknown,
  force: boolean | undefined,
): boolean {
  return existing !== null && existing !== undefined && force !== true;
}
