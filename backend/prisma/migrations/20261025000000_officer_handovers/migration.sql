-- CreateTable
CREATE TABLE "public"."officer_handovers" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "role" "public"."GroupRole" NOT NULL,
    "outgoingMembershipId" TEXT,
    "incomingMembershipId" TEXT,
    "trigger" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "acknowledgedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgementNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "officer_handovers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "officer_handovers_groupId_createdAt_idx" ON "public"."officer_handovers"("groupId", "createdAt");


-- A handover record is permanent; only its acknowledgement can be added, once.
CREATE OR REPLACE FUNCTION officer_handovers_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'officer handovers are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."groupId" IS DISTINCT FROM OLD."groupId" OR NEW."role" IS DISTINCT FROM OLD."role"
     OR NEW."outgoingMembershipId" IS DISTINCT FROM OLD."outgoingMembershipId" OR NEW."incomingMembershipId" IS DISTINCT FROM OLD."incomingMembershipId"
     OR NEW."snapshot"::text IS DISTINCT FROM OLD."snapshot"::text OR NEW."notes" IS DISTINCT FROM OLD."notes"
     OR NEW."createdById" IS DISTINCT FROM OLD."createdById" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR NEW."trigger" IS DISTINCT FROM OLD."trigger" THEN
    RAISE EXCEPTION 'a handover record cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."acknowledgedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'this handover was already acknowledged' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER officer_handovers_guard BEFORE UPDATE OR DELETE ON "officer_handovers" FOR EACH ROW EXECUTE FUNCTION officer_handovers_guard();
CREATE TRIGGER officer_handovers_no_truncate BEFORE TRUNCATE ON "officer_handovers" FOR EACH STATEMENT EXECUTE FUNCTION chamahub_forbid_mutation();
