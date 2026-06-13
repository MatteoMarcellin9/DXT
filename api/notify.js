const BOT_TOKEN = "8835936118:AAGS9iIlUpi0cAJDGdw79mNZpkPuF32ThvE";
const CHAT_ID   = "1114071612";

// Checkpoint con km precisi (da GeoTracks)
const CHECKPOINTS = {
  "1": [ // 103K
    { name:"Passo Duran",     km:28.85 },
    { name:"Passo Staulanza", km:54.00 },
    { name:"Zoppè",           km:64.96 },
    { name:"Passo Cibiana",   km:84.41 },
    { name:"Arrivo",          km:101.25 },
  ],
  "2": [ // 72K
    { name:"Fusine",          km:33.33 },
    { name:"Zoppè",           km:44.39 },
    { name:"Passo Cibiana",   km:59.83 },
    { name:"Arrivo",          km:74.41 },
  ],
  "3": [ // 55K
    { name:"Passo Duran",     km:11.23 },
    { name:"Passo Staulanza", km:25.83 },
    { name:"Arrivo",          km:55.28 },
  ],
};

const ATHLETES = [
  { name:"Paolo Alessandrini", bib:"185",  contest:"1", geoEvent:"5423", color:"🟠" },
  { name:"Mauro Mazzonetto",   bib:"1103", contest:"2", geoEvent:"5424", color:"🔵" },
  { name:"Alessio Pellizzon",  bib:"1147", contest:"2", geoEvent:"5424", color:"🔵" },
  { name:"Seraina Rizzardini", bib:"2356", contest:"3", geoEvent:"5425", color:"🟢" },
  { name:"Sergio Marcellin",   bib:"2357", contest:"3", geoEvent:"5425", color:"🟢" },
];

// Stato notifiche in memoria (si resetta ad ogni cold start, ma ok per una gara)
// Usiamo una chiave "bib_checkpoint" per non notificare due volte
const notified = new Set();

async function getGPS(eventId) {
  const r = await fetch(`https://www.geotracks.co.uk/live/${eventId}/participants`, {
    headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://www.geotracks.co.uk/" }
  });
  if (!r.ok) return {};
  const data = await r.json();
  const byBib = {};
  for (const p of (data.data || [])) byBib[String(p.la)] = p;
  return byBib;
}

async function getGPX(race) {
  // Usa i dati GPX dal sito stesso
  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "https://dxt-olive.vercel.app";
  const r = await fetch(`${base}/gpx-${race}.json`);
  if (!r.ok) return null;
  return r.json();
}

function nearestKm(gpx, lat, lng) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < gpx.length; i++) {
    const dlat = gpx[i][0] - lat, dlng = gpx[i][1] - lng;
    const d = dlat * dlat + dlng * dlng;
    if (d < bestD) { bestD = d; best = i; }
  }
  return gpx[best][3] / 1000;
}

async function sendTelegram(text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "Markdown" })
  });
}

const GPX_FILE = { "1":"103k", "2":"72k", "3":"55k" };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  // Carica tutti i GPS e GPX in parallelo
  const uniqueEvents = [...new Set(ATHLETES.map(a => a.geoEvent))];
  const uniqueRaces  = [...new Set(ATHLETES.map(a => GPX_FILE[a.contest]))];

  const [gpsResults, gpxResults] = await Promise.all([
    Promise.all(uniqueEvents.map(id => getGPS(id))),
    Promise.all(uniqueRaces.map(r  => getGPX(r))),
  ]);

  const gpsByEvent = {};
  uniqueEvents.forEach((id, i) => gpsByEvent[id] = gpsResults[i]);
  const gpxByRace = {};
  uniqueRaces.forEach((r, i) => gpxByRace[r] = gpxResults[i]);

  const notifications = [];

  for (const athlete of ATHLETES) {
    const gps = gpsByEvent[athlete.geoEvent]?.[athlete.bib];
    if (!gps) continue;

    // Salta coordinate UK (no GPS fix)
    if (parseFloat(gps.lt) > 49) continue;

    const gpx = gpxByRace[GPX_FILE[athlete.contest]];
    if (!gpx) continue;

    const kmNow = nearestKm(gpx, parseFloat(gps.lt), parseFloat(gps.lg));
    const checkpoints = CHECKPOINTS[athlete.contest] || [];

    for (const cp of checkpoints) {
      const key = `${athlete.bib}_${cp.name}`;
      const kmToGo = cp.km - kmNow;

      // Notifica se è entro 1km dal checkpoint e non ancora notificato
      if (kmToGo >= 0 && kmToGo <= 1.0 && !notified.has(key)) {
        notified.add(key);
        const isArrivo = cp.name === "Arrivo";
        const msg = isArrivo
          ? `${athlete.color} *${athlete.name.split(" ")[0]}* sta per arrivare! 🏁\nManca meno di 1km al traguardo!`
          : `${athlete.color} *${athlete.name.split(" ")[0]}* si avvicina a *${cp.name}*!\nManca ~${kmToGo.toFixed(1)} km (al km ${kmNow.toFixed(1)} di ${cp.km})`;
        notifications.push(msg);
        await sendTelegram(msg);
      }
    }
  }

  return res.status(200).json({
    checked: ATHLETES.length,
    notifications: notifications.length,
    messages: notifications,
    notifiedTotal: notified.size,
  });
}
