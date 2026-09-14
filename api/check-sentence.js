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

  const { word, definition, sentence } = body || {};

  if (!word || !sentence) {
    return res.status(400).json({ error: `Missing word or sentence — received: ${JSON.stringify(body)}` });
  }

  const prompt = `You are helping a student practice vocabulary. The target word is "${word}"${definition ? ` (definition: ${definition})` : ""}.

The student wrote this sentence:
"${sentence}"

Check two things:
1. Does the sentence use some grammatical form of "${word}" (tense change, plural, noun/verb/adjective conversion, comparative/superlative, etc. all count — it does not need to match the exact stem)?
2. Is that word used correctly and naturally in context, and spelled correctly in whatever form it takes?

Respond with ONLY a JSON object, no other text, in this exact shape:
{"correct": true or false, "wordFormUsed": "the form the student used", "feedback": "one short, encouraging, student-friendly sentence. If incorrect, briefly say why and suggest a fix."}`;

  try {
    const aiText = await callClaude(prompt);
    const cleaned = aiText.replace(/```json|```/g, "").trim();
    let result;
    try {
      result = JSON.parse(cleaned);
    } catch(parseErr) {
      return res.status(502).json({ error: "AI response was not valid JSON" });
    }
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function callClaude(prompt) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }]
    })
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.content.map(b => b.text || "").join("").trim();
}
