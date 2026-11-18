-- Loans and earmarks. Additive only: a new enum value and a new nullable
-- column, so the SR-Wiki sync contract is untouched.
--
-- Two kinds rather than one "loan" kind plus a direction column. A single
-- kind cannot say whether money arrived or left, and the alternative — a
-- nullable direction column with a CHECK tying it to the kind — buys nothing
-- that two enum values do not already give for free.
--
-- Postgres will not let a new enum value be USED in the transaction that
-- creates it, so the rows that need the new kinds move in 0003.
ALTER TYPE "public"."entry_kind" ADD VALUE IF NOT EXISTS 'loan_in';
ALTER TYPE "public"."entry_kind" ADD VALUE IF NOT EXISTS 'loan_out';

-- An optional label grouping entries that belong to one pot of money:
-- cash received for a stated purpose, what actually went to that purpose,
-- and therefore what is left over. Free text rather than its own table —
-- the entry form offers labels already in use, so a pot does not split on a
-- typo, and nothing here forecloses promoting it to a table later.
ALTER TABLE "public"."entries" ADD COLUMN IF NOT EXISTS "earmark" text;

-- Partial: most entries belong to no pot, and only the labelled ones are
-- ever grouped.
CREATE INDEX IF NOT EXISTS "entries_user_earmark_idx"
  ON "public"."entries" ("user_id", "earmark")
  WHERE "earmark" IS NOT NULL;
