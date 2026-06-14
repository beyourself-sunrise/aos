-- 0010 down: remove peer table
BEGIN;
DROP TABLE IF EXISTS aos_peer;
COMMIT;
