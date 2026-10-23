-- Kenya launch prices from the product brief: Starter KSh 300, Standard KSh 700, Premium KSh 1,500
-- a month; a year costs ten months. These are hypotheses to validate, not market facts.
-- Only rows still holding the earlier placeholder amounts change, so prices already set in the
-- portal are kept. Amounts are in minor units (cents). Past payments keep the price they were charged.
UPDATE "plan_prices" pp SET "amountMinor" = v.new_amount, "updatedAt" = now()
FROM "plans" p,
     (VALUES ('STARTER', 'MONTH', 50000, 30000), ('STARTER', 'YEAR', 500000, 300000),
             ('STANDARD', 'MONTH', 100000, 70000), ('STANDARD', 'YEAR', 1000000, 700000),
             ('PREMIUM', 'MONTH', 200000, 150000), ('PREMIUM', 'YEAR', 2000000, 1500000)) AS v(code, interval, old_amount, new_amount)
WHERE pp."planId" = p.id AND p.code = v.code AND pp."countryCode" = 'KE' AND pp.currency = 'KES'
  AND pp.interval::text = v.interval AND pp."amountMinor" = v.old_amount;
