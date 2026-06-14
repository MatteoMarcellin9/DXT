// survey v2 - 04:06
const GH_TOKEN = process.env.GH_TOKEN;
const GH_REPO  = "MatteoMarcellin9/DXT";
const FILE_PATH = "public/survey-comments.json";

async function loadComments() {
  const r = await fetch(
    `https://api.github.com/repos/${GH_REPO}/contents/${FILE_PATH}`,
    { headers: { "Authorization": `token ${GH_TOKEN}`, "User-Agent": "survey" } }
  );
  if (!r.ok) return { comments: [], sha: null };
  const d = await r.json();
  const content = JSON.parse(atob(d.content.replace(/\n/g,"")));
  return { comments: content.comments || [], sha: d.sha };
}

async function saveComments(comments, sha) {
  const content = btoa(unescape(encodeURIComponent(
    JSON.stringify({ comments, updated: new Date().toISOString() })
  )));
  const body = { message: "Update survey comments", content };
  if (sha) body.sha = sha;
  const r = await fetch(
    `https://api.github.com/repos/${GH_REPO}/contents/${FILE_PATH}`,
    {
      method: "PUT",
      headers: { "Authorization": `token ${GH_TOKEN}`, "Content-Type": "application/json", "User-Agent": "survey" },
      body: JSON.stringify(body)
    }
  );
  return r.ok;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // GET — leggi commenti
  if (req.method === "GET") {
    const { comments } = await loadComments();
    return res.status(200).json({ comments });
  }

  // POST — aggiungi commento
  if (req.method === "POST") {
    const { route, km, category, subcategory, text, author } = req.body;
    if (!route || !text) return res.status(400).json({ error: "missing fields" });
    const { comments, sha } = await loadComments();
    const newComment = {
      id: Date.now(),
      route, km: parseFloat(km) || 0,
      category, subcategory, text,
      author: author || "Anonimo",
      ts: new Date().toISOString()
    };
    comments.push(newComment);
    // Ordina per km
    comments.sort((a,b) => a.km - b.km);
    await saveComments(comments, sha);
    return res.status(200).json({ ok: true, comment: newComment });
  }

  // DELETE — rimuovi commento per id
  if (req.method === "DELETE") {
    const { id } = req.body;
    const { comments, sha } = await loadComments();
    const filtered = comments.filter(c => c.id !== parseInt(id));
    await saveComments(filtered, sha);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "method not allowed" });
}
