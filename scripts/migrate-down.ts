/**
 * Migration down script — rolls back all migrations.
 * Usage: npm run migrate:down
 */

const { Client: PgClient } = require('pg');
const { PgMigrator } = require('../src/adapters/session-storage/pg-migrator');
const { join, dirname } = require('path');

const __dirname = dirname(__filename);
const migrationsDir = join(__dirname, '..', 'migrations');

const postgresUrl =
  process.env.POSTGRES_URL ?? 'postgresql://postgres:postgres@localhost:5432/beyourself';

async function main() {
  const client = new PgClient({ connectionString: postgresUrl });
  await client.connect();

  const migrator = new PgMigrator(client, migrationsDir);
  await migrator.down();

  console.log('All migrations rolled back');
  await client.end();
}

main().catch(console.error);
