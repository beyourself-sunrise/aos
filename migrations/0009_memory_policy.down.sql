-- 0009 down: remove memory policy table
BEGIN;

DROP TABLE IF EXISTS aos_memory_policy;

COMMIT;
