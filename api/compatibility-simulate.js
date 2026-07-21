module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  return res.status(410).json({
    error: 'Compatibility simulation endpoint is temporarily disabled during algorithm refactor.'
  });
};
