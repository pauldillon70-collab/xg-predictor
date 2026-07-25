export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { type, date, leagueIds } = req.body;

  // API-Football: fetch today's real fixtures
  if (type === 'fixtures') {
    try {
      const promises = leagueIds.map(id =>
        fetch(`https://v3.football.api-sports.io/fixtures?date=${date}&league=${id}`, {
          headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY }
        }).then(r => r.json())
      );
      const results = await Promise.all(promises);
      const fixtures = results.flatMap(r => r.response || []);
      return res.status(200).json({ fixtures });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Anthropic: xG predictions
  if (type === 'predict') {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(req.body.payload)
      });
      const data = await response.json();
      return res.status(response.status).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Anthropic: fallback fixture search (non-today dates)
  if (type === 'search') {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(req.body.payload)
      });
      const data = await response.json();
      return res.status(response.status).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: 'Unknown request type' });
}
