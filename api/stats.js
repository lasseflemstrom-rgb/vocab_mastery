export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { key } = req.query;

  if (!key || key !== process.env.STATS_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
  const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

  async function getCount(statKey) {
    const r = await fetch(`${UPSTASH_URL}/get/${statKey}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
    });
    const d = await r.json();
    return parseInt(d.result || "0", 10);
  }

  try {
    const [visits, downloads, feedbackChecks] = await Promise.all([
      getCount("stats:visit:total"),
      getCount("stats:download:total"),
      getCount("stats:feedback:total"),
    ]);
    return res.status(200).json({ visits, downloads, feedbackChecks });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
