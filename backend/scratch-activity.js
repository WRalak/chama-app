const { PrismaClient } = require('@prisma/client');
const url = process.env.DATABASE_URL + '?connection_limit=1&connect_timeout=30';
const p = new PrismaClient({ datasources: { db: { url } } });
p.$queryRawUnsafe(`select pid, state, wait_event_type, now() - xact_start as xact_age, left(query, 90) as query
  from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and usename = current_user`)
  .then((r) => console.table(r))
  .catch((e) => console.error(e.message))
  .finally(() => p.$disconnect());
