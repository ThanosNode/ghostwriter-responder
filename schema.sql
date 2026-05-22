-- ============================================================
--  GhostWriter Review Responder — Supabase Postgres Schema
-- ============================================================

-- Enable the pgcrypto extension so gen_random_uuid() is available
-- (Already enabled by default on Supabase, but included for safety)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Profiles Table ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email               TEXT        NOT NULL UNIQUE,
  subscription_status TEXT        NOT NULL DEFAULT 'inactive'
                                  CHECK (subscription_status IN ('active', 'past_due', 'inactive')),
  brand_tone          TEXT        NOT NULL DEFAULT 'professional',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index on email for fast O(log n) lookups on every API call
CREATE INDEX IF NOT EXISTS profiles_email_idx ON public.profiles (email);

-- ─── Row Level Security ───────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Policy: authenticated users may only SELECT their own row, matched by email.
-- The serverless route uses the SERVICE ROLE key (which bypasses RLS),
-- so this policy protects any direct Supabase client-side calls.
CREATE POLICY "Users can read their own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (email = auth.jwt() ->> 'email');

-- ─── Seed Comment (remove before production) ──────────────────────────────
-- To manually insert a test user via the Supabase SQL editor:
--
-- INSERT INTO public.profiles (email, subscription_status, brand_tone)
-- VALUES ('test@example.com', 'active', 'friendly');
