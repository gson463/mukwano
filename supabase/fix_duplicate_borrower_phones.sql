-- DEPRECATED for new work: prefer migration 20260426160000_borrower_duplicate_of_and_partial_uniques.sql
-- (marks duplicate_of_borrower_id; does not mutate phone). Use this ::-append script only on legacy DBs.
-- Run BEFORE creating idx_borrowers_phone_norm_unique (same time window as ident fix + identity migration).
-- Does NOT require normalize_borrower_phone() — inlines: regexp_replace(lower(trim(phone)), '\s', '', 'g') trimmed.
-- For each duplicate normalized phone, keeps one row (lowest id); others get phone = original || '::' || id (UUID) so keys differ.
-- After: run 20260424120000_borrower_identity_uniqueness.sql to create functions + both unique indexes.
-- In the app, fix the affected phone numbers (red / manual) after cleanup.

-- Optional preview
/*
SELECT
  nullif(
    regexp_replace(lower(trim(coalesce(phone_number, ''))), '\s', '', 'g'),
    ''
  ) AS phone_key,
  array_agg(id ORDER BY id) AS ids,
  count(*)::int
FROM public.borrowers
WHERE phone_number IS NOT NULL
  AND trim(phone_number) <> ''
GROUP BY 1
HAVING count(*) > 1;
*/

WITH norm AS (
  SELECT
    id,
    phone_number,
    nullif(
      regexp_replace(lower(trim(coalesce(phone_number, ''))), '\s', '', 'g'),
      ''
    ) AS pkey,
    row_number() OVER (
      PARTITION BY nullif(
        regexp_replace(lower(trim(coalesce(phone_number, ''))), '\s', '', 'g'),
        ''
      )
      ORDER BY id
    ) AS rn
  FROM public.borrowers
  WHERE phone_number IS NOT NULL
    AND trim(phone_number) <> ''
    AND nullif(
      regexp_replace(lower(trim(coalesce(phone_number, ''))), '\s', '', 'g'),
      ''
    ) IS NOT NULL
)
UPDATE public.borrowers b
SET phone_number = n.phone_number || '::' || n.id::text
FROM norm n
WHERE b.id = n.id
  AND n.rn > 1;
