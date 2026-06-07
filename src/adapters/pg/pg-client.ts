/**
 * PG Client — PostgreSQL connection helper.
 */

import { Client as PgClient } from 'pg';

export function createPgClient(databaseUrl: string): PgClient {
  const client = new PgClient({
    connectionString: databaseUrl,
  });
  return client;
}

export async function connectPgClient(client: PgClient): Promise<void> {
  await client.connect();
}

export async function disconnectPgClient(client: PgClient): Promise<void> {
  await client.end();
}
