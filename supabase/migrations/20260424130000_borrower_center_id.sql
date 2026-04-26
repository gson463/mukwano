-- Centre link on borrowers (FCL-style); no guarantor columns in Mukwano.
ALTER TABLE public.borrowers
  ADD COLUMN IF NOT EXISTS center_id uuid REFERENCES public.centers (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_borrowers_center_id ON public.borrowers (center_id) WHERE center_id IS NOT NULL;
