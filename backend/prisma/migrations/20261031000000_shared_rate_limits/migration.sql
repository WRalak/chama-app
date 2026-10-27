-- Request counters shared by every API instance (RATE_LIMIT_STORE=database), so limits on sign-in,
-- recovery, payments and exports hold across a fleet instead of multiplying per instance.
CREATE TABLE "rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "hits" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "rate_limit_buckets_hits_positive" CHECK ("hits" > 0)
);
CREATE INDEX "rate_limit_buckets_expiresAt_idx" ON "rate_limit_buckets"("expiresAt");
ALTER TABLE "rate_limit_buckets" ENABLE ROW LEVEL SECURITY;
