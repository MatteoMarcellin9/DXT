export default function handler(req, res) {
  res.status(200).json({ version: "v3", time: new Date().toISOString() });
}