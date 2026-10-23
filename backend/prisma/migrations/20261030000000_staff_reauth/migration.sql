-- Step-up re-authentication: when the person last proved who they are in each staff session.

-- AlterTable
ALTER TABLE "platform_sessions" ADD COLUMN     "reauthAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

