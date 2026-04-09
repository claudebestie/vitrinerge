exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  const data = JSON.parse(event.body);
  const { nom, contact_name, email, telephone, ville, metier, message, metier_url, ville_url, region_url } = data;

  // 1. Save to Supabase
  const SB_URL = process.env.SUPABASE_URL || "https://rofkgmwjggvxlgrdnsyt.supabase.co";
  const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (SB_KEY) {
    try {
      await fetch(`${SB_URL}/rest/v1/vitrinerge_contacts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SB_KEY,
          Authorization: `Bearer ${SB_KEY}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          nom, contact_name, email, telephone, ville, metier, message,
          metier_url, ville_url, region_url, source: "landing_vitrinerge",
        }),
      });
    } catch (err) {
      console.error("Supabase insert error:", err);
    }
  }

  // 2. Notify admin via Brevo
  const metierLabels = {
    "pompe-a-chaleur": "Pompe à chaleur",
    "solaire": "Panneaux solaires",
    "forage": "Forage géothermique",
    "climatisation": "Climatisation",
    "chaudiere": "Chaudière",
    "isolation": "Isolation",
    "ventilation": "Ventilation / VMC",
    "ballon-thermodynamique": "Ballon thermodynamique",
  };

  const metierLabel = metierLabels[metier] || metier || "—";
  const BREVO_KEY = process.env.BREVO_API_KEY;
  const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || "contact@vitrinerge.fr";
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "hello@getmizra.com";

  if (BREVO_KEY) {
    try {
      await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "Content-Type": "application/json", "api-key": BREVO_KEY },
        body: JSON.stringify({
          sender: { name: "VitrineRGE", email: SENDER_EMAIL },
          to: [{ email: ADMIN_EMAIL }],
          subject: `🟢 VitrineRGE — ${nom} (${metierLabel}, ${ville || "?"})`,
          htmlContent: `<h2>Nouveau lead VitrineRGE</h2>
<p><strong>Entreprise :</strong> ${nom}</p>
<p><strong>Contact :</strong> ${contact_name || "—"}</p>
<p><strong>Email :</strong> ${email}</p>
<p><strong>Téléphone :</strong> ${telephone || "—"}</p>
<p><strong>Ville :</strong> ${ville || "—"}</p>
<p><strong>Métier :</strong> ${metierLabel}</p>
<p><strong>Message :</strong><br>${message || "—"}</p>
<hr>
<p style="color:#999;font-size:12px">Source: landing_vitrinerge | Params: metier=${metier_url || "—"}, ville=${ville_url || "—"}, region=${region_url || "—"}</p>`,
        }),
      });
    } catch (err) {
      console.error("Brevo notify error:", err);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
