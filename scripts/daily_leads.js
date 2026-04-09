import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CONFIG ──────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'contact@vitrinerge.fr';
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || 'VitrineRGE';
const EMAIL_COUNT = 250;
const CALL_COUNT = 50;
const RELANCE_DELAY_DAYS = 3;
const DRY_RUN = process.env.DRY_RUN === 'true';
const OUTPUT_DIR = resolve(__dirname, 'output');

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const today = new Date().toISOString().split('T')[0];

// ── EMAIL TEMPLATES PAR MÉTIER ──────────────────────────────
const METIER_TEMPLATES = {
  'pompe-a-chaleur': {
    label: 'pompe à chaleur',
    hook: 'installateur PAC',
    intro: (nom, ville, dept) =>
      `Vous installez des pompes à chaleur à ${ville} et dans le ${dept}. Vos futurs clients cherchent un installateur RGE sur Google en ce moment — et si vous n'avez pas de site, c'est votre concurrent qui reçoit l'appel.`,
  },
  'solaire': {
    label: 'panneaux solaires',
    hook: 'installateur solaire',
    intro: (nom, ville, dept) =>
      `Vous posez des panneaux solaires à ${ville} et dans le ${dept}. Le marché explose — les particuliers cherchent des installateurs RGE certifiés sur Google. Sans site, vous êtes invisible.`,
  },
  'forage': {
    label: 'forage géothermique',
    hook: 'foreur géothermique',
    intro: (nom, ville, dept) =>
      `Vous êtes spécialisé en forage géothermique à ${ville} et dans le ${dept}. C'est un métier de niche — les clients qui cherchent un foreur RGE sur Google ne trouvent souvent personne. Soyez le premier.`,
  },
  'climatisation': {
    label: 'climatisation',
    hook: 'installateur clim',
    intro: (nom, ville, dept) =>
      `Vous installez des systèmes de climatisation à ${ville} et dans le ${dept}. Avec les étés de plus en plus chauds, la demande explose. Vos futurs clients vous cherchent en ligne — êtes-vous visible ?`,
  },
  'chaudiere': {
    label: 'chaudière',
    hook: 'chauffagiste',
    intro: (nom, ville, dept) =>
      `Vous installez et entretenez des chaudières à ${ville} et dans le ${dept}. Les propriétaires cherchent un chauffagiste RGE pour remplacer leur vieille chaudière — et Google est leur premier réflexe.`,
  },
  'isolation': {
    label: 'isolation',
    hook: 'artisan isolation',
    intro: (nom, ville, dept) =>
      `Vous réalisez des travaux d'isolation à ${ville} et dans le ${dept}. Avec MaPrimeRénov', les demandes de devis explosent — mais les clients cherchent d'abord un artisan RGE sur Google.`,
  },
  'ventilation': {
    label: 'ventilation / VMC',
    hook: 'spécialiste VMC',
    intro: (nom, ville, dept) =>
      `Vous installez des systèmes de ventilation à ${ville} et dans le ${dept}. La VMC est au cœur de la rénovation énergétique — et vos futurs clients cherchent un pro RGE en ligne.`,
  },
  'ballon-thermodynamique': {
    label: 'ballon thermodynamique',
    hook: 'installateur ballon thermo',
    intro: (nom, ville, dept) =>
      `Vous installez des ballons thermodynamiques à ${ville} et dans le ${dept}. C'est l'un des équipements les plus recherchés en rénovation — vos futurs clients vous cherchent sur Google.`,
  },
};

const DEFAULT_TEMPLATE = {
  label: 'installateur RGE',
  hook: 'installateur RGE',
  intro: (nom, ville, dept) =>
    `Vous êtes installateur RGE à ${ville} et dans le ${dept}. Vos futurs clients cherchent un professionnel certifié sur Google — sans site, vous êtes invisible.`,
};

const REGION_HOOKS = {
  'PACA': 'Dans le sud, la concurrence entre installateurs est féroce.',
  'Occitanie': 'L\'Occitanie est l\'une des régions les plus dynamiques en ENR.',
  'Auvergne-Rhône-Alpes': 'En Auvergne-Rhône-Alpes, le marché de la réno énergétique est en plein boom.',
  'Île-de-France': 'En Île-de-France, les copropriétés cherchent massivement des artisans RGE.',
  'Nouvelle-Aquitaine': 'La Nouvelle-Aquitaine investit massivement dans la transition énergétique.',
  'Bretagne': 'En Bretagne, les aides régionales boostent la demande en rénovation.',
  'Pays de la Loire': 'Les Pays de la Loire sont un marché en forte croissance pour les ENR.',
  'Normandie': 'En Normandie, l\'isolation et le chauffage sont des priorités pour les particuliers.',
  'Grand Est': 'Le Grand Est, avec ses hivers rudes, est un marché clé pour le chauffage.',
  'Hauts-de-France': 'Les Hauts-de-France misent fort sur la rénovation énergétique.',
};

// ── HELPERS ─────────────────────────────────────────────────
function leadMeta(lead) {
  const tmpl = METIER_TEMPLATES[lead.metier] || DEFAULT_TEMPLATE;
  const ville = lead.ville || 'votre ville';
  const dept = lead.departement ? `département ${lead.departement}` : 'votre département';
  const regionHook = REGION_HOOKS[lead.region] || '';
  const landingUrl = `https://vitrinerge.fr/?metier=${encodeURIComponent(lead.metier || '')}&ville=${encodeURIComponent(lead.ville || '')}&region=${encodeURIComponent(lead.region || '')}`;
  return { tmpl, ville, dept, regionHook, landingUrl };
}

// ══════════════════════════════════════════════════════════════
// EMAIL 1 — Premier contact
// ══════════════════════════════════════════════════════════════

function buildFirstEmailHTML(lead) {
  const { tmpl, ville, dept, regionHook, landingUrl } = leadMeta(lead);
  const utmUrl = `${landingUrl}&utm_source=brevo&utm_medium=email&utm_campaign=first_${today}`;
  const intro = tmpl.intro(lead.nom, ville, dept);
  const regionLine = regionHook ? `<p style="font-size:14px;color:#475569;line-height:1.6;margin:0 0 16px;font-style:italic;">${regionHook}</p>` : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:20px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:100%;">

<!-- HEADER -->
<tr><td style="background:#0f172a;padding:24px 32px;text-align:center;">
  <h1 style="color:#fff;font-size:22px;margin:0;">Vitrine<span style="color:#22c55e">RGE</span></h1>
</td></tr>

<!-- PROMO BANNER -->
<tr><td style="background:linear-gradient(135deg,#f97316,#ea580c);padding:16px 32px;text-align:center;">
  <p style="color:#fff;font-size:18px;font-weight:bold;margin:0;">&#128293; 520&euro; au lieu de 650&euro; &mdash; jusqu'au 20 avril 2026</p>
</td></tr>

<!-- BODY -->
<tr><td style="padding:32px;">
  <p style="font-size:16px;color:#333;line-height:1.7;margin:0 0 8px;">Bonjour,</p>
  <p style="font-size:15px;color:#333;line-height:1.7;margin:0 0 16px;">${intro}</p>
  ${regionLine}

  <div style="background:#f0fdf4;border:2px solid #22c55e;border-radius:8px;padding:20px;margin:24px 0;">
    <p style="font-size:17px;font-weight:bold;color:#15803d;margin:0 0 8px;text-align:center;">&#127881; Offre de lancement VitrineRGE</p>
    <p style="font-size:28px;font-weight:bold;color:#15803d;margin:0;text-align:center;"><s style="color:#94a3b8;font-size:18px;">650&euro;</s> &rarr; 520&euro; HT</p>
    <p style="font-size:13px;color:#475569;margin:8px 0 0;text-align:center;">Paiement unique &bull; Livr&eacute; en 5 jours &bull; H&eacute;bergement 1 an inclus</p>
  </div>

  <p style="font-size:14px;color:#333;line-height:1.7;margin:0 0 8px;font-weight:bold;">Ce que vous obtenez :</p>
  <table style="font-size:14px;color:#333;line-height:1.8;margin:0 0 24px;">
    <tr><td style="padding:2px 8px 2px 0;">&#9989;</td><td>Site vitrine professionnel adapt&eacute; &agrave; votre m&eacute;tier</td></tr>
    <tr><td style="padding:2px 8px 2px 0;">&#9989;</td><td>SEO local (ville + m&eacute;tier) pour appara&icirc;tre sur Google</td></tr>
    <tr><td style="padding:2px 8px 2px 0;">&#9989;</td><td>Formulaire de demande de devis int&eacute;gr&eacute;</td></tr>
    <tr><td style="padding:2px 8px 2px 0;">&#9989;</td><td>Fiche Google Business optimis&eacute;e</td></tr>
    <tr><td style="padding:2px 8px 2px 0;">&#9989;</td><td>Responsive mobile + chargement rapide</td></tr>
    <tr><td style="padding:2px 8px 2px 0;">&#9989;</td><td>Badge RGE mis en avant</td></tr>
  </table>

  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:0 0 16px;">
      <a href="${utmUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:16px 40px;border-radius:8px;font-size:17px;font-weight:bold;">
        D&eacute;couvrir l'offre &agrave; 520&euro;
      </a>
    </td></tr>
  </table>

  <p style="font-size:12px;color:#94a3b8;text-align:center;margin:0;">
    Plus que quelques places disponibles &mdash; offre limit&eacute;e
  </p>
</td></tr>

<!-- FOOTER -->
<tr><td style="background:#f9f9f9;padding:20px 32px;border-top:1px solid #eee;">
  <p style="font-size:11px;color:#999;text-align:center;margin:0;">
    VitrineRGE &bull; vitrinerge.fr &bull; contact@vitrinerge.fr<br>
    <a href="https://vitrinerge.fr/unsubscribe?email=${encodeURIComponent(lead.email)}" style="color:#999;">Se d&eacute;sinscrire</a>
  </p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function buildFirstSubject(lead) {
  const tmpl = METIER_TEMPLATES[lead.metier] || DEFAULT_TEMPLATE;
  const ville = lead.ville || 'votre ville';
  return `Votre site ${tmpl.label} à ${ville} — 520€ au lieu de 650€`;
}

// ══════════════════════════════════════════════════════════════
// EMAIL 2 — Relance J+3
// ══════════════════════════════════════════════════════════════

function buildRelanceHTML(lead) {
  const { tmpl, ville, dept, landingUrl } = leadMeta(lead);
  const utmUrl = `${landingUrl}&utm_source=brevo&utm_medium=email&utm_campaign=relance_${today}`;

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:20px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:100%;">

<tr><td style="background:#0f172a;padding:24px 32px;text-align:center;">
  <h1 style="color:#fff;font-size:22px;margin:0;">Vitrine<span style="color:#22c55e">RGE</span></h1>
</td></tr>

<tr><td style="padding:32px;">
  <p style="font-size:16px;color:#333;line-height:1.7;margin:0 0 16px;">Bonjour,</p>

  <p style="font-size:15px;color:#333;line-height:1.7;margin:0 0 16px;">Je vous ai &eacute;crit il y a quelques jours au sujet de votre visibilit&eacute; en ligne en tant qu'installateur ${tmpl.label} &agrave; ${ville}.</p>

  <p style="font-size:15px;color:#333;line-height:1.7;margin:0 0 16px;">Je me permets de revenir vers vous car <strong>l'offre de lancement &agrave; 520&euro; se termine le 20 avril</strong>. Apr&egrave;s cette date, le tarif repasse &agrave; 650&euro;.</p>

  <div style="background:#fef3c7;border:2px solid #f59e0b;border-radius:8px;padding:20px;margin:24px 0;text-align:center;">
    <p style="font-size:16px;font-weight:bold;color:#92400e;margin:0 0 4px;">&#9200; Derni&egrave;res places &agrave; 520&euro;</p>
    <p style="font-size:14px;color:#92400e;margin:0;">Offre valable jusqu'au 20 avril 2026 uniquement</p>
  </div>

  <p style="font-size:15px;color:#333;line-height:1.7;margin:0 0 24px;">Un site vitrine pro, optimis&eacute; SEO pour &laquo;&nbsp;installateur ${tmpl.label} ${ville}&nbsp;&raquo;, livr&eacute; en 5 jours. Vos concurrents sont d&eacute;j&agrave; sur Google &mdash; il est temps d'y &ecirc;tre aussi.</p>

  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:0 0 16px;">
      <a href="${utmUrl}" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;padding:16px 40px;border-radius:8px;font-size:17px;font-weight:bold;">
        Profiter du tarif &agrave; 520&euro;
      </a>
    </td></tr>
  </table>

  <p style="font-size:14px;color:#475569;line-height:1.6;margin:0;">Cordialement,<br>L'&eacute;quipe VitrineRGE</p>
</td></tr>

<tr><td style="background:#f9f9f9;padding:20px 32px;border-top:1px solid #eee;">
  <p style="font-size:11px;color:#999;text-align:center;margin:0;">
    VitrineRGE &bull; vitrinerge.fr &bull; contact@vitrinerge.fr<br>
    <a href="https://vitrinerge.fr/unsubscribe?email=${encodeURIComponent(lead.email)}" style="color:#999;">Se d&eacute;sinscrire</a>
  </p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function buildRelanceSubject(lead) {
  const tmpl = METIER_TEMPLATES[lead.metier] || DEFAULT_TEMPLATE;
  const ville = lead.ville || 'votre ville';
  return `Dernier rappel — votre site ${tmpl.label} à ${ville} à 520€`;
}

// ── BREVO SENDER ────────────────────────────────────────────
async function sendBrevo(to, toName, subject, html, tags) {
  if (!BREVO_API_KEY) throw new Error('BREVO_API_KEY not configured');
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': BREVO_API_KEY },
    body: JSON.stringify({
      sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
      to: [{ email: to, name: toName }],
      subject,
      htmlContent: html,
      tags,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Brevo ${res.status}: ${err.substring(0, 200)}`);
  }
  return res.json();
}

// ── BUILD CALL LIST ENTRY ───────────────────────────────────
function buildCallEntry(lead) {
  const tmpl = METIER_TEMPLATES[lead.metier] || DEFAULT_TEMPLATE;
  const opens = lead.email_opens || 0;
  const clicks = lead.email_clicks || 0;
  const score = lead.engagement_score || 0;

  // Priorité visuelle pour la liste
  let priority_label = '⬜ Froid';
  if (clicks > 0) priority_label = '🔥🔥🔥 TRÈS CHAUD (a cliqué)';
  else if (opens >= 3) priority_label = '🔥🔥 CHAUD (3+ ouvertures)';
  else if (opens >= 1) priority_label = '🟡 TIÈDE (a ouvert)';

  return {
    priority_label,
    engagement_score: score,
    email_opens: opens,
    email_clicks: clicks,
    last_opened_at: lead.last_opened_at || null,
    nom: lead.nom,
    telephone: lead.telephone,
    email: lead.email,
    ville: lead.ville,
    departement: lead.departement,
    region: lead.region,
    metier: lead.metier_label || tmpl.label,
    site_web: lead.site_web || 'aucun',
    statut: lead.statut,
    hook: tmpl.hook,
    script: `Bonjour, je vous appelle de VitrineRGE. On crée des sites vitrines pour les installateurs ${tmpl.label} comme vous à ${lead.ville || 'votre ville'}. En ce moment on a une offre de lancement à 520€ au lieu de 650€ — site pro avec SEO local, livré en 5 jours. Ça vous intéresse que je vous montre un exemple ?`,
  };
}

// ── BUILD EMAIL BATCH JSON ENTRY (for Brevo file) ───────────
function buildEmailBatchEntry(lead, type) {
  const tmpl = METIER_TEMPLATES[lead.metier] || DEFAULT_TEMPLATE;
  const ville = lead.ville || 'votre ville';
  const dept = lead.departement ? `département ${lead.departement}` : 'votre département';
  const regionHook = REGION_HOOKS[lead.region] || '';

  const subject = type === 'relance'
    ? buildRelanceSubject(lead)
    : buildFirstSubject(lead);

  const bodyIntro = type === 'relance'
    ? `Bonjour,\n\nJe vous ai écrit il y a quelques jours au sujet de votre visibilité en ligne en tant qu'installateur ${tmpl.label} à ${ville}.\n\nJe me permets de revenir vers vous car l'offre de lancement à 520€ se termine le 20 avril. Après cette date, le tarif repasse à 650€.\n\nUn site vitrine pro, optimisé SEO, livré en 5 jours.\n\n👉 https://vitrinerge.fr/?metier=${encodeURIComponent(lead.metier)}&ville=${encodeURIComponent(lead.ville || '')}\n\nCordialement,\nL'équipe VitrineRGE`
    : `Bonjour,\n\n${tmpl.intro(lead.nom, ville, dept)}${regionHook ? '\n\n' + regionHook : ''}\n\n🔥 Offre de lancement : 520€ au lieu de 650€ jusqu'au 20 avril 2026\n\nCe que vous obtenez :\n— Site vitrine pro adapté à votre métier\n— SEO local (ville + métier)\n— Formulaire de demande de devis\n— Fiche Google Business optimisée\n— Responsive mobile + rapide\n— Hébergement 1 an inclus\n— Livré en 5 jours\n\n👉 https://vitrinerge.fr/?metier=${encodeURIComponent(lead.metier)}&ville=${encodeURIComponent(lead.ville || '')}\n\nCordialement,\nL'équipe VitrineRGE`;

  return {
    email: lead.email,
    nom: lead.nom,
    ville: lead.ville || '',
    region: lead.region || '',
    metier: lead.metier_label || tmpl.label,
    subject,
    body_intro: bodyIntro,
  };
}

// ══════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════
async function run() {
  console.log(`\n🚀 VitrineRGE Daily Leads — ${today}`);
  console.log(`   📧 Emails: ${EMAIL_COUNT} | 📞 Calls: ${CALL_COUNT} | Relance: J+${RELANCE_DELAY_DAYS} | DRY: ${DRY_RUN}\n`);

  mkdirSync(OUTPUT_DIR, { recursive: true });

  let totalEmailSent = 0, totalEmailFailed = 0;

  // ─────────────────────────────────────────────────────────
  // PHASE 1 — 250 PREMIERS EMAILS (nouveaux leads)
  // ─────────────────────────────────────────────────────────
  console.log('━━━ PHASE 1 : Premiers emails (250) ━━━');

  const { data: newLeads, error: e1 } = await supabase
    .from('leads_vitrinerge')
    .select('*')
    .eq('statut', 'new')
    .eq('has_email', true)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(EMAIL_COUNT);

  if (e1) { console.error('❌ Query error:', e1.message); process.exit(1); }
  console.log(`   📋 ${(newLeads || []).length} nouveaux leads sélectionnés`);

  if (newLeads && newLeads.length > 0) {
    // Show distribution
    const dist = {};
    newLeads.forEach(l => { dist[l.metier] = (dist[l.metier] || 0) + 1; });
    console.log('   📊 Métiers:', JSON.stringify(dist));

    // Save email batch JSON
    const emailBatchEntries = newLeads.map(l => buildEmailBatchEntry(l, 'first'));
    writeFileSync(
      resolve(OUTPUT_DIR, `email_batch_${today}.json`),
      JSON.stringify(emailBatchEntries, null, 2), 'utf-8'
    );

    // Send via Brevo
    if (BREVO_API_KEY && !DRY_RUN) {
      console.log(`   📧 Envoi de ${newLeads.length} emails via Brevo...`);
      const sentIds = [];

      for (const lead of newLeads) {
        try {
          await sendBrevo(
            lead.email, lead.nom,
            buildFirstSubject(lead),
            buildFirstEmailHTML(lead),
            ['vitrinerge', 'first', lead.metier || 'enr']
          );
          sentIds.push(lead.id);
          totalEmailSent++;
          if (totalEmailSent % 25 === 0) console.log(`      ✉️  ${totalEmailSent}/${newLeads.length}`);
          await sleep(120);
        } catch (err) {
          totalEmailFailed++;
          console.error(`      ❌ ${lead.email}: ${err.message}`);
        }
      }

      // Update Supabase
      if (sentIds.length > 0) {
        await supabase.from('leads_vitrinerge')
          .update({ statut: 'email_sent', contacted_at: new Date().toISOString(), batch_date: today })
          .in('id', sentIds);
        console.log(`   ✅ ${sentIds.length} marqués email_sent`);
      }
    } else if (DRY_RUN) {
      console.log('   🏷️  DRY RUN — pas d\'envoi');
      newLeads.slice(0, 3).forEach(l => console.log(`      [DRY] → ${l.email} | ${buildFirstSubject(l)}`));
    } else {
      console.log('   ⚠️  BREVO_API_KEY manquante — fichier JSON généré uniquement');
    }
  }

  // ─────────────────────────────────────────────────────────
  // PHASE 2 — RELANCE J+3 (leads email_sent depuis 3 jours)
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━ PHASE 2 : Relance J+3 ━━━');

  const relanceDate = new Date();
  relanceDate.setDate(relanceDate.getDate() - RELANCE_DELAY_DAYS);
  const relanceCutoff = relanceDate.toISOString();

  const { data: relanceLeads, error: e2 } = await supabase
    .from('leads_vitrinerge')
    .select('*')
    .eq('statut', 'email_sent')
    .lt('contacted_at', relanceCutoff)
    .order('contacted_at', { ascending: true })
    .limit(EMAIL_COUNT);

  if (e2) console.error('❌ Relance query error:', e2.message);
  console.log(`   📋 ${(relanceLeads || []).length} leads à relancer (email_sent depuis ${RELANCE_DELAY_DAYS}+ jours)`);

  if (relanceLeads && relanceLeads.length > 0) {
    // Save relance batch JSON
    const relanceBatchEntries = relanceLeads.map(l => buildEmailBatchEntry(l, 'relance'));
    writeFileSync(
      resolve(OUTPUT_DIR, `email_relance_${today}.json`),
      JSON.stringify(relanceBatchEntries, null, 2), 'utf-8'
    );

    if (BREVO_API_KEY && !DRY_RUN) {
      console.log(`   📧 Envoi de ${relanceLeads.length} relances via Brevo...`);
      let relanceSent = 0;
      const relanceSentIds = [];

      for (const lead of relanceLeads) {
        try {
          await sendBrevo(
            lead.email, lead.nom,
            buildRelanceSubject(lead),
            buildRelanceHTML(lead),
            ['vitrinerge', 'relance', lead.metier || 'enr']
          );
          relanceSentIds.push(lead.id);
          relanceSent++;
          totalEmailSent++;
          if (relanceSent % 25 === 0) console.log(`      ✉️  ${relanceSent}/${relanceLeads.length}`);
          await sleep(120);
        } catch (err) {
          totalEmailFailed++;
          console.error(`      ❌ ${lead.email}: ${err.message}`);
        }
      }

      // Mark as relance_sent — c'est fini pour ces leads
      if (relanceSentIds.length > 0) {
        await supabase.from('leads_vitrinerge')
          .update({ statut: 'relance_sent', contacted_at: new Date().toISOString() })
          .in('id', relanceSentIds);
        console.log(`   ✅ ${relanceSentIds.length} marqués relance_sent (terminé)`);
      }
    } else if (DRY_RUN) {
      console.log('   🏷️  DRY RUN — pas d\'envoi');
      relanceLeads.slice(0, 3).forEach(l => console.log(`      [DRY] → ${l.email} | ${buildRelanceSubject(l)}`));
    }
  }

  // ─────────────────────────────────────────────────────────
  // PHASE 3 — LISTE CALL (50 leads avec téléphone)
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━ PHASE 3 : Liste call (50) — triée par engagement ━━━');

  // Priorité : ceux qui ont ouvert/cliqué les emails en premier
  const { data: callLeads, error: e3 } = await supabase
    .from('leads_vitrinerge')
    .select('*')
    .in('statut', ['email_sent', 'relance_sent'])
    .eq('has_phone', true)
    .order('engagement_score', { ascending: false })
    .order('email_opens', { ascending: false })
    .order('priority', { ascending: false })
    .limit(CALL_COUNT);

  if (e3) console.error('❌ Call query error:', e3.message);
  console.log(`   📋 ${(callLeads || []).length} leads pour la liste call`);

  if (callLeads && callLeads.length > 0) {
    const callEntries = callLeads.map(buildCallEntry);

    const callFile = resolve(OUTPUT_DIR, `call_list_${today}.json`);
    writeFileSync(callFile, JSON.stringify(callEntries, null, 2), 'utf-8');
    console.log(`   📁 ${callFile}`);

    // Preview
    console.log('   📞 Top 5 (triés par engagement) :');
    callEntries.slice(0, 5).forEach((e, i) => {
      console.log(`      [${i + 1}] ${e.priority_label} | ${e.nom} | ${e.telephone} | ${e.metier} | ${e.ville} | opens:${e.email_opens} clicks:${e.email_clicks}`);
    });
  }

  // ─────────────────────────────────────────────────────────
  // LOG
  // ─────────────────────────────────────────────────────────
  if (!DRY_RUN) {
    await supabase.from('vitrinerge_outreach_logs').insert({
      run_at: new Date().toISOString(),
      batch_date: today,
      leads_selected: (newLeads || []).length + (relanceLeads || []).length,
      emails_generated: (newLeads || []).length + (relanceLeads || []).length,
      emails_sent: totalEmailSent,
      emails_failed: totalEmailFailed,
      outreach_file: `call_list_${today}.json`,
      email_batch_file: `email_batch_${today}.json`,
    });
  }

  console.log('\n━━━ RÉSUMÉ ━━━');
  console.log(`   📧 Premiers emails : ${(newLeads || []).length} leads`);
  console.log(`   🔁 Relances J+3 :    ${(relanceLeads || []).length} leads`);
  console.log(`   📞 Liste call :      ${(callLeads || []).length} leads`);
  console.log(`   ✉️  Brevo envoyés :   ${totalEmailSent} / échoués : ${totalEmailFailed}`);
  console.log(`\n✅ Done\n`);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
