-- Trigram name similarity: flag registrations where full name is very close to an existing borrower
-- (requires pg_trgm; enable in Supabase if CREATE EXTENSION fails — Dashboard → Database → Extensions)

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION public.find_similar_borrower_name(
  p_first_name text,
  p_surname text,
  p_exclude_borrower_id uuid DEFAULT NULL,
  p_min_similarity real DEFAULT 0.40
)
RETURNS TABLE (
  id uuid,
  borrower_id text,
  first_name text,
  surname text,
  loan_officer_id uuid,
  branch_id uuid,
  name_similarity real
)
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH q AS (
    SELECT nullif(
      lower(trim(both regexp_replace(p_first_name, '\s+', ' ', 'g')) || ' ' ||
        trim(both regexp_replace(p_surname, '\s+', ' ', 'g'))),
      ''
    ) AS fullq
  )
  SELECT
    b.id,
    b.borrower_id,
    b.first_name,
    b.surname,
    b.loan_officer_id,
    b.branch_id,
    (similarity(
      (SELECT fullq FROM q),
      nullif(
        lower(trim(both regexp_replace(b.first_name, '\s+', ' ', 'g')) || ' ' ||
          trim(both regexp_replace(b.surname, '\s+', ' ', 'g'))),
        ''
      )
    ))::real AS name_similarity
  FROM public.borrowers b, q
  WHERE (SELECT fullq FROM q) IS NOT NULL
    AND char_length((SELECT fullq FROM q)) >= 8
    AND (p_exclude_borrower_id IS NULL OR b.id <> p_exclude_borrower_id)
    AND b.duplicate_of_borrower_id IS NULL
    AND nullif(
      lower(trim(both regexp_replace(b.first_name, '\s+', ' ', 'g')) || ' ' ||
        trim(both regexp_replace(b.surname, '\s+', ' ', 'g'))),
      ''
    ) IS NOT NULL
    AND similarity(
      (SELECT fullq FROM q),
      nullif(
        lower(trim(both regexp_replace(b.first_name, '\s+', ' ', 'g')) || ' ' ||
          trim(both regexp_replace(b.surname, '\s+', ' ', 'g'))),
        ''
      )
    ) >= p_min_similarity
  ORDER BY name_similarity DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.find_similar_borrower_name(text, text, uuid, real) TO authenticated;

COMMENT ON FUNCTION public.find_similar_borrower_name IS
  'Returns best-matching existing borrower (non-duplicate row) if full name is sufficiently similar; uses pg_trgm.';
