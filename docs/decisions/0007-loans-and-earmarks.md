# 7. Loans as two kinds, pots as a label

Date: 2026-11-19 · Status: accepted

## Context

"Loan Payment" had been created as an ordinary expense category, so repaying
a debt counted as spending. Separately, money arrives earmarked for a purpose
— tuition handed over by a parent — part reaches that purpose and part does
not, and nothing recorded the relationship between the two halves.

## Decision

Two new kinds, `loan_in` and `loan_out`. One new nullable column,
`entries.earmark`, holding a free-text label that groups entries belonging to
one pot of money.

## Reasoning

Repaying a loan is not consumption. The money was already counted when it
arrived; spending it again at repayment counts it twice and overstates what
was consumed. This is the argument that already keeps `savings` out of
"where it went", applied to debt.

Two enum values rather than one `loan` kind plus a direction column, which is
what [the earlier sketch](0005-analysis-one-kind-at-a-time.md) assumed. A
single kind cannot say which way the money moved, so it needs a companion
column, which must then be null for every non-loan row and constrained by a
CHECK tying it to the kind. Two values carry the same information with no
nullable column, no constraint, and no conditional branch in the entry form.

The cost is that `EntryKind` went from three values to five, which broke six
separate `Record<EntryKind, string>` maps scattered across components. That
was the type checker making a point: labels, colours and the spendable-net
arithmetic were duplicated, and they now live in `lib/kinds.ts`.

Earmarks are free text rather than their own table. A table would allow a
target amount and an open/closed status, but costs a migration, an RLS
policy and a screen to manage rows, to serve a handful of pots. The failure
mode of free text is a pot splitting on a typo, and offering the labels
already in use defuses that in practice. Nothing here forecloses promoting
it to a table.

"In" for a pot is income or borrowing; "out" is spending, setting aside or
repaying. That follows `KIND_SIGN` rather than being a second opinion about
which direction each kind moves.

## Consequences

The chart's series cap and the legend's colour cap are now separate numbers.
Twelve categories can each have their own colour in a ranked list, but twelve
curves on one baseline is unreadable, so the time chart draws six and folds
the rest into "Other". Conflating the two is what made the breakdown feel
both crowded and incomplete at once.

Spending figures before this change included loan repayments. Historic
monthly totals therefore shift down slightly — ৳800 across the two rows that
existed.
