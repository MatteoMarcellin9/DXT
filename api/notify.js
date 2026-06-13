const BOT_TOKEN  = "8835936118:AAGS9iIlUpi0cAJDGdw79mNZpkPuF32ThvE";
const CHAT_ID    = "1114071612";
const GH_TOKEN   = process.env.GH_TOKEN;
const GH_REPO    = "MatteoMarcellin9/DXT";
const STATE_PATH = "api/notified_state.json";

const CHECKPOINTS = {
  "1": [
    { name:"Passo Duran",     km:28.85 },
    { name:"Passo Staulanza", km:54.00 },
    { name:"Zoppè",           km:64.96 },
    { name:"Passo Cibiana",   km:84.41 },
    { name:"Arrivo",          km:101.25 },
  ],
  "2": [
    { name:"Fusine",          km:33.33 },
    { name:"Zoppè",           km:44.39 },
    { name:"Passo Cibiana",   km:59.83 },
    { name:"Arrivo",          km:74.41 },
  ],
  "3": [
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

const ALERT_KM = {
  "Paolo Alessandrini_Passo Staulanza": [5, 1],
  "Seraina Rizzardini_Passo Staulanza": [5, 1],
  "Sergio Marcellin_Passo Staulanza":   [5, 1],
};
const DEFAULT_ALERTS = [1];

const GPX_FILE = { "1":"103k", "2":"72k", "3":"55k" };

// Leggi stato notifiche da GitHub
async function loadState() {
  try {
    const r = await fetch(
      `https://api.github.com/repos/${GH_REPO}/contents/${STATE_PATH}`,
      { headers: { "Authorization": `token ${GH_TOKEN}`, "User-Agent": "DXT-notify" } }
    );
    if (!r.ok) return { notified: [], sha: null };
    const d = await r.json();
    const content = JSON.parse(atob(d.content.replace(/\n/g, "")));
    return { notified: content.notified || [], sha: d.sha };
  } catch(e) {
    return { notified: [], sha: null };
  }
}

// Salva stato su GitHub
async function saveState(notified, sha) {
  const content = btoa(JSON.stringify({ notified, updated: new Date().toISOString() }));
  const body = { message: "Update notify state", content };
  if (sha) body.sha = sha;
  await fetch(
    `https://api.github.com/repos/${GH_REPO}/contents/${STATE_PATH}`,
    {
      method: "PUT",
      headers: {
        "Authorization": `token ${GH_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "DXT-notify"
      },
      body: JSON.stringify(body)
    }
  );
}

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
  // Usa GitHub raw per evitare self-referencing fetch (non supportato su Vercel serverless)
  const r = await fetch(
    `https://raw.githubusercontent.com/MatteoMarcellin9/DXT/main/public/gpx-${race}.json`,
    { headers: { "User-Agent": "DXT-notify" } }
  );
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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  // Carica stato persistente
  const { notified: notifiedArr, sha: stateSha } = await loadState();
  const notified = new Set(notifiedArr);

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
  const debugLog = [];

  for (const athlete of ATHLETES) {
    const gps = gpsByEvent[athlete.geoEvent]?.[athlete.bib];
    if (!gps) continue;
    if (parseFloat(gps.lt) > 49) continue;

    const gpx = gpxByRace[GPX_FILE[athlete.contest]];
    if (!gpx) continue;

    const kmNow = nearestKm(gpx, parseFloat(gps.lt), parseFloat(gps.lg));
    debugLog.push(`${athlete.bib}: km=${kmNow.toFixed(2)}`);
    const checkpoints = CHECKPOINTS[athlete.contest] || [];

    for (const cp of checkpoints) {
      const kmToGo = cp.km - kmNow;
      // Considera range: da 6km prima fino a 2km dopo il checkpoint
      // (i 2km dopo permettono di catturare chi è già passato senza notifica)
      if (kmToGo < -2 || kmToGo > 6) continue;

      const alertKey = `${athlete.name}_${cp.name}`;
      const thresholds = ALERT_KM[alertKey] || DEFAULT_ALERTS;

      for (const threshold of thresholds) {
        const key = `${athlete.bib}_${cp.name}_${threshold}km`;
        // Scatta se è entro la soglia (incluso leggermente oltre = già passato)
        if (kmToGo <= threshold && !notified.has(key)) {
          notified.add(key);
          const isArrivo = cp.name === "Arrivo";
          const isAlreadyPast = kmToGo < 0;
          let msg;
          if (isArrivo) {
            msg = isAlreadyPast
              ? `${athlete.color} *${athlete.name.split(" ")[0]}* ha tagliato il traguardo! 🏁\n(rilevato al km ${kmNow.toFixed(1)})`
              : `${athlete.color} *${athlete.name.split(" ")[0]}* sta per arrivare! 🏁\nManca meno di 1km al traguardo!`;
          } else if (threshold === 5) {
            msg = `${athlete.color} *${athlete.name.split(" ")[0]}* si avvicina a *${cp.name}* — ancora 5km 🏃\n(attualmente al km ${kmNow.toFixed(1)})`;
          } else {
            msg = isAlreadyPast
              ? `${athlete.color} *${athlete.name.split(" ")[0]}* ha passato *${cp.name}*! ✅\n(rilevato al km ${kmNow.toFixed(1)})`
              : `${athlete.color} *${athlete.name.split(" ")[0]}* è quasi a *${cp.name}*! 📍\nManca meno di 1km (al km ${kmNow.toFixed(1)} di ${cp.km})`;
          }
          notifications.push(msg);
          await sendTelegram(msg);
        }
      }
    }
  }

  // Salva stato aggiornato se ci sono nuove notifiche
  if (notifications.length > 0) {
    await saveState([...notified], stateSha);
  }

  return res.status(200).json({
    checked: ATHLETES.length,
    notifications: notifications.length,
    messages: notifications,
    notifiedTotal: notified.size,
    debug: debugLog,
  });
}
