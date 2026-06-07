/**
 * Unit tests for PgSessionStorage.
 * Uses a mock pg client to test all 8 SessionStorage interface methods.
 */

import { PgSessionStorage } from '../../src/adapters/session-storage/pg-session-storage';
import { ConflictResolver, ConflictError } from '../../src/adapters/session-storage/conflict-resolver';
import type { Audit } from '../../src/interfaces/audit';

// Mock pg client
function createMockPgClient() {
  const queries: Map<string, unknown> = new Map();

  const mock = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      const key = `${sql}|${JSON.stringify(params)}`;
      const result = queries.get(key);
      if (result === undefined) {
        // Default: return empty result
        return { rows: [] };
      }
      return result;
    }),
    _queries: queries,
    _set: (sql: string, params: unknown[], result: unknown) => {
      const key = `${sql}|${JSON.stringify(params)}`;
      queries.set(key, result);
    },
  };

  return mock;
}

describe('PgSessionStorage', () => {
  let mockClient: any;
  let storage: PgSessionStorage;

  beforeEach(() => {
    mockClient = createMockPgClient();
    storage = new PgSessionStorage(mockClient as any, new ConflictResolver(1, 0));
  });

  describe('getMetadata', () => {
    it('returns metadata when session exists', async () => {
      mockClient._set(
        'SELECT id, thread_id, agent_id, metadata, leaf_id, version, created_at, updated_at FROM aos_session WHERE thread_id = $1',
        ['thread-1'],
        {
          rows: [
            {
              id: 'session-1',
              thread_id: 'thread-1',
              agent_id: 'agent-1',
              metadata: { key: 'value' },
              leaf_id: 'entry-1',
              version: 2,
              created_at: new Date('2026-01-01'),
              updated_at: new Date('2026-01-02'),
            },
          ],
        },
      );

      const result = await storage.getMetadata('thread-1');

      expect(result).not.toBeNull();
      expect(result!.threadId).toBe('thread-1');
      expect(result!.agentId).toBe('agent-1');
      expect(result!.version).toBe(2);
      expect(result!.leafId).toBe('entry-1');
    });

    it('returns null when session does not exist', async () => {
      mockClient._set(
        'SELECT id, thread_id, agent_id, metadata, leaf_id, version, created_at, updated_at FROM aos_session WHERE thread_id = $1',
        ['thread-unknown'],
        { rows: [] },
      );

      const result = await storage.getMetadata('thread-unknown');

      expect(result).toBeNull();
    });
  });

  describe('getLeafId', () => {
    it('returns leaf_id when set', async () => {
      mockClient._set(
        'SELECT leaf_id FROM aos_session WHERE thread_id = $1',
        ['thread-1'],
        { rows: [{ leaf_id: 'entry-5' }] },
      );

      const result = await storage.getLeafId('thread-1');

      expect(result).toBe('entry-5');
    });

    it('returns null when leaf_id is null', async () => {
      mockClient._set(
        'SELECT leaf_id FROM aos_session WHERE thread_id = $1',
        ['thread-1'],
        { rows: [{ leaf_id: null }] },
      );

      const result = await storage.getLeafId('thread-1');

      expect(result).toBeNull();
    });
  });

  describe('setLeafId', () => {
    it('updates leaf_id and version', async () => {
      mockClient._set(
        'SELECT version FROM aos_session WHERE thread_id = $1 FOR UPDATE',
        ['thread-1'],
        { rows: [{ version: 1 }] },
      );
      mockClient._set(
        'UPDATE aos_session SET leaf_id = $1, version = version + 1, updated_at = NOW() WHERE thread_id = $2 AND version = $3',
        ['entry-3', 'thread-1', 1],
        { rowCount: 1 },
      );

      await storage.setLeafId('thread-1', 'entry-3');

      expect(mockClient.query).toHaveBeenCalledWith(
        'UPDATE aos_session SET leaf_id = $1, version = version + 1, updated_at = NOW() WHERE thread_id = $2 AND version = $3',
        ['entry-3', 'thread-1', 1],
      );
    });
  });

  describe('createEntryId', () => {
    it('returns a valid UUID', async () => {
      const id = await storage.createEntryId();

      // UUID v4 format check
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });
  });

  describe('appendEntry', () => {
    it('inserts entry and updates session', async () => {
      mockClient._set(
        'SELECT id, version, leaf_id FROM aos_session WHERE thread_id = $1 FOR UPDATE',
        ['thread-1'],
        { rows: [{ id: 'session-1', version: 1, leaf_id: null }] },
      );
      mockClient._set('BEGIN', [], { rows: [] });
      mockClient._set(
        'INSERT INTO aos_session_entry (id, thread_id, parent_id, role, content, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
        ['entry-1', 'thread-1', null, 'user', '{"text":"hello"}', '{}'],
        { rows: [] },
      );
      mockClient._set(
        'UPDATE aos_session SET leaf_id = $1, version = version + 1, updated_at = NOW() WHERE thread_id = $2 AND version = $3',
        ['entry-1', 'thread-1', 1],
        { rowCount: 1 },
      );
      mockClient._set('COMMIT', [], { rows: [] });

      const result = await storage.appendEntry('thread-1', {
        id: 'entry-1',
        threadId: 'thread-1',
        parentId: null,
        role: 'user',
        content: { text: 'hello' },
        metadata: {},
        createdAt: new Date(),
      });

      expect(result.entryId).toBe('entry-1');
      expect(result.version).toBe(2);
      expect(result.leafId).toBe('entry-1');
    });
  });

  describe('getEntry', () => {
    it('returns entry when found', async () => {
      mockClient._set(
        'SELECT id, thread_id, parent_id, role, content, metadata, created_at FROM aos_session_entry WHERE id = $1 AND thread_id = $2',
        ['entry-1', 'thread-1'],
        {
          rows: [
            {
              id: 'entry-1',
              thread_id: 'thread-1',
              parent_id: null,
              role: 'user',
              content: { text: 'hello' },
              metadata: {},
              created_at: new Date('2026-01-01'),
            },
          ],
        },
      );

      const result = await storage.getEntry('thread-1', 'entry-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('entry-1');
      expect(result!.role).toBe('user');
    });

    it('returns null when not found', async () => {
      mockClient._set(
        'SELECT id, thread_id, parent_id, role, content, metadata, created_at FROM aos_session_entry WHERE id = $1 AND thread_id = $2',
        ['entry-unknown', 'thread-1'],
        { rows: [] },
      );

      const result = await storage.getEntry('thread-1', 'entry-unknown');

      expect(result).toBeNull();
    });
  });

  describe('findEntries', () => {
    it('returns entries ordered by created_at', async () => {
      mockClient._set(
        'SELECT id, thread_id, parent_id, role, content, metadata, created_at FROM aos_session_entry WHERE thread_id = $1 ORDER BY created_at ASC',
        ['thread-1'],
        {
          rows: [
            {
              id: 'entry-1',
              thread_id: 'thread-1',
              parent_id: null,
              role: 'user',
              content: {},
              metadata: {},
              created_at: new Date('2026-01-01'),
            },
            {
              id: 'entry-2',
              thread_id: 'thread-1',
              parent_id: 'entry-1',
              role: 'assistant',
              content: {},
              metadata: {},
              created_at: new Date('2026-01-02'),
            },
          ],
        },
      );

      const result = await storage.findEntries('thread-1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('entry-1');
      expect(result[1].id).toBe('entry-2');
    });

    it('applies limit filter', async () => {
      mockClient._set(
        'SELECT id, thread_id, parent_id, role, content, metadata, created_at FROM aos_session_entry WHERE thread_id = $1 ORDER BY created_at ASC LIMIT $2',
        ['thread-1', 1],
        {
          rows: [
            {
              id: 'entry-1',
              thread_id: 'thread-1',
              parent_id: null,
              role: 'user',
              content: {},
              metadata: {},
              created_at: new Date('2026-01-01'),
            },
          ],
        },
      );

      const result = await storage.findEntries('thread-1', { limit: 1 });

      expect(result).toHaveLength(1);
    });

    it('applies since filter', async () => {
      const since = new Date('2026-01-02');
      mockClient._set(
        'SELECT id, thread_id, parent_id, role, content, metadata, created_at FROM aos_session_entry WHERE thread_id = $1 AND created_at > $2 ORDER BY created_at ASC',
        ['thread-1', since],
        {
          rows: [
            {
              id: 'entry-2',
              thread_id: 'thread-1',
              parent_id: 'entry-1',
              role: 'assistant',
              content: {},
              metadata: {},
              created_at: new Date('2026-01-03'),
            },
          ],
        },
      );

      const result = await storage.findEntries('thread-1', { since });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('entry-2');
    });
  });

  describe('getLabel', () => {
    it('returns label from metadata', async () => {
      mockClient._set(
        "SELECT metadata->>'label' AS label FROM aos_session_entry WHERE id = $1 AND thread_id = $2",
        ['entry-1', 'thread-1'],
        { rows: [{ label: 'my-label' }] },
      );

      const result = await storage.getLabel('thread-1', 'entry-1');

      expect(result).toBe('my-label');
    });

    it('returns null when label not found', async () => {
      mockClient._set(
        "SELECT metadata->>'label' AS label FROM aos_session_entry WHERE id = $1 AND thread_id = $2",
        ['entry-1', 'thread-1'],
        { rows: [{ label: null }] },
      );

      const result = await storage.getLabel('thread-1', 'entry-1');

      expect(result).toBeNull();
    });
  });

  describe('getPathToRoot', () => {
    it('returns path from entry to root via recursive CTE', async () => {
      mockClient._set(
        `WITH RECURSIVE path AS (
        SELECT id, thread_id, parent_id, role, content, metadata, created_at, 0 AS depth
        FROM aos_session_entry WHERE id = $1 AND thread_id = $2
        UNION ALL
        SELECT e.id, e.thread_id, e.parent_id, e.role, e.content, e.metadata, e.created_at, path.depth + 1
        FROM aos_session_entry e
        INNER JOIN path ON e.id = path.parent_id
      )
      SELECT * FROM path ORDER BY depth DESC`,
        ['entry-3', 'thread-1'],
        {
          rows: [
            {
              id: 'entry-1',
              thread_id: 'thread-1',
              parent_id: null,
              role: 'user',
              content: {},
              metadata: {},
              created_at: new Date('2026-01-01'),
              depth: 2,
            },
            {
              id: 'entry-2',
              thread_id: 'thread-1',
              parent_id: 'entry-1',
              role: 'assistant',
              content: {},
              metadata: {},
              created_at: new Date('2026-01-02'),
              depth: 1,
            },
            {
              id: 'entry-3',
              thread_id: 'thread-1',
              parent_id: 'entry-2',
              role: 'user',
              content: {},
              metadata: {},
              created_at: new Date('2026-01-03'),
              depth: 0,
            },
          ],
        },
      );

      const result = await storage.getPathToRoot('thread-1', 'entry-3');

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('entry-1'); // root first
      expect(result[2].id).toBe('entry-3'); // target last
    });
  });

  describe('getEntries', () => {
    it('delegates to findEntries', async () => {
      mockClient._set(
        'SELECT id, thread_id, parent_id, role, content, metadata, created_at FROM aos_session_entry WHERE thread_id = $1 ORDER BY created_at ASC',
        ['thread-1'],
        {
          rows: [
            {
              id: 'entry-1',
              thread_id: 'thread-1',
              parent_id: null,
              role: 'user',
              content: {},
              metadata: {},
              created_at: new Date('2026-01-01'),
            },
          ],
        },
      );

      const result = await storage.getEntries('thread-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('entry-1');
    });
  });

  describe('audit integration', () => {
    it('logs audit event on appendEntry when audit is provided', async () => {
      const mockAudit: Audit = {
        log: jest.fn().mockResolvedValue(undefined),
        query: jest.fn().mockResolvedValue([]),
      };

      mockClient._set(
        'SELECT id, version, leaf_id FROM aos_session WHERE thread_id = $1 FOR UPDATE',
        ['thread-1'],
        { rows: [{ id: 'session-1', version: 1, leaf_id: null }] },
      );
      mockClient._set('BEGIN', [], { rows: [] });
      mockClient._set(
        'INSERT INTO aos_session_entry (id, thread_id, parent_id, role, content, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
        ['entry-1', 'thread-1', null, 'user', '{"text":"hello"}', '{}'],
        { rows: [] },
      );
      mockClient._set(
        'UPDATE aos_session SET leaf_id = $1, version = version + 1, updated_at = NOW() WHERE thread_id = $2 AND version = $3',
        ['entry-1', 'thread-1', 1],
        { rowCount: 1 },
      );
      mockClient._set('COMMIT', [], { rows: [] });

      const storageWithAudit = new PgSessionStorage(
        mockClient as any,
        new ConflictResolver(1, 0),
        mockAudit,
      );

      await storageWithAudit.appendEntry('thread-1', {
        id: 'entry-1',
        threadId: 'thread-1',
        parentId: null,
        role: 'user',
        content: { text: 'hello' },
        metadata: {},
        createdAt: new Date(),
      });

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'aos.session.entry.appended',
          actor: 'aos-session-storage',
          payload: expect.objectContaining({
            threadId: 'thread-1',
            entryId: 'entry-1',
            role: 'user',
          }),
        }),
      );
    });

    it('does not log audit when audit is not provided', async () => {
      mockClient._set(
        'SELECT id, version, leaf_id FROM aos_session WHERE thread_id = $1 FOR UPDATE',
        ['thread-1'],
        { rows: [{ id: 'session-1', version: 1, leaf_id: null }] },
      );
      mockClient._set('BEGIN', [], { rows: [] });
      mockClient._set(
        'INSERT INTO aos_session_entry (id, thread_id, parent_id, role, content, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
        ['entry-1', 'thread-1', null, 'user', '{"text":"hello"}', '{}'],
        { rows: [] },
      );
      mockClient._set(
        'UPDATE aos_session SET leaf_id = $1, version = version + 1, updated_at = NOW() WHERE thread_id = $2 AND version = $3',
        ['entry-1', 'thread-1', 1],
        { rowCount: 1 },
      );
      mockClient._set('COMMIT', [], { rows: [] });

      // No audit provided — should not throw
      await storage.appendEntry('thread-1', {
        id: 'entry-1',
        threadId: 'thread-1',
        parentId: null,
        role: 'user',
        content: { text: 'hello' },
        metadata: {},
        createdAt: new Date(),
      });
    });
  });
});
