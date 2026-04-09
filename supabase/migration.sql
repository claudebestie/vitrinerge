-- ============================================================
-- VITRINERGE — Migration complète (safe to re-run)
-- ============================================================

-- 1. Fonction trigger (nécessaire avant les triggers)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Drop et recréer leads_vitrinerge proprement
DROP VIEW IF EXISTS vitrinerge_stats CASCADE;
DROP TABLE IF EXISTS vitrinerge_email_events CASCADE;
DROP TABLE IF EXISTS vitrinerge_outreach_logs CASCADE;
DROP TABLE IF EXISTS vitrinerge_contacts CASCADE;
DROP TABLE IF EXISTS leads_vitrinerge CASCADE;

-- ── LEADS ───────────────────────────────────────────────────
CREATE TABLE leads_vitrinerge (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nom TEXT NOT NULL,
  email TEXT,
  telephone TEXT,
  site_web TEXT,
  ville TEXT,
  code_postal TEXT,
  departement TEXT,
  region TEXT,
  metier TEXT,
  metier_label TEXT,
  input_url TEXT,
  source TEXT,
  statut TEXT NOT NULL DEFAULT 'new',
  contacted_at TIMESTAMPTZ,
  batch_date DATE,
  email_batch_id TEXT,
  has_website BOOLEAN DEFAULT false,
  has_email BOOLEAN DEFAULT false,
  has_phone BOOLEAN DEFAULT false,
  priority INTEGER DEFAULT 0,
  email_opens INTEGER DEFAULT 0,
  email_clicks INTEGER DEFAULT 0,
  last_opened_at TIMESTAMPTZ,
  last_clicked_at TIMESTAMPTZ,
  engagement_score INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_leads_vitrinerge_statut ON leads_vitrinerge(statut);
CREATE INDEX idx_leads_vitrinerge_metier ON leads_vitrinerge(metier);
CREATE INDEX idx_leads_vitrinerge_region ON leads_vitrinerge(region);
CREATE INDEX idx_leads_vitrinerge_departement ON leads_vitrinerge(departement);
CREATE INDEX idx_leads_vitrinerge_email ON leads_vitrinerge(email);
CREATE INDEX idx_leads_vitrinerge_batch_date ON leads_vitrinerge(batch_date DESC);
CREATE INDEX idx_leads_vitrinerge_priority ON leads_vitrinerge(priority DESC);
CREATE INDEX idx_leads_vitrinerge_engagement ON leads_vitrinerge(engagement_score DESC);
CREATE INDEX idx_leads_vitrinerge_opens ON leads_vitrinerge(email_opens DESC);

CREATE TRIGGER update_leads_vitrinerge_updated_at
  BEFORE UPDATE ON leads_vitrinerge
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE leads_vitrinerge ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access leads_vitrinerge"
  ON leads_vitrinerge FOR ALL
  USING (auth.role() = 'service_role');

-- ── OUTREACH LOGS ───────────────────────────────────────────
CREATE TABLE vitrinerge_outreach_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  batch_date DATE NOT NULL,
  leads_selected INTEGER DEFAULT 0,
  emails_generated INTEGER DEFAULT 0,
  emails_sent INTEGER DEFAULT 0,
  emails_failed INTEGER DEFAULT 0,
  outreach_file TEXT,
  email_batch_file TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE vitrinerge_outreach_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access vitrinerge_outreach_logs"
  ON vitrinerge_outreach_logs FOR ALL
  USING (auth.role() = 'service_role');

-- ── CONTACTS (formulaire landing) ───────────────────────────
CREATE TABLE vitrinerge_contacts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nom TEXT NOT NULL,
  contact_name TEXT,
  email TEXT NOT NULL,
  telephone TEXT,
  ville TEXT,
  metier TEXT,
  message TEXT,
  metier_url TEXT,
  ville_url TEXT,
  region_url TEXT,
  source TEXT DEFAULT 'landing_vitrinerge',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE vitrinerge_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon insert vitrinerge_contacts"
  ON vitrinerge_contacts FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role full access vitrinerge_contacts"
  ON vitrinerge_contacts FOR ALL
  USING (auth.role() = 'service_role');

-- ── EMAIL EVENTS (webhook Brevo) ────────────────────────────
CREATE TABLE vitrinerge_email_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  lead_id UUID REFERENCES leads_vitrinerge(id),
  event TEXT NOT NULL,
  campaign TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_email_events_email ON vitrinerge_email_events(email);
CREATE INDEX idx_email_events_lead ON vitrinerge_email_events(lead_id);

ALTER TABLE vitrinerge_email_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access vitrinerge_email_events"
  ON vitrinerge_email_events FOR ALL
  USING (auth.role() = 'service_role');

-- ── VUE STATS ───────────────────────────────────────────────
CREATE OR REPLACE VIEW vitrinerge_stats AS
SELECT
  COUNT(*) AS total_leads,
  COUNT(*) FILTER (WHERE statut = 'new') AS new_leads,
  COUNT(*) FILTER (WHERE statut = 'email_sent') AS email_sent,
  COUNT(*) FILTER (WHERE statut = 'relance_sent') AS relance_sent,
  COUNT(*) FILTER (WHERE statut = 'replied') AS replied,
  COUNT(*) FILTER (WHERE statut = 'converted') AS converted,
  COUNT(*) FILTER (WHERE has_email) AS with_email,
  COUNT(*) FILTER (WHERE has_phone) AS with_phone,
  COUNT(DISTINCT metier) AS metiers_count,
  COUNT(DISTINCT region) AS regions_count,
  MAX(contacted_at) AS last_contacted_at
FROM leads_vitrinerge;
