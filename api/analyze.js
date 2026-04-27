// Vercel Serverless Function: /api/analyze
// Receives base64 file, calls Anthropic API, returns extracted JSON

export default async function handler(req, res) {
  // CORS for safety
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Methode non autorisee' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Cle API non configuree sur le serveur' });
  }

  try {
    const { type, data, mediaType } = req.body;

    if (!data) {
      return res.status(400).json({ error: 'Aucun fichier fourni' });
    }

    const contentBlock = type === 'pdf'
      ? {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data }
        }
      : {
          type: 'image',
          source: { type: 'base64', media_type: mediaType || 'image/jpeg', data }
        };

    const prompt = `Tu es un expert en facturation energie B2B francaise. Analyse cette facture et extrait les donnees.

Reponds UNIQUEMENT avec ce JSON, sans markdown ni backticks :
{
  "client": "nom du client/entreprise",
  "fournisseur": "EDF / Engie / GEG / TotalEnergies / etc",
  "option": "HP/HC / Base / 4 postes / Bleu / etc",
  "adresse": "adresse du site",
  "conso_kwh_mois": nombre,
  "conso_mwh_an": nombre,
  "prix_hp_mwh": nombre,
  "prix_hc_mwh": nombre,
  "prix_moyen_mwh": nombre,
  "abonnement_mois": nombre,
  "puissance_kva": nombre ou null
}

Si une donnee n'est pas trouvable, mets null. NE METS RIEN D'AUTRE QUE LE JSON.`;

    const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: [contentBlock, { type: 'text', text: prompt }]
        }]
      })
    });

    if (!apiResponse.ok) {
      const errText = await apiResponse.text();
      return res.status(apiResponse.status).json({
        error: `Erreur API Anthropic (${apiResponse.status}): ${errText.slice(0, 300)}`
      });
    }

    const result = await apiResponse.json();

    if (result.error) {
      return res.status(500).json({ error: result.error.message || 'Erreur API' });
    }

    const textBlock = result.content?.find(b => b.type === 'text');
    if (!textBlock) {
      return res.status(500).json({ error: "Pas de reponse de l'IA" });
    }

    let raw = textBlock.text.trim();
    raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Format de reponse invalide' });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return res.status(200).json({ data: parsed });
  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
};
