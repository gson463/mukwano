-- DEPRECATED for new work: prefer migration 20260426160000_borrower_duplicate_of_and_partial_uniques.sql
-- (marks duplicate_of_borrower_id; does not mutate ID). Use this ::-append script only on legacy DBs.
-- Run BEFORE creating idx_borrowers_ident_norm_unique (or before APPLY_ALL_MIGRATIONS identity section).
-- Does NOT require normalize_borrower_id_number() — uses the same logic inline (lower(trim(...))).
-- Finds borrowers sharing the same normalized identification_number and appends ::<uuid> to all but
-- one "keeper" per duplicate group (keeps the row with smallest id).
-- After this, re-run: 20260424120000_borrower_identity_uniqueness.sql (or APPLY_ALL_MIGRATIONS).

-- 1) Preview duplicates (optional — inspect in SQL Editor)
/*
SELECT
  nullif(lower(trim(coalesce(identification_number, ''))), '') AS id_key,
  array_agg(id ORDER BY id) AS borrower_ids,
  count(*)::int AS cnt
FROM public.borrowers
WHERE identification_number IS NOT NULL
  AND trim(identification_number) <> ''
GROUP BY 1
HAVING count(*) > 1;
*/

-- 2) De-duplicate: keep one row per normalized key (lowest id); tag others
WITH tagged AS (
  SELECT
    id,
    identification_number,
    nullif(lower(trim(coalesce(identification_number, ''))), '') AS nkey,
    row_number() OVER (
      PARTITION BY nullif(lower(trim(coalesce(identification_number, ''))), '')
      ORDER BY id
    ) AS rn
  FROM public.borrowers
  WHERE identification_number IS NOT NULL
    AND trim(identification_number) <> ''
    AND nullif(lower(trim(coalesce(identification_number, ''))), '') IS NOT NULL
)
UPDATE public.borrowers b
SET identification_number = t.identification_number || '::' || t.id::text
FROM tagged t
WHERE b.id = t.id
  AND t.rn > 1;

-- Rows updated will look like: 0740583756::9f1c2a3b-4d5e-6f7a-8b9c-0d1e2f3a4b5c
