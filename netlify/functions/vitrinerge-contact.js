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

  // 2. Notify admin via Resend
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

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: "VitrineRGE <hello@getmizra.com>",
        to: ["hello@getmizra.com"],
        subject: `🟢 VitrineRGE — ${nom} (${metierLabel}, ${ville || "?"})`,
        html: `<h2>Nouveau lead VitrineRGE</h2>
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
    console.error("Resend error:", err);
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
