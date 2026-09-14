export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch(e) { body = {}; }
  }

  const { event } = body || {};
  const allowedEvents = ["visit", "download"];

  if (!allowedEvents.includes(event)) {
    return res.status(400).json({ error: "Invalid event" });
  }

  const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
  const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

  try {
    await fetch(`${UPSTASH_URL}/incr/stats:${event}:total`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    // Never let stats tracking break the user's experience
    return res.status(200).json({ ok: false });
  }
}
