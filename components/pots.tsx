import { formatTaka } from "@/lib/money";
import { dayLabel } from "@/lib/dates";
import { outstandingDebt, type KindTotals } from "@/lib/kinds";
import type { EarmarkBalance } from "@/db/queries";

/**
 * Two questions the month view cannot answer, because neither is about a
 * month: what do I still owe, and what is left of the money I was given for
 * something specific.
 */
export function Pots({
  allTime,
  pots,
}: {
  allTime: KindTotals;
  pots: EarmarkBalance[];
}) {
  const owed = outstandingDebt(allTime);

  return (
    <div className="mt-4 space-y-3">
      {/* debt ------------------------------------------------------------ */}
      <section className="card p-3.5">
        <p className="text-micro text-muted">Still owed · all time</p>
        <p
          className="num mt-1 text-display font-semibold leading-none tracking-tight"
          style={{ color: owed > 0 ? "var(--loan-in)" : "var(--in)" }}
        >
          <span className="mr-1 text-title opacity-40">৳</span>
          {formatTaka(Math.abs(owed))}
        </p>
        <p className="mt-1.5 text-micro text-muted">
          borrowed {formatTaka(allTime.loan_in)} · repaid{" "}
          {formatTaka(allTime.loan_out)}
          {owed < 0 && " · you have repaid more than you recorded borrowing"}
          {owed === 0 && allTime.loan_in === 0 && " · nothing recorded yet"}
        </p>
      </section>

      {/* pots ------------------------------------------------------------ */}
      {pots.length === 0 ? (
        <section className="card p-5">
          <p className="text-body font-medium">No pots yet</p>
          <p className="mt-2 text-small leading-relaxed text-muted">
            A pot links money you received for something to what you actually
            spent on it, so you can see what is left over. Put the same label
            in the <strong>Pot</strong> field on both entries — the money
            coming in and the payment going out — and they group here.
          </p>
          <p className="mt-2 text-small leading-relaxed text-muted">
            For example, label the tuition money you receive and the tuition
            you pay both as <em>Tuition Nov</em>.
          </p>
        </section>
      ) : (
        <section className="card overflow-hidden">
          <p className="px-3.5 pt-3.5 text-micro text-muted">
            Pots · money in, money out, what is left
          </p>
          <div className="rows mt-1.5">
            {pots.map((p) => {
              // Share of the pot already spent. Over 100% means more went out
              // than came in for this label, which is worth seeing.
              const used =
                p.inMinor > 0
                  ? Math.min(100, Math.round((p.outMinor / p.inMinor) * 100))
                  : p.outMinor > 0
                    ? 100
                    : 0;
              const over = p.remainingMinor < 0;
              return (
                <div key={p.earmark} className="px-3.5 py-3">
                  <div className="flex items-baseline gap-2.5">
                    <span className="min-w-0 flex-1 truncate text-body font-medium">
                      {p.earmark}
                    </span>
                    <span
                      className="num shrink-0 text-body font-semibold"
                      style={{ color: over ? "var(--out)" : "var(--in)" }}
                    >
                      {over ? "−" : ""}
                      {formatTaka(Math.abs(p.remainingMinor))}
                    </span>
                  </div>

                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunk">
                    <div
                      className="h-1.5 rounded-full"
                      style={{
                        width: used + "%",
                        background: over ? "var(--out)" : "var(--accent)",
                      }}
                    />
                  </div>

                  <p className="mt-1.5 text-micro text-muted">
                    in {formatTaka(p.inMinor)} · out {formatTaka(p.outMinor)} ·{" "}
                    {over ? "overspent" : used + "% used"} · {p.entries}{" "}
                    {p.entries === 1 ? "entry" : "entries"} ·{" "}
                    {dayLabel(p.firstOn)}
                    {p.firstOn !== p.lastOn && ` to ${dayLabel(p.lastOn)}`}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
