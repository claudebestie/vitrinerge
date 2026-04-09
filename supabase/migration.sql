-- ============================================================
-- VITRINERGE — Table leads_vitrinerge
-- À exécuter dans SQL Editor de ton projet Supabase
-- ============================================================

-- Table principale des leads VitrineRGE (installateurs ENR en France)
CREATE TABLE IF NOT EXISTS leads_vitrinerge (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Identité entreprise
  nom TEXT NOT NULL,
  email TEXT,
  telephone TEXT,
  site_web TEXT,

  -- Localisation
  ville TEXT,
  code_postal TEXT,
  departement TEXT,
  region TEXT,

  -- Métier (déduit de input_url)
  metier TEXT,            -- 'pompe-a-chaleur', 'solaire', 'forage', 'climatisation', 'chaudiere', 'isolation'
  metier_label TEXT,      -- 'Pompe à chaleur', 'Panneaux solaires', etc.

  -- Source / scraping
  input_url TEXT,         -- URL source d'où le lead a été extrait
  source TEXT,            -- 'lobstr', 'phantombuster', 'manual', etc.

  -- Outreach
  statut TEXT NOT NULL DEFAULT 'new',
  -- Valeurs : 'new', 'email_sent', 'relance_sent', 'replied', 'converted', 'unsubscribed', 'invalid'
  contacted_at TIMESTAMPTZ,
  batch_date DATE,        -- Date du batch d'outreach
  email_batch_id TEXT,    -- Référence au fichier batch

  -- Scoring
  has_website BOOLEAN DEFAULT false,
  has_email BOOLEAN DEFAULT false,
  has_phone BOOLEAN DEFAULT false,
  priority INTEGER DEFAULT 0,  -- 0-10, calculé automatiquement

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour les requêtes fréquentes
CREATE INDEX IF NOT EXISTS idx_leads_vitrinerge_statut ON leads_vitrinerge(statut);
CREATE INDEX IF NOT EXISTS idx_leads_vitrinerge_metier ON leads_vitrinerge(metier);
CREATE INDEX IF NOT EXISTS idx_leads_vitrinerge_region ON leads_vitrinerge(region);
CREATE INDEX IF NOT EXISTS idx_leads_vitrinerge_departement ON leads_vitrinerge(departement);
CREATE INDEX IF NOT EXISTS idx_leads_vitrinerge_email ON leads_vitrinerge(email);
CREATE INDEX IF NOT EXISTS idx_leads_vitrinerge_batch_date ON leads_vitrinerge(batch_date DESC);
CREATE INDEX IF NOT EXISTS idx_leads_vitrinerge_priority ON leads_vitrinerge(priority DESC);

-- Trigger pour updated_at automatique
CREATE TRIGGER update_leads_vitrinerge_updated_at
  BEFORE UPDATE ON leads_vitrinerge
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS — service key uniquement
ALTER TABLE leads_vitrinerge ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access leads_vitrinerge"
  ON leads_vitrinerge FOR ALL
  USING (auth.role() = 'service_role');

-- Table de logs outreach VitrineRGE
CREATE TABLE IF NOT EXISTS vitrinerge_outreach_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  batch_date DATE NOT NULL,
  leads_selected INTEGER DEFAULT 0,
  emails_generated INTEGER DEFAULT 0,
  emails_sent INTEGER DEFAULT 0,
  emails_failed INTEGER DEFAULT 0,
  outreach_file TEXT,     -- Chemin du fichier outreach_YYYY-MM-DD.json
  email_batch_file TEXT,  -- Chemin du fichier email_batch_YYYY-MM-DD.json
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE vitrinerge_outreach_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access vitrinerge_outreach_logs"
  ON vitrinerge_outreach_logs FOR ALL
  USING (auth.role() = 'service_role');

-- Table contacts landing page (formulaire vitrinerge.fr)
CREATE TABLE IF NOT EXISTS vitrinerge_contacts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nom TEXT NOT NULL,
  contact_name TEXT,
  email TEXT NOT NULL,
  telephone TEXT,
  ville TEXT,
  metier TEXT,
  message TEXT,
  metier_url TEXT,    -- param URL d'origine
  ville_url TEXT,     -- param URL d'origine
  region_url TEXT,    -- param URL d'origine
  source TEXT DEFAULT 'landing_vitrinerge',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE vitrinerge_contacts ENABLE ROW LEVEL SECURITY;

-- Allow anonymous inserts (form submission from landing page)
CREATE POLICY "Anon insert vitrinerge_contacts"
  ON vitrinerge_contacts FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role full access vitrinerge_contacts"
  ON vitrinerge_contacts FOR ALL
  USING (auth.role() = 'service_role');

-- Tracking ouvertures / clics Brevo
ALTER TABLE leads_vitrinerge ADD COLUMN IF NOT EXISTS email_opens INTEGER DEFAULT 0;
ALTER TABLE leads_vitrinerge ADD COLUMN IF NOT EXISTS email_clicks INTEGER DEFAULT 0;
ALTER TABLE leads_vitrinerge ADD COLUMN IF NOT EXISTS last_opened_at TIMESTAMPTZ;
ALTER TABLE leads_vitrinerge ADD COLUMN IF NOT EXISTS last_clicked_at TIMESTAMPTZ;
ALTER TABLE leads_vitrinerge ADD COLUMN IF NOT EXISTS engagement_score INTEGER DEFAULT 0;
-- engagement_score = opens*2 + clicks*5, recalculé par le webhook

CREATE INDEX IF NOT EXISTS idx_leads_vitrinerge_engagement ON leads_vitrinerge(engagement_score DESC);
CREATE INDEX IF NOT EXISTS idx_leads_vitrinerge_opens ON leads_vitrinerge(email_opens DESC);

-- Log détaillé des events Brevo
CREATE TABLE IF NOT EXISTS vitrinerge_email_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  lead_id UUID REFERENCES leads_vitrinerge(id),
  event TEXT NOT NULL,  -- 'opened', 'clicked', 'unsubscribed', 'hard_bounce', 'soft_bounce'
  campaign TEXT,        -- tag brevo (first / relance)
  metadata JSONB,      -- données brutes Brevo
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_events_email ON vitrinerge_email_events(email);
CREATE INDEX IF NOT EXISTS idx_email_events_lead ON vitrinerge_email_events(lead_id);

ALTER TABLE vitrinerge_email_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access vitrinerge_email_events"
  ON vitrinerge_email_events FOR ALL
  USING (auth.role() = 'service_role');

-- Vue stats rapide
CREATE OR REPLACE VIEW vitrinerge_stats AS
SELECT
  COUNT(*) AS total_leads,
  COUNT(*) FILTER (WHERE statut = 'new') AS new_leads,
  COUNT(*) FILTER (WHERE statut = 'batch_assigned') AS batch_assigned,
  COUNT(*) FILTER (WHERE statut = 'email_sent') AS email_sent,
  COUNT(*) FILTER (WHERE statut = 'relance_sent') AS relance_sent,
  COUNT(*) FILTER (WHERE statut = 'replied') AS replied,
  COUNT(*) FILTER (WHERE statut = 'converted') AS converted,
  COUNT(*) FILTER (WHERE has_email) AS with_email,
  COUNT(*) FILTER (WHERE has_phone) AS with_phone,
  COUNT(*) FILTER (WHERE has_website) AS with_website,
  COUNT(DISTINCT metier) AS metiers_count,
  COUNT(DISTINCT region) AS regions_count,
  MAX(contacted_at) AS last_contacted_at
FROM leads_vitrinerge;
