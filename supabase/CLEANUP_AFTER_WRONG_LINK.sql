-- Run this ON THE DATABASE THAT WAS LINKED BY MISTAKE (via Supabase SQL Editor for that project).
-- Step 1 is always safe: removes only the migration *records* we inserted for versions
-- 20260424120000 and 20260424130000. It does NOT drop tables, indexes, or functions.

-- Step 1 — migration history cleanup (recommended on the wrong project)
DELETE FROM supabase_migrations.schema_migrations
WHERE version IN ('20260424120000', '20260424130000');

-- Step 2 — DO NOT run the block below unless you are sure this database had NO prior
-- borrower_identity / center_id objects from another migration track (e.g. full FCL).
-- If this is a shared FCL reference DB, dropping these can break the FCL app.
/*
-- Rollback objects from 20260424130000 (center on borrowers)
DROP INDEX IF EXISTS public.idx_borrowers_center_id;
ALTER TABLE public.borrowers DROP COLUMN IF EXISTS center_id;

-- Rollback objects from 20260424120000 (identity uniqueness)
DROP INDEX IF EXISTS public.idx_borrowers_ident_norm_unique;
DROP INDEX IF EXISTS public.idx_borrowers_phone_norm_unique;
DROP FUNCTION IF EXISTS public.find_duplicate_borrower(text, text, uuid);
DROP FUNCTION IF EXISTS public.normalize_borrower_id_number(text);
DROP FUNCTION IF EXISTS public.normalize_borrower_phone(text);
*/
