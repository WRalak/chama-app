-- ───────────── ChamaHub financial integrity safeguards ─────────────

ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amountCents" > 0);
ALTER TABLE "payment_allocations" ADD CONSTRAINT "allocations_non_negative"
  CHECK ("amountCents" >= 0 AND "principalCents" >= 0 AND "interestCents" >= 0);
ALTER TABLE "contribution_schedules" ADD CONSTRAINT "schedules_amount_positive" CHECK ("amountCents" > 0);
ALTER TABLE "contribution_obligations" ADD CONSTRAINT "obligations_amounts_valid"
  CHECK ("amountCents" >= 0 AND "paidCents" >= 0 AND "paidCents" <= "amountCents");
ALTER TABLE "loans" ADD CONSTRAINT "loans_amounts_valid"
  CHECK ("principalCents" > 0 AND "rateBps" >= 0 AND "totalInterestCents" >= 0 AND "installmentsCount" > 0);
ALTER TABLE "loan_installments" ADD CONSTRAINT "installments_paid_within_due"
  CHECK ("principalPaidCents" >= 0 AND "interestPaidCents" >= 0
     AND "principalPaidCents" <= "principalCents" AND "interestPaidCents" <= "interestCents");
ALTER TABLE "fines" ADD CONSTRAINT "fines_amounts_valid"
  CHECK ("amountCents" > 0 AND "paidCents" >= 0 AND "paidCents" <= "amountCents");
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_positive" CHECK ("amountCents" > 0);
ALTER TABLE "payout_cycles" ADD CONSTRAINT "cycles_amount_positive" CHECK ("contributionCents" > 0);
ALTER TABLE "distribution_allocations" ADD CONSTRAINT "dist_alloc_valid"
  CHECK ("grossCents" >= 0 AND "loanOffsetCents" >= 0 AND "netCents" = "grossCents" - "loanOffsetCents");
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_shares_non_negative" CHECK ("shares" >= 0);

-- Ledger and audit trail are append-only. Corrections are reversal entries.
CREATE OR REPLACE FUNCTION chamahub_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only; post a reversal or adjustment instead', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entries_append_only BEFORE UPDATE OR DELETE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION chamahub_forbid_mutation();
CREATE TRIGGER journal_lines_append_only BEFORE UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION chamahub_forbid_mutation();
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION chamahub_forbid_mutation();
CREATE TRIGGER journal_entries_no_truncate BEFORE TRUNCATE ON "journal_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION chamahub_forbid_mutation();
CREATE TRIGGER journal_lines_no_truncate BEFORE TRUNCATE ON "journal_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION chamahub_forbid_mutation();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON "audit_events"
  FOR EACH STATEMENT EXECUTE FUNCTION chamahub_forbid_mutation();

-- Every journal entry must balance (sum of lines = 0) when the transaction commits.
CREATE OR REPLACE FUNCTION chamahub_check_entry_balanced() RETURNS trigger AS $$
DECLARE
  total BIGINT;
  line_count INT;
BEGIN
  SELECT COALESCE(SUM("amountCents"), 0), COUNT(*) INTO total, line_count
    FROM "journal_lines" WHERE "entryId" = NEW."entryId";
  IF total <> 0 OR line_count < 2 THEN
    RAISE EXCEPTION 'Journal entry % is unbalanced (sum %, % lines)', NEW."entryId", total, line_count
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER journal_lines_balanced AFTER INSERT ON "journal_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION chamahub_check_entry_balanced();
