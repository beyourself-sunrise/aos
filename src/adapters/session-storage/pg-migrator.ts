/**
 * PgMigrator — self-written migration tool (0 external dependencies).
 *
 * Reads .up.sql / .down.sql files from a migrations directory
 * and applies them in order, tracking applied versions in aos_migration table.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { Client as PgClient } from 'pg';

/**
 * PgMigrator — applies SQL migrations to PostgreSQL.
 *
 * Migration files:
 * - 0001_create_aos_session.up.sql
 * - 0001_create_aos_session.down.sql
 * - 0002_create_indexes.up.sql
 * - 0002_create_indexes.down.sql
 *
 * Tracking table: aos_migration (version TEXT PK, applied_at TIMESTAMPTZ)
 */
export class PgMigrator {
  constructor(
    private pgClient: PgClient,
    private migrationsDir: string,
  ) {}

  /**
   * Apply all pending up migrations.
   * Each migration runs in its own transaction for rollback safety.
   */
  async up(): Promise<void> {
    // Ensure tracking table exists
    await this.pgClient.query(`
      CREATE TABLE IF NOT EXISTS aos_migration (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Read all .up.sql files, sorted
    const files = readdirSync(this.migrationsDir)
      .filter((f) => f.endsWith('.up.sql'))
      .sort();

    for (const file of files) {
      const version = file.replace('.up.sql', '');
      const applied = await this.pgClient.query(
        'SELECT 1 FROM aos_migration WHERE version = $1',
        [version],
      );

      if (applied.rows.length > 0) {
        // Already applied
        continue;
      }

      const sql = readFileSync(join(this.migrationsDir, file), 'utf-8');

      await this.pgClient.query('BEGIN');
      try {
        await this.pgClient.query(sql);
        await this.pgClient.query(
          'INSERT INTO aos_migration (version) VALUES ($1)',
          [version],
        );
        await this.pgClient.query('COMMIT');
        console.log(`Migration ${version} applied`);
      } catch (err) {
        await this.pgClient.query('ROLLBACK');
        throw new Error(`Migration ${version} failed: ${err}`);
      }
    }
  }

  /**
   * Roll down migrations to the target version (exclusive).
   * If targetVersion is undefined, rolls back all migrations.
   */
  async down(targetVersion?: string): Promise<void> {
    // Ensure tracking table exists
    await this.pgClient.query(`
      CREATE TABLE IF NOT EXISTS aos_migration (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Get applied migrations in reverse order
    const result = await this.pgClient.query(
      'SELECT version FROM aos_migration ORDER BY version DESC',
    );

    const appliedVersions = result.rows.map((r) => r.version);

    for (const version of appliedVersions) {
      if (targetVersion && version <= targetVersion) {
        // Stop at target version
        break;
      }

      const downFile = `${version}.down.sql`;
      const downPath = join(this.migrationsDir, downFile);

      // Check file exists
      try {
        readFileSync(downPath, 'utf-8');
      } catch {
        console.warn(`Down migration ${downFile} not found, skipping`);
        continue;
      }

      const sql = readFileSync(downPath, 'utf-8');

      await this.pgClient.query('BEGIN');
      try {
        await this.pgClient.query(sql);
        await this.pgClient.query(
          'DELETE FROM aos_migration WHERE version = $1',
          [version],
        );
        await this.pgClient.query('COMMIT');
        console.log(`Migration ${version} rolled back`);
      } catch (err) {
        await this.pgClient.query('ROLLBACK');
        throw new Error(`Down migration ${version} failed: ${err}`);
      }
    }
  }

  /**
   * Get list of applied migrations.
   */
  async getApplied(): Promise<string[]> {
    try {
      const result = await this.pgClient.query(
        'SELECT version FROM aos_migration ORDER BY version',
      );
      return result.rows.map((r) => r.version);
    } catch {
      // Table doesn't exist yet
      return [];
    }
  }
}
