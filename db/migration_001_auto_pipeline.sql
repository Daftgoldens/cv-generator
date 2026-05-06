-- Migration : ajout des fonctionnalités d'automatisation
-- À exécuter dans le SQL Editor de Supabase

-- ============================================================
-- 1. Tables nouvelles
-- ============================================================

-- Entreprises trackées (remplace portals.yml)
CREATE TABLE IF NOT EXISTS tracked_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  careers_url TEXT,
  api TEXT,                          -- override URL directe (Greenhouse/Ashby/Lever)
  ats_type TEXT,                     -- 'greenhouse', 'ashby', 'lever' (auto-détecté sinon)
  enabled BOOLEAN DEFAULT TRUE,
  category TEXT,                     -- 'ai-lab', 'big-tech', 'french-startup', etc.
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracked_companies_enabled ON tracked_companies(enabled);

-- Filtres titres (positive/negative keywords)
CREATE TABLE IF NOT EXISTS title_filters (
  id INT PRIMARY KEY DEFAULT 1,
  positive TEXT[] DEFAULT '{}',
  negative TEXT[] DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT single_filter CHECK (id = 1)
);

-- Recherches scrapers (LinkedIn/WTTJ/Indeed/HelloWork)
CREATE TABLE IF NOT EXISTS scraper_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,              -- 'linkedin', 'wttj', 'indeed', 'hellowork'
  keywords TEXT[] NOT NULL,
  location TEXT NOT NULL,
  country_code TEXT,
  remote_filter TEXT[] DEFAULT '{}', -- ['remote','hybrid','onsite']
  posted_within_hours INT DEFAULT 48,
  max_results INT DEFAULT 30,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scraper_searches_enabled ON scraper_searches(enabled);

-- Logs des runs cron (debugging + monitoring)
CREATE TABLE IF NOT EXISTS cron_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,            -- 'scan-ats', 'scan-boards', 'batch-evaluate', 'generate-docs', 'daily-digest'
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT,                       -- 'running', 'success', 'failed'
  items_processed INT DEFAULT 0,
  items_new INT DEFAULT 0,
  error TEXT,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_started ON cron_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_runs_job ON cron_runs(job_name, started_at DESC);

-- Configuration globale (settings cron, thresholds, notifications)
CREATE TABLE IF NOT EXISTS auto_settings (
  id INT PRIMARY KEY DEFAULT 1,
  scoring_threshold NUMERIC(3,1) DEFAULT 7.0,
  daily_digest_enabled BOOLEAN DEFAULT TRUE,
  telegram_enabled BOOLEAN DEFAULT TRUE,
  email_enabled BOOLEAN DEFAULT TRUE,
  cron_scan_ats_enabled BOOLEAN DEFAULT TRUE,
  cron_scan_boards_enabled BOOLEAN DEFAULT TRUE,
  cron_batch_evaluate_enabled BOOLEAN DEFAULT TRUE,
  cron_generate_docs_enabled BOOLEAN DEFAULT TRUE,
  daily_application_cap INT DEFAULT 30,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT single_settings CHECK (id = 1)
);

INSERT INTO auto_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
INSERT INTO title_filters (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ============================================================
-- 2. Extensions tables existantes
-- ============================================================

-- Pipeline : tracking de la source et des champs scraper
ALTER TABLE pipeline
  ADD COLUMN IF NOT EXISTS source TEXT,         -- 'manual', 'ats-scanner', 'linkedin', 'wttj', 'indeed', 'hellowork'
  ADD COLUMN IF NOT EXISTS company TEXT,
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_id TEXT,
  ADD COLUMN IF NOT EXISTS fingerprint TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_fingerprint ON pipeline(fingerprint) WHERE fingerprint IS NOT NULL;

-- Applications : URLs des PDFs stockés + statut auto
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS cv_pdf_url TEXT,
  ADD COLUMN IF NOT EXISTS cover_letter_pdf_url TEXT,
  ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- ============================================================
-- 3. Trigger pour updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION trigger_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tracked_companies_updated_at ON tracked_companies;
CREATE TRIGGER tracked_companies_updated_at BEFORE UPDATE ON tracked_companies
  FOR EACH ROW EXECUTE FUNCTION trigger_update_timestamp();

DROP TRIGGER IF EXISTS auto_settings_updated_at ON auto_settings;
CREATE TRIGGER auto_settings_updated_at BEFORE UPDATE ON auto_settings
  FOR EACH ROW EXECUTE FUNCTION trigger_update_timestamp();

-- ============================================================
-- 4. Storage bucket
-- ============================================================
-- À créer manuellement dans Supabase Studio > Storage :
--   nom : "applications", public read = ON, RLS = OFF
-- (les fichiers seront accessibles via les URLs publiques signées par le service role)
