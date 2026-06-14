// v0422
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { action, listname, contest, bib, eventId, participantId } = req.query;

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

  // --- Dati dettaglio partecipante da GeoTracks (ETA, velocità, ecc.) ---
  if (action === 'gpsdetail') {
    if (!eventId || !participantId) return res.status(400).json({ error: 'missing eventId or participantId' });
    try {
      const r = await fetch(`https://www.geotracks.co.uk/live/${eventId}/participant/${participantId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': `https://www.geotracks.co.uk/live/${eventId}`,
          'X-Requested-With': 'XMLHttpRequest',
        }
      });
      if (!r.ok) return res.status(502).json({ error: 'geotracks detail error', status: r.status });
      const html = await r.text();

      // Estrai campi dataping con regex
      const extract = (id) => {
        const m = html.match(new RegExp(`id="${id}"[^>]*>([^<]*)`));
        return m ? m[1].trim() : null;
      };
      const pid = participantId;

      // ETA: tempo totale stimato → calcola orario arrivo aggiungendo a orario partenza
      const totalTime  = extract(`datapingestimate-${pid}`);       // es. "16:33:56"
      const timeLeft   = extract(`datapingestimateleft-${pid}`);   // es. "14:14:47"
      const currentTime= extract(`datapingtime-${pid}`);           // es. "02:19:09"
      const speed      = extract(`datapingspeed-${pid}`);          // es. "6.28 km/h"
      const nextCp     = extract(`datapingestimatecp-${pid}`);     // es. "00:34:10"
      const checkpoint = extract(`datapingcheckpoint-${pid}`);

      // Distanza e %
      const distM = html.match(/class="distance-[^"]+">([^<]+)/)?.[1]?.trim();
      const distPM = html.match(/class="distancepercentage-[^"]+">([^<]+)/)?.[1]?.trim();

      // Posizione
      const posM = html.match(/Position:\s*<span[^>]*>([^<]+)/)?.[1]?.trim();

      return res.status(200).json({
        totalTime, timeLeft, currentTime, speed, nextCp,
        checkpoint, distKm: distM, distPct: distPM, position: posM
      });
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
