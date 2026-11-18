import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  listDomains,
  entriesInRange,
  findDuplicateEntry,
  totalsByKindForRange,
  domainTotalsForRange,
  getEntry,
  earmarkBalances,
  totalsByKindAllTime,
} from "@/db/queries";
import {
  createEntry,
  editEntry,
  removeEntry,
  createDomain,
} from "@/db/mutations";
import { parseAmountExpression, toTaka } from "@/lib/money";
import {
  todayISO,
  isISODate,
  weekBounds,
  monthBoundsInclusive,
} from "@/lib/dates";
import { userIdFrom } from "./auth";
import {
  reply,
  fail,
  matchDomain,
  confirmToken,
  isDuplicateBlocked,
} from "./format";
import type { EntryKind } from "@/db/schema";
import {
  KIND_LABEL,
  spendableNet,
  outstandingDebt,
} from "@/lib/kinds";

/**
 * The tools an assistant can call. Every one of them:
 *   - takes taka and converts to poisha through lib/money, never inline
 *   - treats "today" as today in Asia/Dhaka
 *   - scopes every query to the user id proved by the bearer token
 *   - answers with a one-line summary plus compact JSON
 */

const AMOUNT_CAP_MINOR = 100_000_000_00;

const kindSchema = z
  .enum(["expense", "income", "savings", "loan_in", "loan_out"])
  .describe(
    "expense = money consumed. income = money earned or received to keep. " +
      "savings = set aside, leaves the spendable balance but is not consumed. " +
      "loan_in = borrowed, cash arrives but is owed, NOT income. " +
      "loan_out = repaid, cash leaves but settles a debt, NOT an expense. " +
      "Repaying a loan is loan_out, never expense.",
  );

const amountSchema = z
  .union([z.number(), z.string()])
  .describe(
    'Amount in taka, not poisha. A number like 180.5, or a sum as a string like "10+80+30" when combining several jottings.',
  );

const earmarkSchema = z
  .string()
  .max(60)
  .describe(
    'Optional label grouping entries that share one pot of money, e.g. "Tuition Nov". ' +
      "Put the same label on the money coming in and the payment going out, and the " +
      "remainder is tracked for you. Use list_pots to see labels already in use.",
  );

const dateSchema = z
  .string()
  .describe("Date as YYYY-MM-DD. Defaults to today in Asia/Dhaka.");

/** Shared resolution for the one-entry and batch paths. */
type Resolved =
  | { ok: true; amountMinor: number; occurredOn: string; domainId: string; domainName: string }
  | { ok: false; error: string; suggestions?: string[] };

async function resolveEntry(
  userId: string,
  input: {
    amount: number | string;
    category: string;
    kind: EntryKind;
    date?: string;
  },
  domains: { id: string; name: string; kind: EntryKind }[],
): Promise<Resolved> {
  const amountMinor = parseAmountExpression(input.amount);
  if (amountMinor === null) {
    return {
      ok: false,
      error:
        'Could not read that amount. Use a number like 180.5 or a sum like "10+80+30".',
    };
  }
  if (amountMinor > AMOUNT_CAP_MINOR) {
    return { ok: false, error: "That amount is implausibly large." };
  }

  const occurredOn = input.date ?? todayISO();
  if (!isISODate(occurredOn)) {
    return { ok: false, error: "Date must be YYYY-MM-DD." };
  }

  const match = matchDomain(domains, input.category, input.kind);
  if (!match.matched) {
    return {
      ok: false,
      error: `No ${input.kind} category called "${input.category}".`,
      suggestions: match.suggestions,
    };
  }

  return {
    ok: true,
    amountMinor,
    occurredOn,
    domainId: match.matched.id,
    domainName: match.matched.name,
  };
}

export function registerTakaTools(server: McpServer) {
  // --- read -------------------------------------------------------------

  server.registerTool(
    "list_categories",
    {
      title: "List categories",
      description:
        'The user\'s active spending categories ("domains") with their kind. Call this before add_entry if you are unsure a category exists — add_entry will not create one. Example: {} returns [{"name":"Food & tiffin","kind":"expense"}, ...].',
      inputSchema: z.object({}),
    },
    async (_args, ctx) => {
      const userId = userIdFrom(ctx.http?.authInfo);
      const domains = await listDomains(userId);
      const out = domains.map((d) => ({ name: d.name, kind: d.kind }));
      return reply(`${out.length} active categories.`, out);
    },
  );

  server.registerTool(
    "list_entries",
    {
      title: "List entries",
      description:
        'Entries in a date range, newest first. Example: {"from":"2026-11-01","to":"2026-11-18","kind":"expense","limit":50}. Amounts come back in taka.',
      inputSchema: z.object({
        from: dateSchema,
        to: dateSchema,
        kind: kindSchema.optional(),
        category: z
          .string()
          .optional()
          .describe("Limit to one category, matched case-insensitively."),
        limit: z.number().int().min(1).max(500).optional(),
      }),
    },
    async (args, ctx) => {
      const userId = userIdFrom(ctx.http?.authInfo);
      if (!isISODate(args.from) || !isISODate(args.to)) {
        return fail("from and to must be YYYY-MM-DD.");
      }

      let domainId: string | null = null;
      if (args.category) {
        const domains = await listDomains(userId);
        const pool = args.kind
          ? domains.filter((d) => d.kind === args.kind)
          : domains;
        const hit = pool.find(
          (d) => d.name.toLowerCase() === args.category!.trim().toLowerCase(),
        );
        if (!hit) {
          return fail(`No category called "${args.category}".`, {
            suggestions: pool.map((d) => d.name).slice(0, 8),
          });
        }
        domainId = hit.id;
      }

      const rows = await entriesInRange(userId, {
        from: args.from,
        to: args.to,
        kind: args.kind ?? null,
        domainId,
        limit: args.limit ?? 100,
      });

      const out = rows.map((r) => ({
        id: r.id,
        date: r.occurredOn,
        amount: toTaka(r.amountMinor),
        kind: r.kind,
        category: r.domainName,
        method: r.method,
        note: r.note,
        pot: r.earmark,
      }));
      return reply(
        `${out.length} entries between ${args.from} and ${args.to}.`,
        out,
      );
    },
  );

  server.registerTool(
    "summary",
    {
      title: "Summarise a period",
      description:
        'Totals per kind and per category over a period, computed in the database. Example: {"range":"this_month"} or {"range":"custom","from":"2026-01-01","to":"2026-06-30"}. Weeks run Monday to Sunday.',
      inputSchema: z.object({
        range: z
          .enum(["today", "this_week", "this_month", "custom"])
          .describe("Use custom with from/to for anything else."),
        from: dateSchema.optional(),
        to: dateSchema.optional(),
      }),
    },
    async (args, ctx) => {
      const userId = userIdFrom(ctx.http?.authInfo);
      const today = todayISO();

      let from: string;
      let to: string;
      if (args.range === "today") {
        from = to = today;
      } else if (args.range === "this_week") {
        ({ from, to } = weekBounds(today));
      } else if (args.range === "this_month") {
        ({ from, to } = monthBoundsInclusive(today));
      } else {
        if (!isISODate(args.from) || !isISODate(args.to)) {
          return fail('range "custom" needs from and to as YYYY-MM-DD.');
        }
        from = args.from;
        to = args.to;
      }

      const [kinds, byDomain] = await Promise.all([
        totalsByKindForRange(userId, from, to),
        domainTotalsForRange(userId, from, to),
      ]);

      const payload = {
        from,
        to,
        totals: {
          expense: toTaka(kinds.expense),
          income: toTaka(kinds.income),
          savings: toTaka(kinds.savings),
          borrowed: toTaka(kinds.loan_in),
          repaid: toTaka(kinds.loan_out),
          net: toTaka(spendableNet(kinds)),
        },
        by_category: byDomain.map((d) => ({
          category: d.domainName,
          kind: d.kind,
          total: toTaka(d.total),
          entries: d.count,
        })),
      };

      return reply(
        `${from} to ${to}: out ${payload.totals.expense}, in ${payload.totals.income}, set aside ${payload.totals.savings}.`,
        payload,
      );
    },
  );

  server.registerTool(
    "loan_balance",
    {
      title: "What is still owed",
      description:
        "Everything borrowed less everything repaid, over all time. Use this for \"how much do I owe\" rather than summing entries yourself. Example: {}.",
      inputSchema: z.object({}),
    },
    async (_args, ctx) => {
      const userId = userIdFrom(ctx.http?.authInfo);
      const all = await totalsByKindAllTime(userId);
      const owed = outstandingDebt(all);
      return reply(
        owed > 0
          ? `Still owed: ${toTaka(owed)} taka.`
          : owed === 0
            ? "Nothing outstanding."
            : `Repaid ${toTaka(-owed)} taka more than recorded as borrowed.`,
        {
          outstanding: toTaka(owed),
          borrowed: toTaka(all.loan_in),
          repaid: toTaka(all.loan_out),
        },
      );
    },
  );

  server.registerTool(
    "list_pots",
    {
      title: "List pots",
      description:
        'Money grouped by earmark label: what came in for each purpose, what went out against it, and what is left. Use this before setting an earmark on a new entry so you reuse an existing label rather than creating a near-duplicate. Example: {} returns [{"pot":"Tuition Nov","in":5000,"out":3000,"remaining":2000}].',
      inputSchema: z.object({}),
    },
    async (_args, ctx) => {
      const userId = userIdFrom(ctx.http?.authInfo);
      const pots = await earmarkBalances(userId);
      const out = pots.map((p) => ({
        pot: p.earmark,
        in: toTaka(p.inMinor),
        out: toTaka(p.outMinor),
        remaining: toTaka(p.remainingMinor),
        entries: p.entries,
        first: p.firstOn,
        last: p.lastOn,
      }));
      return reply(
        out.length === 0
          ? "No pots yet."
          : `${out.length} pots. Labels in use: ${out.map((p) => p.pot).join(", ")}.`,
        out,
      );
    },
  );

  // --- write ------------------------------------------------------------

  server.registerTool(
    "add_entry",
    {
      title: "Add an entry",
      description:
        'Record one movement of money. The category must already exist — this never creates one; if it does not match you get suggestions back. Example: {"amount":"10+80+30","category":"Food & tiffin","kind":"expense","note":"lunch","method":"bKash"}. If an entry with the same date, category and amount already exists you get possible_duplicate instead; resend with force:true to add it anyway.',
      inputSchema: z.object({
        amount: amountSchema,
        category: z.string().describe("Must match an existing category name."),
        kind: kindSchema.optional(),
        note: z.string().max(200).optional(),
        method: z
          .string()
          .max(40)
          .optional()
          .describe("Cash, bKash, Nagad, Card, Bank."),
        date: dateSchema.optional(),
        earmark: earmarkSchema.optional(),
        force: z
          .boolean()
          .optional()
          .describe("Insert even if it looks like a duplicate."),
      }),
    },
    async (args, ctx) => {
      const userId = userIdFrom(ctx.http?.authInfo);
      const kind: EntryKind = args.kind ?? "expense";
      const domains = await listDomains(userId);

      const r = await resolveEntry(
        userId,
        { amount: args.amount, category: args.category, kind, date: args.date },
        domains,
      );
      if (!r.ok) return fail(r.error, r.suggestions ? { suggestions: r.suggestions } : {});

      {
        const dup = await findDuplicateEntry(userId, {
          occurredOn: r.occurredOn,
          domainId: r.domainId,
          amountMinor: r.amountMinor,
        });
        if (isDuplicateBlocked(dup, args.force) && dup) {
          return reply(
            `Looks like a duplicate of an entry already on ${dup.occurredOn}. Nothing added — resend with force:true if it is genuinely separate.`,
            {
              ok: false,
              possible_duplicate: {
                id: dup.id,
                date: dup.occurredOn,
                amount: toTaka(dup.amountMinor),
                category: dup.domainName,
                note: dup.note,
                method: dup.method,
              },
            },
          );
        }
      }

      const res = await createEntry(userId, {
        amountMinor: r.amountMinor,
        domainId: r.domainId,
        occurredOn: r.occurredOn,
        kind,
        method: args.method ?? null,
        note: args.note ?? null,
        earmark: args.earmark ?? null,
      });
      if (!res.ok) return fail(res.error);

      return reply(
        `Added ${toTaka(r.amountMinor)} taka to ${r.domainName} on ${r.occurredOn}.`,
        {
          ok: true,
          id: res.id,
          date: r.occurredOn,
          amount: toTaka(r.amountMinor),
          category: r.domainName,
          kind,
        },
      );
    },
  );

  server.registerTool(
    "add_entries_batch",
    {
      title: "Add several entries",
      description:
        'Up to 50 entries in one call, same rules as add_entry, with a per-item result so one bad category does not lose the rest. Example: {"items":[{"amount":120,"category":"Food & tiffin"},{"amount":40,"category":"Transport"}]}.',
      inputSchema: z.object({
        items: z
          .array(
            z.object({
              amount: amountSchema,
              category: z.string(),
              kind: kindSchema.optional(),
              note: z.string().max(200).optional(),
              method: z.string().max(40).optional(),
              date: dateSchema.optional(),
              earmark: earmarkSchema.optional(),
            }),
          )
          .min(1)
          .max(50),
        force: z.boolean().optional(),
      }),
    },
    async (args, ctx) => {
      const userId = userIdFrom(ctx.http?.authInfo);
      const domains = await listDomains(userId);

      const results: Record<string, unknown>[] = [];
      let added = 0;

      for (const [i, item] of args.items.entries()) {
        const kind: EntryKind = item.kind ?? "expense";
        const r = await resolveEntry(
          userId,
          { amount: item.amount, category: item.category, kind, date: item.date },
          domains,
        );
        if (!r.ok) {
          results.push({ index: i, ok: false, error: r.error, suggestions: r.suggestions });
          continue;
        }

        {
          const dup = await findDuplicateEntry(userId, {
            occurredOn: r.occurredOn,
            domainId: r.domainId,
            amountMinor: r.amountMinor,
          });
          if (isDuplicateBlocked(dup, args.force) && dup) {
            results.push({
              index: i,
              ok: false,
              possible_duplicate: { id: dup.id, date: dup.occurredOn, amount: toTaka(dup.amountMinor) },
            });
            continue;
          }
        }

        const res = await createEntry(userId, {
          amountMinor: r.amountMinor,
          domainId: r.domainId,
          occurredOn: r.occurredOn,
          kind,
          method: item.method ?? null,
          note: item.note ?? null,
          earmark: item.earmark ?? null,
        });
        if (!res.ok) {
          results.push({ index: i, ok: false, error: res.error });
          continue;
        }
        added++;
        results.push({
          index: i,
          ok: true,
          id: res.id,
          date: r.occurredOn,
          amount: toTaka(r.amountMinor),
          category: r.domainName,
        });
      }

      return reply(
        `Added ${added} of ${args.items.length} entries.`,
        { added, total: args.items.length, results },
      );
    },
  );

  server.registerTool(
    "create_category",
    {
      title: "Create a category",
      description:
        'Create a new category. Requires confirm:true, because a stray category splits history and is easy to create by accident. Example: {"name":"Lab fees","kind":"expense","confirm":true}.',
      inputSchema: z.object({
        name: z.string().trim().min(1).max(40),
        kind: kindSchema,
        confirm: z.boolean().optional(),
      }),
    },
    async (args, ctx) => {
      const userId = userIdFrom(ctx.http?.authInfo);
      if (args.confirm !== true) {
        return reply(
          `Would create the ${args.kind} category "${args.name}". Resend with confirm:true.`,
          { ok: false, needs_confirm: true, name: args.name, kind: args.kind },
        );
      }

      const res = await createDomain(userId, { name: args.name, kind: args.kind });
      if (!res.ok) return fail(res.error);
      return reply(`Created ${args.kind} category "${args.name}".`, {
        ok: true,
        id: res.id,
        name: args.name,
        kind: args.kind,
      });
    },
  );

  server.registerTool(
    "update_entry",
    {
      title: "Update an entry",
      description:
        'Change an existing entry. Without confirm:true it returns a before/after preview and a confirm_token; resend the identical call with confirm:true and that confirm_token to apply it. Example first call: {"id":"...","amount":250}.',
      inputSchema: z.object({
        id: z.uuid(),
        amount: amountSchema.optional(),
        category: z.string().optional(),
        kind: kindSchema.optional(),
        note: z.string().max(200).optional(),
        method: z.string().max(40).optional(),
        date: dateSchema.optional(),
        earmark: earmarkSchema.optional(),
        confirm: z.boolean().optional(),
        confirm_token: z.string().optional(),
      }),
    },
    async (args, ctx) => {
      const userId = userIdFrom(ctx.http?.authInfo);
      const current = await getEntry(userId, args.id);
      if (!current) return fail("No entry with that id.");

      const kind: EntryKind = args.kind ?? current.kind;
      const domains = await listDomains(userId);

      let domainId = current.domainId;
      let domainName = current.domainName;
      if (args.category || args.kind) {
        const match = matchDomain(domains, args.category ?? current.domainName, kind);
        if (!match.matched) {
          return fail(`No ${kind} category called "${args.category ?? current.domainName}".`, {
            suggestions: match.suggestions,
          });
        }
        domainId = match.matched.id;
        domainName = match.matched.name;
      }

      let amountMinor = current.amountMinor;
      if (args.amount !== undefined) {
        const parsed = parseAmountExpression(args.amount);
        if (parsed === null || parsed > AMOUNT_CAP_MINOR) {
          return fail("Could not read that amount.");
        }
        amountMinor = parsed;
      }

      const occurredOn = args.date ?? current.occurredOn;
      if (!isISODate(occurredOn)) return fail("Date must be YYYY-MM-DD.");

      const proposed = {
        date: occurredOn,
        amount: toTaka(amountMinor),
        category: domainName,
        kind,
        note: args.note ?? current.note,
        method: args.method ?? current.method,
        pot: args.earmark ?? current.earmark,
      };
      const token = confirmToken("update", args.id, proposed);

      if (args.confirm !== true || args.confirm_token !== token) {
        return reply(
          `Preview only — nothing changed. Resend with confirm:true and confirm_token "${token}".`,
          {
            ok: false,
            needs_confirm: true,
            confirm_token: token,
            before: {
              date: current.occurredOn,
              amount: toTaka(current.amountMinor),
              category: current.domainName,
              kind: current.kind,
              note: current.note,
              method: current.method,
              pot: current.earmark,
            },
            after: proposed,
          },
        );
      }

      const res = await editEntry(userId, args.id, {
        amountMinor,
        domainId,
        occurredOn,
        kind,
        method: proposed.method,
        note: proposed.note,
        earmark: proposed.pot,
      });
      if (!res.ok) return fail(res.error);
      return reply(`Updated the entry on ${occurredOn}.`, { ok: true, id: args.id, ...proposed });
    },
  );

  server.registerTool(
    "delete_entry",
    {
      title: "Delete an entry",
      description:
        'Delete an entry permanently. Without confirm:true it returns what would be deleted and a confirm_token; resend with confirm:true and that token to apply. Example: {"id":"..."}.',
      inputSchema: z.object({
        id: z.uuid(),
        confirm: z.boolean().optional(),
        confirm_token: z.string().optional(),
      }),
    },
    async (args, ctx) => {
      const userId = userIdFrom(ctx.http?.authInfo);
      const current = await getEntry(userId, args.id);
      if (!current) return fail("No entry with that id.");

      const snapshot = {
        date: current.occurredOn,
        amount: toTaka(current.amountMinor),
        category: current.domainName,
        kind: current.kind,
        note: current.note,
        method: current.method,
      };
      const token = confirmToken("delete", args.id, snapshot);

      if (args.confirm !== true || args.confirm_token !== token) {
        return reply(
          `Preview only — nothing deleted. Resend with confirm:true and confirm_token "${token}".`,
          { ok: false, needs_confirm: true, confirm_token: token, would_delete: snapshot },
        );
      }

      const res = await removeEntry(userId, args.id);
      if (!res.ok) return fail(res.error);
      return reply(`Deleted the ${snapshot.amount} taka entry on ${snapshot.date}.`, {
        ok: true,
        deleted: snapshot,
      });
    },
  );
}
