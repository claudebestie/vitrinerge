// Brevo Webhook — tracks email opens, clicks, bounces, unsubscribes
// Configure in Brevo: Settings → Webhooks → Add webhook
// URL: https://vitrinerge.fr/.netlify/functions/brevo-webhook
// Events: opened, click, unsubscribe, hard_bounce, soft_bounce

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rofkgmwjggvxlgrdnsyt.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };
  if (!SUPABASE_KEY) return { statusCode: 500, body: "Missing SUPABASE_SERVICE_KEY" };

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  // Brevo sends different formats — normalize
  const email = (payload.email || "").toLowerCase().trim();
  const brevoEvent = payload.event || "";
  const tags = payload.tags || payload.tag || [];
  const campaign = Array.isArray(tags) ? tags.find(t => ["first", "relance"].includes(t)) || "" : "";

  if (!email || !brevoEvent) {
    return { statusCode: 400, body: "Missing email or event" };
  }

  // Only process vitrinerge emails
  const isVitrinerge = Array.isArray(tags)
    ? tags.includes("vitrinerge")
    : (tags === "vitrinerge");
  if (!isVitrinerge) {
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: "not vitrinerge" }) };
  }

  const headers = {
    "Content-Type": "application/json",
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  };

  // 1. Find the lead by email
  const findRes = await fetch(
    `${SUPABASE_URL}/rest/v1/leads_vitrinerge?email=eq.${encodeURIComponent(email)}&select=id,email_opens,email_clicks,engagement_score&limit=1`,
    { headers }
  );
  const leads = await findRes.json();
  const lead = Array.isArray(leads) && leads.length > 0 ? leads[0] : null;

  // 2. Log the event
  await fetch(`${SUPABASE_URL}/rest/v1/vitrinerge_email_events`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({
      email,
      lead_id: lead ? lead.id : null,
      event: brevoEvent,
      campaign,
      metadata: payload,
    }),
  });

  // 3. Update lead counters
  if (lead) {
    const updates = {};
    const now = new Date().toISOString();

    if (brevoEvent === "opened" || brevoEvent === "unique_opened") {
      updates.email_opens = (lead.email_opens || 0) + 1;
      updates.last_opened_at = now;
    } else if (brevoEvent === "click") {
      updates.email_clicks = (lead.email_clicks || 0) + 1;
      updates.last_clicked_at = now;
    } else if (brevoEvent === "unsubscribe") {
      updates.statut = "unsubscribed";
    } else if (brevoEvent === "hard_bounce") {
      updates.statut = "invalid";
    }

    // Recalculate engagement score
    const newOpens = updates.email_opens ?? lead.email_opens ?? 0;
    const newClicks = updates.email_clicks ?? lead.email_clicks ?? 0;
    updates.engagement_score = newOpens * 2 + newClicks * 5;

    if (Object.keys(updates).length > 0) {
      await fetch(
        `${SUPABASE_URL}/rest/v1/leads_vitrinerge?id=eq.${lead.id}`,
        {
          method: "PATCH",
          headers: { ...headers, Prefer: "return=minimal" },
          body: JSON.stringify(updates),
        }
      );
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, event: brevoEvent, email, lead_id: lead?.id }),
  };
};
