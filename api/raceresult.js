export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { action, listname, contest, bib, eventId } = req.query;

  // --- GPS live da GeoTracks ---
  if (action === 'gps') {
    if (!eventId) return res.status(400).json({ error: 'missing eventId' });
    try {
      const r = await fetch(`https://www.geotracks.co.uk/live/${eventId}/participants`, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.geotracks.co.uk/' }
      });
      if (!r.ok) return res.status(502).json({ error: 'geotracks error', status: r.status });
      const data = await r.json();
      return res.status(200).json(data);
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // --- Checkpoint da raceresult ---
  if (!listname || !contest || !bib) {
    return res.status(400).json({ error: 'missing params' });
  }
  const EVENT_ID = 364696;
  const API_KEY  = '57f586e9384a54e94bc198ff32a6d352';
  const url = `https://my.raceresult.com/${EVENT_ID}/results/list?key=${API_KEY}&listname=${encodeURIComponent(listname)}&contest=${contest}&page=1&term=${encodeURIComponent(bib)}`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return res.status(502).json({ error: 'upstream error', status: r.status });
    const data = await r.json();
    return res.status(200).json(data);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
