-- Move the existing loan repayments off `expense`.
--
-- "Loan Payment" was created as an ordinary expense category, which counted
-- debt repayment as spending. Settling a loan is not consumption: the money
-- was already counted as it arrived. Same reasoning that keeps `savings` out
-- of "where it went".
--
-- Separate from 0002 because Postgres will not let an enum value be used in
-- the transaction that created it.

UPDATE public.domains
   SET kind = 'loan_out'
 WHERE name = 'Loan Payment';

UPDATE public.entries
   SET kind = 'loan_out'
 WHERE domain_id IN (SELECT id FROM public.domains WHERE name = 'Loan Payment');

-- The matching inflow category, so borrowing has somewhere to land. user_id
-- is taken from the existing row rather than hardcoded.
INSERT INTO public.domains (user_id, name, kind)
SELECT user_id, 'Loan taken', 'loan_in'
  FROM public.domains
 WHERE name = 'Loan Payment'
    ON CONFLICT DO NOTHING;
