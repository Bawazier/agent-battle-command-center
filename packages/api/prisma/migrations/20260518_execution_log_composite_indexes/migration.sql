-- DropIndex (guarded with IF EXISTS in case the production DB was bootstrapped
-- with non-default index names — Prisma's default convention is
-- <table>_<column>_idx, but the original indexes were created via prisma db
-- push and no baseline migration was committed.)
DROP INDEX IF EXISTS "execution_logs_task_id_idx";

-- DropIndex
DROP INDEX IF EXISTS "execution_logs_agent_id_idx";

-- CreateIndex
CREATE INDEX "execution_logs_task_id_step_idx" ON "execution_logs"("task_id", "step");

-- CreateIndex
CREATE INDEX "execution_logs_agent_id_timestamp_idx" ON "execution_logs"("agent_id", "timestamp");
