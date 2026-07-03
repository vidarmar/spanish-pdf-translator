// api/translate.js
// Serverless function (Vercel, Node.js runtime) that proxies translation
// requests to the Claude API. This is the ONLY part of the app that isn't
// pure client-side — it exists solely so the Anthropic API key never has to
// live in browser code. Deploy this alongside the static frontend and set
// ANTHROPIC_API_KEY as an environment variable in the hosting dashboard.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5";
const MAX_TEXT_LENGTH = 12000; // guard against runaway cost per request

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY" });
    return;
  }

  const { text, sourceLang = "es", targetLang = "en" } = req.body ?? {};

  if (typeof text !== "string" || !text.trim()) {
    res.status(400).json({ error: "Missing 'text' to translate" });
    return;
  }
  if (text.length > MAX_TEXT_LENGTH) {
    res.status(400).json({ error: `Text too long (max ${MAX_TEXT_LENGTH} characters per request)` });
    return;
  }

  const prompt = buildTranslationPrompt(text, sourceLang, targetLang);

  try {
    const anthropicRes = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const errBody = await anthropicRes.text().catch(() => "");
      res.status(502).json({ error: `Translation service error (${anthropicRes.status})`, detail: errBody });
      return;
    }

    const data = await anthropicRes.json();
    const translation = (data.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    res.status(200).json({ translation });
  } catch (err) {
    res.status(500).json({ error: "Translation request failed", detail: String(err) });
  }
}

function buildTranslationPrompt(text, sourceLang, targetLang) {
  const langNames = { es: "Spanish", en: "English" };
  const from = langNames[sourceLang] ?? sourceLang;
  const to = langNames[targetLang] ?? targetLang;
  return [
    `Translate the following ${from} text to ${to}.`,
    `This text was extracted from a PDF page, so it may contain OCR artifacts, odd line breaks, or formatting noise — do your best to translate the meaning faithfully.`,
    `Return ONLY the translated text with no preamble, no notes, and no commentary.`,
    ``,
    `---`,
    text,
    `---`,
  ].join("\n");
}
