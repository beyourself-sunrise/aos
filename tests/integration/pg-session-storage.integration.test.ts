/**
 * Integration tests for PgSessionStorage.
 * Runs against a real PostgreSQL instance (docker compose up postgres).
 *
 * Requires:
 * - POSTGRES_URL env var (default: postgresql://postgres:postgres@localhost:5432/beyourself)
 * - PostgreSQL running with beyourself database
 */

import { Client as PgClient } from 'pg';
import { PgSessionStorage } from '../../src/adapters/session-storage/pg-session-storage';
import { PgMigrator } from '../../src/adapters/session-storage/pg-migrator';
import { ConflictResolver, ConflictError } from '../../src/adapters/session-storage/conflict-resolver';
import type { Audit } from '../../src/interfaces/audit';
import { join } from 'path';

const migrationsDir = join(__dirname, '..', '..', 'migrations');

const postgresUrl =
  process.env.POSTGRES_URL ?? 'postgresql://postgres:postgres@localhost:5432/beyourself';

let pgClient: PgClient;
let storage: PgSessionStorage;
let migrator: PgMigrator;
let mockAudit: Audit;
let storageWithAudit: PgSessionStorage;

beforeAll(async () => {
  pgClient = new PgClient({ connectionString: postgresUrl });
  await pgClient.connect();

  migrator = new PgMigrator(pgClient, migrationsDir);
  await migrator.up();

  storage = new PgSessionStorage(pgClient, new ConflictResolver(3, 0));

  mockAudit = {
    log: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue([]),
  };
  storageWithAudit = new PgSessionStorage(pgClient, new ConflictResolver(3, 0), mockAudit);
});

afterAll(async () => {
  await migrator.down();
  await pgClient.end();
});

describe('PgSessionStorage Integration', () => {
  const testThreadId = `test-${crypto.randomUUID()}`;
  const testAgentId = 'test-agent-1';

  beforeEach(async () => {
    // Create a test session
    await pgClient.query(
      'INSERT INTO aos_session (id, thread_id, agent_id, metadata, version) VALUES ($1, $2, $3, $4, 1)',
      [crypto.randomUUID(), testThreadId, testAgentId, {}],
    );
  });

  afterEach(async () => {
    // Clean up test session
    await pgClient.query('DELETE FROM aos_session WHERE thread_id = $1', [testThreadId]);
  });

  describe('getMetadata', () => {
    it('returns session metadata', async () => {
      const metadata = await storage.getMetadata(testThreadId);

      expect(metadata).not.toBeNull();
      expect(metadata!.threadId).toBe(testThreadId);
      expect(metadata!.agentId).toBe(testAgentId);
      expect(metadata!.version).toBe(1);
    });

    it('returns null for non-existent session', async () => {
      const metadata = await storage.getMetadata('non-existent-thread');
      expect(metadata).toBeNull();
    });
  });

  describe('getLeafId', () => {
    it('returns null for new session', async () => {
      const leafId = await storage.getLeafId(testThreadId);
      expect(leafId).toBeNull();
    });

    it('returns leaf_id after append', async () => {
      const entry = {
        id: 'entry-1',
        threadId: testThreadId,
        parentId: null,
        role: 'user' as const,
        content: { text: 'hello' },
        metadata: {},
        createdAt: new Date(),
      };

      await storage.appendEntry(testThreadId, entry);
      const leafId = await storage.getLeafId(testThreadId);

      expect(leafId).toBe('entry-1');
    });
  });

  describe('setLeafId', () => {
    it('updates leaf_id', async () => {
      await storage.setLeafId(testThreadId, 'entry-99');

      const metadata = await storage.getMetadata(testThreadId);
      expect(metadata!.leafId).toBe('entry-99');
    });
  });

  describe('createEntryId', () => {
    it('generates valid UUID', async () => {
      const id = await storage.createEntryId();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });
  });

  describe('appendEntry', () => {
    it('appends entry and updates session', async () => {
      const entry = {
        id: 'entry-1',
        threadId: testThreadId,
        parentId: null,
        role: 'user' as const,
        content: { text: 'hello' },
        metadata: {},
        createdAt: new Date(),
      };

      const result = await storage.appendEntry(testThreadId, entry);

      expect(result.entryId).toBe('entry-1');
      expect(result.version).toBe(2);
      expect(result.leafId).toBe('entry-1');

      // Verify in DB
      const metadata = await storage.getMetadata(testThreadId);
      expect(metadata!.leafId).toBe('entry-1');
      expect(metadata!.version).toBe(2);
    });

    it('appends multiple entries with parent chain', async () => {
      const entry1 = {
        id: 'entry-1',
        threadId: testThreadId,
        parentId: null,
        role: 'user' as const,
        content: { text: 'hello' },
        metadata: {},
        createdAt: new Date(),
      };

      const result1 = await storage.appendEntry(testThreadId, entry1);
      expect(result1.entryId).toBe('entry-1');

      const entry2 = {
        id: 'entry-2',
        threadId: testThreadId,
        parentId: 'entry-1',
        role: 'assistant' as const,
        content: { text: 'world' },
        metadata: {},
        createdAt: new Date(),
      };

      const result2 = await storage.appendEntry(testThreadId, entry2);
      expect(result2.entryId).toBe('entry-2');
      expect(result2.version).toBe(3);
    });

    it('generates entry ID when not provided', async () => {
      const entry = {
        threadId: testThreadId,
        parentId: null,
        role: 'user' as const,
        content: { text: 'hello' },
        metadata: {},
        createdAt: new Date(),
      };

      const result = await storage.appendEntry(testThreadId, entry as any);
      expect(result.entryId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });
  });

  describe('getEntry', () => {
    it('returns entry by ID', async () => {
      const entry = {
        id: 'entry-1',
        threadId: testThreadId,
        parentId: null,
        role: 'user' as const,
        content: { text: 'hello' },
        metadata: { label: 'test-label' },
        createdAt: new Date(),
      };

      await storage.appendEntry(testThreadId, entry);

      const found = await storage.getEntry(testThreadId, 'entry-1');

      expect(found).not.toBeNull();
      expect(found!.id).toBe('entry-1');
      expect(found!.role).toBe('user');
      expect(found!.content).toEqual({ text: 'hello' });
    });

    it('returns null for non-existent entry', async () => {
      const found = await storage.getEntry(testThreadId, 'non-existent');
      expect(found).toBeNull();
    });
  });

  describe('findEntries', () => {
    it('returns all entries', async () => {
      await storage.appendEntry(testThreadId, {
        id: 'entry-1',
        threadId: testThreadId,
        parentId: null,
        role: 'user' as const,
        content: {},
        metadata: {},
        createdAt: new Date(),
      });

      await storage.appendEntry(testThreadId, {
        id: 'entry-2',
        threadId: testThreadId,
        parentId: 'entry-1',
        role: 'assistant' as const,
        content: {},
        metadata: {},
        createdAt: new Date(),
      });

      const entries = await storage.findEntries(testThreadId);

      expect(entries).toHaveLength(2);
      expect(entries[0].id).toBe('entry-1');
      expect(entries[1].id).toBe('entry-2');
    });

    it('applies limit', async () => {
      await storage.appendEntry(testThreadId, {
        id: 'entry-1',
        threadId: testThreadId,
        parentId: null,
        role: 'user' as const,
        content: {},
        metadata: {},
        createdAt: new Date(),
      });

      await storage.appendEntry(testThreadId, {
        id: 'entry-2',
        threadId: testThreadId,
        parentId: 'entry-1',
        role: 'assistant' as const,
        content: {},
        metadata: {},
        createdAt: new Date(),
      });

      const entries = await storage.findEntries(testThreadId, { limit: 1 });
      expect(entries).toHaveLength(1);
    });
  });

  describe('getLabel', () => {
    it('returns label from metadata', async () => {
      await storage.appendEntry(testThreadId, {
        id: 'entry-1',
        threadId: testThreadId,
        parentId: null,
        role: 'user' as const,
        content: {},
        metadata: { label: 'my-label' },
        createdAt: new Date(),
      });

      const label = await storage.getLabel(testThreadId, 'entry-1');
      expect(label).toBe('my-label');
    });

    it('returns null when no label', async () => {
      await storage.appendEntry(testThreadId, {
        id: 'entry-1',
        threadId: testThreadId,
        parentId: null,
        role: 'user' as const,
        content: {},
        metadata: {},
        createdAt: new Date(),
      });

      const label = await storage.getLabel(testThreadId, 'entry-1');
      expect(label).toBeNull();
    });
  });

  describe('getPathToRoot', () => {
    it('returns path from entry to root', async () => {
      await storage.appendEntry(testThreadId, {
        id: 'entry-1',
        threadId: testThreadId,
        parentId: null,
        role: 'user' as const,
        content: {},
        metadata: {},
        createdAt: new Date(),
      });

      await storage.appendEntry(testThreadId, {
        id: 'entry-2',
        threadId: testThreadId,
        parentId: 'entry-1',
        role: 'assistant' as const,
        content: {},
        metadata: {},
        createdAt: new Date(),
      });

      await storage.appendEntry(testThreadId, {
        id: 'entry-3',
        threadId: testThreadId,
        parentId: 'entry-2',
        role: 'user' as const,
        content: {},
        metadata: {},
        createdAt: new Date(),
      });

      const path = await storage.getPathToRoot(testThreadId, 'entry-3');

      expect(path).toHaveLength(3);
      expect(path[0].id).toBe('entry-1'); // root first
      expect(path[1].id).toBe('entry-2');
      expect(path[2].id).toBe('entry-3'); // target last
    });
  });

  describe('getEntries', () => {
    it('returns all entries', async () => {
      await storage.appendEntry(testThreadId, {
        id: 'entry-1',
        threadId: testThreadId,
        parentId: null,
        role: 'user' as const,
        content: {},
        metadata: {},
        createdAt: new Date(),
      });

      const entries = await storage.getEntries(testThreadId);
      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe('entry-1');
    });
  });

  describe('optimistic lock conflict', () => {
    it('detects conflict when two clients update same session', async () => {
      // First append
      await storage.appendEntry(testThreadId, {
        id: 'entry-1',
        threadId: testThreadId,
        parentId: null,
        role: 'user' as const,
        content: {},
        metadata: {},
        createdAt: new Date(),
      });

      // Simulate conflict: manually bump version
      await pgClient.query(
        'UPDATE aos_session SET version = version + 1 WHERE thread_id = $1',
        [testThreadId],
      );

      // Second append should detect conflict and retry
      const entry2 = {
        id: 'entry-2',
        threadId: testThreadId,
        parentId: 'entry-1',
        role: 'assistant' as const,
        content: {},
        metadata: {},
        createdAt: new Date(),
      };

      // This should succeed after retry (since the version is already bumped,
      // the conflict resolver will retry and the version check will pass)
      const result = await storage.appendEntry(testThreadId, entry2);
      expect(result.entryId).toBe('entry-2');
    });
  });

  describe('audit integration', () => {
    it('logs audit event on appendEntry', async () => {
      const auditEntry = {
        id: 'audit-entry-1',
        threadId: testThreadId,
        parentId: null,
        role: 'user' as const,
        content: { text: 'audit test' },
        metadata: {},
        createdAt: new Date(),
      };

      await storageWithAudit.appendEntry(testThreadId, auditEntry);

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'aos.session.entry.appended',
          actor: 'aos-session-storage',
          payload: expect.objectContaining({
            threadId: testThreadId,
            entryId: 'audit-entry-1',
            role: 'user' as const,
          }),
        }),
      );
    });

    it('logs audit event on setLeafId', async () => {
      await storageWithAudit.setLeafId(testThreadId, 'audit-leaf-1');

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'aos.session.leaf.changed',
          actor: 'aos-session-storage',
          payload: expect.objectContaining({
            threadId: testThreadId,
            leafId: 'audit-leaf-1',
          }),
        }),
      );
    });
  });

  describe('migration roundtrip', () => {
    it('can run down and up again', async () => {
      // Create a fresh client for migration test
      const testClient = new PgClient({ connectionString: postgresUrl });
      await testClient.connect();

      const testMigrator = new PgMigrator(testClient, migrationsDir);

      // Run down
      await testMigrator.down();

      // Verify tables are gone
      const sessionCheck = await testClient.query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'aos_session')",
      );
      expect(sessionCheck.rows[0].exists).toBe(false);

      // Run up again
      await testMigrator.up();

      // Verify tables exist
      const sessionCheck2 = await testClient.query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'aos_session')",
      );
      expect(sessionCheck2.rows[0].exists).toBe(true);

      await testClient.end();
    });
  });
});
