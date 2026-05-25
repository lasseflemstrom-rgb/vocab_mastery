export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle body whether it arrives as string or object
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch(e) { body = {}; }
  }

  // Support old format (prompt string) and new format (mode/words/level/topic)
  if (body.prompt && !body.mode) {
    // Old format — just pass straight to Claude
    try {
      const aiText = await callClaude(body.prompt);
      return res.status(200).json({ result: aiText });
    } catch(err) {
      return res.status(500).json({ error: err.message });
    }
  }

  const { words, level, mode, topic, count } = body || {};

  if (!level) {
    return res.status(400).json({ error: `Missing level — received: ${JSON.stringify(body)}` });
  }

  const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
  const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

  async function kvGet(key) {
    const r = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
    });
    const d = await r.json();
    if (!d.result) return null;
    try {
      let val = d.result;
      // Parse as many times as needed until we get an object
      while (typeof val === "string") {
        val = JSON.parse(val);
      }
      return val;
    } catch(e) {
      return null;
    }
  }

  async function kvSet(key, value) {
    await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(JSON.stringify(value))
    });
  }

  try {
    let results = [];
    let fromCache = 0;
    let fromAI = 0;

    if (mode === "words") {
      if (!words || !words.length) {
        return res.status(400).json({ error: "Missing words" });
      }

      let wordsNeededFromAI = [];

      for (const word of words) {
        const cacheKey = `word:${word.toLowerCase().trim()}:${level}`;
        const cached = await kvGet(cacheKey);
        if (cached) {
          results.push(cached);
          fromCache++;
        } else {
          wordsNeededFromAI.push(word);
        }
      }

      if (wordsNeededFromAI.length > 0) {
        const prompt = `You are a vocabulary teacher creating a word list for ${level} students.

For each of the following words, write:
- A clear, student-friendly definition
- A natural example sentence that demonstrates the meaning in context
- A short, vivid memory hint or mnemonic (3–6 words)

Words: ${wordsNeededFromAI.join(", ")}

Respond ONLY with one word per line in this exact format, no headers, no numbering, no extra text:
word | definition | example sentence | memory hint`;

        const aiText = await callClaude(prompt);
        const aiWords = parseWords(aiText);

        for (const w of aiWords) {
          const cacheKey = `word:${w.word.toLowerCase().trim()}:${level}`;
          await kvSet(cacheKey, w);
          results.push(w);
          fromAI++;
        }
      }

      results.sort((a, b) => {
        if (!a || !a.word || !b || !b.word) return 0;
        const ai = words.findIndex(w => w.toLowerCase() === a.word.toLowerCase());
        const bi = words.findIndex(w => w.toLowerCase() === b.word.toLowerCase());
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      });

    } else if (mode === "topic") {
      if (!topic) {
        return res.status(400).json({ error: "Missing topic" });
      }

      const prompt = `You are a vocabulary teacher creating a themed word list about "${topic}" for ${level} students.

Generate exactly ${count || 10} vocabulary words relevant to this topic. For each word write:
- A clear, student-friendly definition
- A natural example sentence that demonstrates the meaning in context
- A short, vivid memory hint or mnemonic (3–6 words)

Respond ONLY with one word per line in this exact format, no headers, no numbering, no extra text:
word | definition | example sentence | memory hint`;

      const aiText = await callClaude(prompt);
      results = parseWords(aiText);
      fromAI = results.length;

      for (const w of results) {
        const cacheKey = `word:${w.word.toLowerCase().trim()}:${level}`;
        const existing = await kvGet(cacheKey);
        if (!existing) {
          await kvSet(cacheKey, w);
        }
      }
    }

    // Return both new format (results array) and old format (result string)
    // so both old and new frontend versions work
    const resultString = results.map(w =>
      `${w.word} | ${w.definition} | ${w.example} | ${w.hint}`
    ).join("\n");

    return res.status(200).json({ results, fromCache, fromAI, result: resultString });

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
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }]
    })
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.content.map(b => b.text || "").join("").trim();
}

function parseWords(raw) {
  return raw.trim().split("\n")
    .map(line => {
      const parts = line.split("|").map(x => x.trim());
      if (!parts[0]) return null;
      return {
        word: parts[0],
        definition: parts[1] || "",
        example: parts[2] || "",
        hint: parts[3] || ""
      };
    })
    .filter(Boolean);
}
