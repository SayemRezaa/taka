import { and, eq } from "drizzle-orm";
import { db } from "./index";
import { domains, entries, type EntryKind } from "./schema";

/**
 * Writes, with userId as the first argument — the same contract as
 * db/queries.ts.
 *
 * These exist separately from `app/ledger/actions.ts` because there are now
 * two front doors: server actions, where the user comes from a session
 * cookie, and the MCP route, where the user comes from a verified bearer
 * token. Both need identical ownership checks, and a duplicated ownership
 * check is the kind of thing that rots until one copy is wrong. The actions
 * are thin wrappers over these.
 *
 * Nothing here reads a session. The caller proves who the user is and passes
 * the id; these functions only guarantee that a user can touch nothing but
 * their own rows.
 */

export type MutationResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

export type EntryInput = {
  amountMinor: number;
  domainId: string;
  occurredOn: string;
  kind: EntryKind;
  method?: string | null;
  note?: string | null;
  earmark?: string | null;
};

export async function createEntry(
  userId: string,
  input: EntryInput,
): Promise<MutationResult<{ id: string }>> {
  // The domain must belong to THIS user. Without this check, a crafted
  // request could attach an entry to someone else's category.
  const [domain] = await db
    .select({ id: domains.id, kind: domains.kind })
    .from(domains)
    .where(and(eq(domains.id, input.domainId), eq(domains.userId, userId)))
    .limit(1);

  if (!domain) return { ok: false, error: "That domain doesn't exist." };
  if (domain.kind !== input.kind) {
    return { ok: false, error: "That domain is for a different kind of entry." };
  }

  const [row] = await db
    .insert(entries)
    .values({
      userId,
      domainId: input.domainId,
      occurredOn: input.occurredOn,
      amountMinor: input.amountMinor,
      kind: input.kind,
      method: input.method ?? null,
      note: input.note ?? null,
      earmark: input.earmark ?? null,
    })
    .returning({ id: entries.id });

  return { ok: true, id: row.id };
}

export async function editEntry(
  userId: string,
  id: string,
  input: EntryInput,
): Promise<MutationResult> {
  const [domain] = await db
    .select({ id: domains.id, kind: domains.kind })
    .from(domains)
    .where(and(eq(domains.id, input.domainId), eq(domains.userId, userId)))
    .limit(1);
  if (!domain) return { ok: false, error: "That domain doesn't exist." };
  if (domain.kind !== input.kind) {
    return { ok: false, error: "That domain is for a different kind of entry." };
  }

  // The userId in the WHERE clause is what makes this safe: an id belonging
  // to someone else simply matches zero rows.
  const updated = await db
    .update(entries)
    .set({
      domainId: input.domainId,
      occurredOn: input.occurredOn,
      amountMinor: input.amountMinor,
      kind: input.kind,
      method: input.method ?? null,
      note: input.note ?? null,
      earmark: input.earmark ?? null,
    })
    .where(and(eq(entries.id, id), eq(entries.userId, userId)))
    .returning({ id: entries.id });

  if (!updated.length) return { ok: false, error: "Entry not found." };
  return { ok: true };
}

export async function removeEntry(
  userId: string,
  id: string,
): Promise<MutationResult> {
  const removed = await db
    .delete(entries)
    .where(and(eq(entries.id, id), eq(entries.userId, userId)))
    .returning({ id: entries.id });

  if (!removed.length) return { ok: false, error: "Entry not found." };
  return { ok: true };
}

export async function createDomain(
  userId: string,
  input: { name: string; kind: EntryKind },
): Promise<MutationResult<{ id: string }>> {
  try {
    const [row] = await db
      .insert(domains)
      .values({ userId, name: input.name, kind: input.kind })
      .returning({ id: domains.id });
    return { ok: true, id: row.id };
  } catch (e) {
    // The unique index on (user_id, lower(name)) is the real guard here —
    // checking first would race with a double-submit.
    if (typeof e === "object" && e && "code" in e && e.code === "23505") {
      return { ok: false, error: "You already have a domain with that name." };
    }
    throw e;
  }
}
