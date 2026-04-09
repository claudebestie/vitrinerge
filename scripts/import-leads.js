import { createClient } from '@supabase/supabase-js';
import { parse } from 'csv-parse/sync';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CONFIG ──────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── MÉTIER DETECTION from input_url ─────────────────────────
const METIER_PATTERNS = [
  { pattern: /forage/i, metier: 'forage', label: 'Forage géothermique' },
  { pattern: /pompe.{0,3}chaleur|pac\b/i, metier: 'pompe-a-chaleur', label: 'Pompe à chaleur' },
  { pattern: /solaire|photovolta/i, metier: 'solaire', label: 'Panneaux solaires' },
  { pattern: /climatisation|clim\b/i, metier: 'climatisation', label: 'Climatisation' },
  { pattern: /chaudi[eè]re|chauffage/i, metier: 'chaudiere', label: 'Chaudière' },
  { pattern: /isolation|ite\b|comble/i, metier: 'isolation', label: 'Isolation' },
  { pattern: /ventilation|vmc/i, metier: 'ventilation', label: 'Ventilation / VMC' },
  { pattern: /ballon|chauffe.eau/i, metier: 'ballon-thermodynamique', label: 'Ballon thermodynamique' },
];

function deduceMetier(inputUrl) {
  const text = (inputUrl || '').toLowerCase();
  for (const { pattern, metier, label } of METIER_PATTERNS) {
    if (pattern.test(text)) return { metier, label };
  }
  return { metier: 'enr-general', label: 'Énergies renouvelables' };
}

// ── DÉPARTEMENT → RÉGION ────────────────────────────────────
const DEPT_TO_REGION = {
  '04':'PACA','05':'PACA','06':'PACA','13':'PACA','83':'PACA','84':'PACA',
  '09':'Occitanie','11':'Occitanie','12':'Occitanie','30':'Occitanie','31':'Occitanie',
  '32':'Occitanie','34':'Occitanie','46':'Occitanie','48':'Occitanie','65':'Occitanie',
  '66':'Occitanie','81':'Occitanie','82':'Occitanie',
  '01':'Auvergne-Rhône-Alpes','03':'Auvergne-Rhône-Alpes','07':'Auvergne-Rhône-Alpes',
  '15':'Auvergne-Rhône-Alpes','26':'Auvergne-Rhône-Alpes','38':'Auvergne-Rhône-Alpes',
  '42':'Auvergne-Rhône-Alpes','43':'Auvergne-Rhône-Alpes','63':'Auvergne-Rhône-Alpes',
  '69':'Auvergne-Rhône-Alpes','73':'Auvergne-Rhône-Alpes','74':'Auvergne-Rhône-Alpes',
  '16':'Nouvelle-Aquitaine','17':'Nouvelle-Aquitaine','19':'Nouvelle-Aquitaine',
  '23':'Nouvelle-Aquitaine','24':'Nouvelle-Aquitaine','33':'Nouvelle-Aquitaine',
  '40':'Nouvelle-Aquitaine','47':'Nouvelle-Aquitaine','64':'Nouvelle-Aquitaine',
  '79':'Nouvelle-Aquitaine','86':'Nouvelle-Aquitaine','87':'Nouvelle-Aquitaine',
  '75':'Île-de-France','77':'Île-de-France','78':'Île-de-France','91':'Île-de-France',
  '92':'Île-de-France','93':'Île-de-France','94':'Île-de-France','95':'Île-de-France',
  '22':'Bretagne','29':'Bretagne','35':'Bretagne','56':'Bretagne',
  '44':'Pays de la Loire','49':'Pays de la Loire','53':'Pays de la Loire',
  '72':'Pays de la Loire','85':'Pays de la Loire',
  '14':'Normandie','27':'Normandie','50':'Normandie','61':'Normandie','76':'Normandie',
  '08':'Grand Est','10':'Grand Est','51':'Grand Est','52':'Grand Est','54':'Grand Est',
  '55':'Grand Est','57':'Grand Est','67':'Grand Est','68':'Grand Est','88':'Grand Est',
  '02':'Hauts-de-France','59':'Hauts-de-France','60':'Hauts-de-France',
  '62':'Hauts-de-France','80':'Hauts-de-France',
  '21':'Bourgogne-Franche-Comté','25':'Bourgogne-Franche-Comté','39':'Bourgogne-Franche-Comté',
  '58':'Bourgogne-Franche-Comté','70':'Bourgogne-Franche-Comté','71':'Bourgogne-Franche-Comté',
  '89':'Bourgogne-Franche-Comté','90':'Bourgogne-Franche-Comté',
  '18':'Centre-Val de Loire','28':'Centre-Val de Loire','36':'Centre-Val de Loire',
  '37':'Centre-Val de Loire','41':'Centre-Val de Loire','45':'Centre-Val de Loire',
  '2A':'Corse','2B':'Corse',
};

function extractDept(cp) {
  if (!cp) return null;
  const s = cp.trim();
  if (s.startsWith('20')) return parseInt(s) < 20200 ? '2A' : '2B';
  return s.substring(0, 2);
}

function normalizePhone(p) {
  if (!p) return null;
  let n = p.replace(/[\s\-().]/g, '').trim();
  if (n.startsWith('+33')) n = '0' + n.slice(3);
  if (n.startsWith('33') && n.length === 11) n = '0' + n.slice(2);
  if (!n.startsWith('0') || n.length !== 10) return null;
  return n;
}

function normalizeEmail(e) {
  if (!e) return null;
  const em = e.trim().toLowerCase();
  if (!em.includes('@') || !em.includes('.')) return null;
  return em;
}

// ── IMPORT ──────────────────────────────────────────────────
async function run() {
  const csvPath = resolve(__dirname, 'data', 'installateurs_qualit_enr.csv');
  console.log('🚀 VitrineRGE Import');
  console.log(`📂 ${csvPath}\n`);

  const raw = readFileSync(csvPath, 'utf-8');
  const records = parse(raw, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  console.log(`Found ${records.length} records`);

  const leads = records.map(row => {
    const nom = (row.raison_sociale || '').trim();
    if (!nom) return null;

    const email = normalizeEmail(row.email);
    const telephone = normalizePhone(row.telephone);
    const cp = (row.code_postal || '').trim();
    const dept = extractDept(cp);
    const region = dept ? (DEPT_TO_REGION[dept] || null) : null;
    const { metier, label } = deduceMetier(row.input_url);

    return {
      nom: nom.substring(0, 200),
      email,
      telephone,
      site_web: null,
      ville: (row.ville || '').trim() || null,
      code_postal: cp || null,
      departement: dept,
      region,
      metier,
      metier_label: label,
      input_url: (row.input_url || '').trim() || null,
      source: 'qualit_enr_csv',
      statut: email ? 'new' : 'invalid',
      has_website: false,
      has_email: !!email,
      has_phone: !!telephone,
      priority: (email ? 3 : 0) + (telephone ? 2 : 0) + 5, // +5 car pas de site web
    };
  }).filter(Boolean);

  // Stats
  const withEmail = leads.filter(l => l.has_email).length;
  const withPhone = leads.filter(l => l.has_phone).length;
  console.log(`📧 ${withEmail} emails | 📱 ${withPhone} phones`);

  const metierDist = {};
  leads.forEach(l => { metierDist[l.metier] = (metierDist[l.metier] || 0) + 1; });
  console.log('📊 Métiers:', JSON.stringify(metierDist));

  const regionDist = {};
  leads.forEach(l => { if (l.region) regionDist[l.region] = (regionDist[l.region] || 0) + 1; });
  console.log('📍 Top régions:');
  Object.entries(regionDist).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .forEach(([r, c]) => console.log(`   ${r}: ${c}`));

  // Bulk insert in batches of 500
  let inserted = 0;
  for (let i = 0; i < leads.length; i += 500) {
    const batch = leads.slice(i, i + 500);
    const { error } = await supabase.from('leads_vitrinerge').upsert(batch, {
      onConflict: 'email',
      ignoreDuplicates: true,
    });
    if (error) {
      // Fallback: insert without upsert
      const { error: e2 } = await supabase.from('leads_vitrinerge').insert(batch);
      if (e2) console.error(`   ❌ Batch ${i}: ${e2.message}`);
      else inserted += batch.length;
    } else {
      inserted += batch.length;
    }
    if (inserted % 5000 === 0 && inserted > 0) console.log(`   ✅ ${inserted}/${leads.length}`);
  }

  console.log(`\n✅ Imported ${inserted}/${leads.length} leads`);
  const { count } = await supabase.from('leads_vitrinerge').select('*', { count: 'exact', head: true });
  console.log(`📊 Total in Supabase: ${count}`);
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
