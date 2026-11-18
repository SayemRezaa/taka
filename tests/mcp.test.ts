import { describe, expect, it } from "vitest";
import { parseAmountExpression, toTaka, formatTaka } from "@/lib/money";
import {
  todayISO,
  weekBounds,
  monthBoundsInclusive,
  isISODate,
} from "@/lib/dates";
import {
  matchDomain,
  confirmToken,
  isDuplicateBlocked,
} from "@/lib/mcp/format";
import { isAllowed } from "@/lib/mcp/auth";
import type { EntryKind } from "@/db/schema";

describe("amount parser", () => {
  it("reads plain numbers and strings as poisha", () => {
    expect(parseAmountExpression(180.5)).toBe(18050);
    expect(parseAmountExpression("180.5")).toBe(18050);
    expect(parseAmountExpression("40")).toBe(4000);
  });

  it("sums a + expression", () => {
    expect(parseAmountExpression("10+80+30")).toBe(12000);
    expect(parseAmountExpression("10.50+0.50")).toBe(1100);
  });

  it("sums in integers so float error cannot accumulate", () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004; in poisha it is exactly 30.
    expect(parseAmountExpression("0.1+0.2")).toBe(30);
    const many = Array(100).fill("0.07").join("+");
    expect(parseAmountExpression(many)).toBe(700);
  });

  it("tolerates spaces, commas and the taka sign", () => {
    expect(parseAmountExpression(" 1,250 ")).toBe(125000);
    expect(parseAmountExpression("৳ 40 + 60")).toBe(10000);
  });

  it("refuses anything that is not digits, one dot, and +", () => {
    for (const bad of [
      "10-5",
      "10*5",
      "1e3",
      "abc",
      "",
      "+",
      "10++5",
      "10.",
      ".5",
      "10.123",
      "0",
      "-5",
      "10/5",
      "require('fs')",
      "1;2",
    ]) {
      expect(parseAmountExpression(bad), `should reject ${JSON.stringify(bad)}`).toBeNull();
    }
  });

  it("refuses non-finite and non-positive numbers", () => {
    expect(parseAmountExpression(0)).toBeNull();
    expect(parseAmountExpression(-1)).toBeNull();
    expect(parseAmountExpression(NaN)).toBeNull();
    expect(parseAmountExpression(Infinity)).toBeNull();
  });
});

describe("poisha conversion", () => {
  it("round-trips through taka", () => {
    expect(toTaka(18050)).toBe(180.5);
    expect(toTaka(0)).toBe(0);
    expect(toTaka(1)).toBe(0.01);
  });

  it("formats without decimals by default", () => {
    expect(formatTaka(125000)).toBe("1,250");
    expect(formatTaka(125050, { decimals: true })).toBe("1,250.50");
  });
});

describe("Dhaka dates", () => {
  it("today is a plain ISO date", () => {
    const t = todayISO();
    expect(t).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(isISODate(t)).toBe(true);
  });

  it("Dhaka is ahead of UTC, so its date can already be tomorrow", () => {
    // 2026-11-18T20:00Z is 2026-11-19 02:00 in Dhaka (UTC+6).
    const dhaka = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Dhaka",
    }).format(new Date("2026-11-18T20:00:00Z"));
    expect(dhaka).toBe("2026-11-19");
  });

  it("weeks run Monday to Sunday", () => {
    // 2026-11-18 is a Wednesday.
    expect(weekBounds("2026-11-18")).toEqual({
      from: "2026-11-16",
      to: "2026-11-22",
    });
    // A Monday is its own start.
    expect(weekBounds("2026-11-16").from).toBe("2026-11-16");
    // A Sunday belongs to the week that began six days earlier.
    expect(weekBounds("2026-11-22")).toEqual({
      from: "2026-11-16",
      to: "2026-11-22",
    });
  });

  it("weeks cross a year boundary without resetting", () => {
    expect(weekBounds("2026-01-01")).toEqual({
      from: "2025-12-29",
      to: "2026-01-04",
    });
  });

  it("month bounds handle short and leap months", () => {
    expect(monthBoundsInclusive("2026-02-10").to).toBe("2026-02-28");
    expect(monthBoundsInclusive("2024-02-10").to).toBe("2024-02-29");
    expect(monthBoundsInclusive("2026-11-18")).toEqual({
      from: "2026-11-01",
      to: "2026-11-30",
    });
  });

  it("rejects malformed dates", () => {
    for (const bad of ["2026-13-01", "26-01-01", "2026/01/01", "", undefined]) {
      expect(isISODate(bad as string | undefined)).toBe(false);
    }
  });
});

describe("category matching", () => {
  const domains: { id: string; name: string; kind: EntryKind }[] = [
    { id: "1", name: "Food & tiffin", kind: "expense" },
    { id: "2", name: "Transport", kind: "expense" },
    { id: "3", name: "Monthly allowance", kind: "income" },
  ];

  it("matches case-insensitively within the right kind", () => {
    const r = matchDomain(domains, "food & TIFFIN", "expense");
    expect(r.matched?.id).toBe("1");
  });

  it("will not reach across kinds", () => {
    const r = matchDomain(domains, "Monthly allowance", "expense");
    expect(r.matched).toBeNull();
  });

  it("suggests rather than inventing a near miss", () => {
    const r = matchDomain(domains, "Transprot", "expense");
    expect(r.matched).toBeNull();
    if (!r.matched) expect(r.suggestions).toContain("Transport");
  });
});

describe("confirm tokens", () => {
  const proposed = { amount: 250, category: "Transport" };

  it("are stable for the same change", () => {
    expect(confirmToken("update", "id-1", proposed)).toBe(
      confirmToken("update", "id-1", proposed),
    );
  });

  it("ignore key order", () => {
    expect(confirmToken("update", "id-1", { amount: 250, category: "Transport" })).toBe(
      confirmToken("update", "id-1", { category: "Transport", amount: 250 }),
    );
  });

  it("change when the row, the action or any value changes", () => {
    const base = confirmToken("update", "id-1", proposed);
    expect(confirmToken("update", "id-2", proposed)).not.toBe(base);
    expect(confirmToken("delete", "id-1", proposed)).not.toBe(base);
    expect(confirmToken("update", "id-1", { ...proposed, amount: 251 })).not.toBe(base);
  });
});

describe("duplicate guard", () => {
  const existing = { id: "e1" };

  it("blocks a same-day same-amount re-entry", () => {
    expect(isDuplicateBlocked(existing, undefined)).toBe(true);
    expect(isDuplicateBlocked(existing, false)).toBe(true);
  });

  it("lets force through", () => {
    expect(isDuplicateBlocked(existing, true)).toBe(false);
  });

  it("does not block when nothing matched", () => {
    expect(isDuplicateBlocked(null, undefined)).toBe(false);
    expect(isDuplicateBlocked(undefined, undefined)).toBe(false);
  });
});

describe("allowlist", () => {
  const me = "11111111-1111-1111-1111-111111111111";
  const someoneElse = "22222222-2222-2222-2222-222222222222";

  it("admits a listed user", () => {
    expect(isAllowed(me, [me])).toBe(true);
    expect(isAllowed(me, [someoneElse, me])).toBe(true);
  });

  it("rejects an unlisted user", () => {
    expect(isAllowed(someoneElse, [me])).toBe(false);
  });

  it("fails closed when the allowlist is empty", () => {
    // A deploy that forgot MCP_ALLOWED_USER_IDS must lock everyone out,
    // including the owner, rather than admit anyone who signed up.
    expect(isAllowed(me, [])).toBe(false);
  });
});
