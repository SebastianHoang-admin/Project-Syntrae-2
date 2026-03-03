function extractResponseText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }
  const parts = Array.isArray(data?.output) ? data.output : [];
  const text = parts
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .filter((content) => content?.type === 'output_text' || content?.type === 'text')
    .map((content) => content?.text || '')
    .join('\n')
    .trim();
  return text;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

  const { messages } = req.body || {};
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages must be an array' });

  const promptId = process.env.OPENAI_PROMPT_ID;
  const promptVersion = process.env.OPENAI_PROMPT_VERSION;

  const payload = { input: messages };
  if (promptId) {
    payload.prompt = { id: promptId };
    if (promptVersion) payload.prompt.version = String(promptVersion);
  } else {
    // Keep model fallback for local/dev usage until prompt env vars are set.
    payload.model = process.env.OPENAI_MODEL || 'gpt-5-nano';
  }

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await openaiRes.json().catch(() => ({}));
    if (!openaiRes.ok) {
      const message = data?.error?.message || data?.error || 'OpenAI request failed';
      return res.status(openaiRes.status).json({ error: message });
    }

    const reply = extractResponseText(data);
    return res.status(200).json({ reply: reply || 'No reply' });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'OpenAI request failed' });
  }
};
