// Full pipeline runs server-side so results are cached once per day
// for everyone, instead of per browser tab.

// League priority ladder — lower number = higher priority for the 40
// prediction slots. All English, Scottish, and European competitions
// rank above everything else; unknown leagues fall to 999.
const LEAGUE_PRIORITY = {
  // European competitions
  2: 1,    // Champions League
  3: 2,    // Europa League
  848: 3,  // Conference League
  1: 4,    // World Cup
  4: 5,    // Euros

  // Premier League and English cups
  39: 10,  // Premier League
  45: 11,  // FA Cup
  48: 12,  // League Cup

  // Top European domestic leagues
  140: 13, // La Liga
  135: 14, // Serie A
  78: 15,  // Bundesliga
  61: 16,  // Ligue 1

  // English and Scottish pyramid
  40: 20,  // Championship
  179: 21, // Scottish Premiership
  41: 22,  // League One
  42: 23,  // League Two
  43: 24,  // National League
  180: 25, // Scottish Championship
  181: 26, // Scottish League One

  // Strong European leagues
  88: 30,  // Eredivisie
  94: 31,  // Primeira Liga
  144: 32, // Belgian Pro League
  203: 33, // Turkish Süper Lig

  // European domestic cups
  143: 34, // Copa del Rey
  137: 35, // Coppa Italia
  81: 36,  // DFB Pokal
  66: 37,  // Coupe de France

  // European second divisions
  62: 40,  // Ligue 2
  79: 41,  // Bundesliga 2
  89: 42,  // Eerste Divisie

  // Rest of Europe
  207: 50, // Swiss Super League
  218: 51, // Austrian Bundesliga
  197: 52, // Greek Super League
  119: 53, // Danish Superliga
  103: 54, // Eliteserien
  113: 55, // Allsvenskan
  244: 56, // Finnish Veikkausliiga
  345: 57, // Czech First League
  106: 58, // Polish Ekstraklasa
  283: 59, // Romanian Liga 1
  210: 60, // Croatian HNL
  441: 61, // Slovenian PrvaLiga
  357: 62, // Irish Premier League

  // Major non-European
  253: 100, // MLS
  262: 101, // Liga MX
  71: 102,  // Brazilian Série A
  128: 103, // Argentine Primera
  307: 104, // Saudi Pro League
  98: 105,  // J1 League
  13: 106,  // Copa Libertadores
  11: 107,  // Copa Sudamericana

  // Other covered leagues
  384: 200, // Israeli Premier League
  169: 201, // Chinese Super League
  142: 202, // Malaysian Super League
  909: 203, // MLS Next Pro
};

function leaguePriority(id) {
  return LEAGUE_PRIORITY[id] ?? 999;
}

const NOT_STARTED_EXCLUDE = ["FT", "AET", "PEN", "AWD", "WO", "1H", "2H", "HT", "ET", "P", "LIVE", "INT"];
const FINISHED = ["FT", "AET", "PEN"];

// Module-level cache. Survives between requests while the serverless
// instance stays warm. TTL keeps predictions fresh-ish through the day.
globalThis.__xgCache = globalThis.__xgCache || {};
const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function apiFootball(path) {
  const res = await fetch(`https://v3.football.api-sports.io${path}`, {
    headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY }
  });
  if (!res.ok) throw new Error(`API-Football error ${res.status}`);
  const data = await res.json();
  return data.response || [];
}

async function anthropic(payload) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Anthropic error ${res.status}`);
  return data;
}

function extractJsonArray(data) {
  const text = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('No JSON array in model response');
  return JSON.parse(match[0]);
}

async function runDaily(date) {
  const cached = globalThis.__xgCache[date];
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { fixtures: cached.data, cached: true };
  }

  const all = await apiFootball(`/fixtures?date=${date}`);
  if (!all.length) return { fixtures: [], cached: false };

  const upcoming = all.filter(f => !NOT_STARTED_EXCLUDE.includes(f.fixture.status.short));
  if (!upcoming.length) return { fixtures: [], cached: false };

  // Rank by league priority tier before slicing, kickoff order within tier
  const ranked = upcoming
    .map((f, idx) => ({ f, idx, pri: leaguePriority(f.league.id) }))
    .sort((a, b) => a.pri - b.pri || a.idx - b.idx)
    .map(x => x.f);

  const batch = ranked.slice(0, 40).map(f => ({
    home: f.teams.home.name,
    away: f.teams.away.name,
    league: f.league.name,
    country: f.league.country,
    kickoff: f.fixture.date, // full ISO — client renders local time
  }));

  // Predictions echo team names so we can match by name, not position
  const list = batch.map(f => `${f.home} vs ${f.away} (${f.league})`).join('\n');
  const data = await anthropic({
    model: 'claude-sonnet-4-5',
    max_tokens: 3000,
    system: 'You are a football analyst. Given a list of fixtures, predict xG for each. Return ONLY a JSON array, no markdown, no text. One object per fixture. Each object MUST repeat the exact home and away team names from the input. Format: [{"home":"Team A","away":"Team B","home_xg":1.5,"away_xg":1.1,"predicted_score":"2-1","favourite":"home"}]. favourite is home/away/draw. Base on team quality, league level, home advantage, current form.',
    messages: [{ role: 'user', content: `Predict xG for all these fixtures:\n${list}\n\nReturn only the JSON array with exactly ${batch.length} entries.` }]
  });
  const preds = extractJsonArray(data);

  // Match predictions to fixtures by team names, fallback to index
  const combined = batch.map((f, i) => {
    let p = preds.find(pr => norm(pr.home) === norm(f.home) && norm(pr.away) === norm(f.away));
    if (!p) p = preds.find(pr => norm(pr.home).includes(norm(f.home).slice(0, 8)) || norm(f.home).includes(norm(pr.home).slice(0, 8)));
    if (!p) p = preds[i] || {};
    const hx = typeof p.home_xg === 'number' ? p.home_xg : 1.2;
    const ax = typeof p.away_xg === 'number' ? p.away_xg : 1.0;
    return {
      ...f,
      home_xg: hx,
      away_xg: ax,
      predicted_score: p.predicted_score || '1-1',
      favourite: p.favourite || 'draw',
      total_xg: hx + ax,
    };
  });

  combined.sort((a, b) => b.total_xg - a.total_xg);
  const top20 = combined.slice(0, 20);

  globalThis.__xgCache[date] = { at: Date.now(), data: top20 };
  return { fixtures: top20, cached: false };
}

async function getResults(date) {
  const all = await apiFootball(`/fixtures?date=${date}`);
  return all
    .filter(f => FINISHED.includes(f.fixture.status.short))
    .map(f => ({
      home: f.teams.home.name,
      away: f.teams.away.name,
      league: f.league.name,
      home_score: f.goals.home,
      away_score: f.goals.away,
    }));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET = Vercel cron warming the cache each morning
  if (req.method === 'GET') {
    try {
      const today = new Date().toISOString().split('T')[0];
      const out = await runDaily(today);
      return res.status(200).json({ ok: true, date: today, count: out.fixtures.length, cached: out.cached });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { type, date } = req.body;

  try {
    if (type === 'daily') {
      const out = await runDaily(date);
      return res.status(200).json(out);
    }

    if (type === 'results') {
      const results = await getResults(date);
      return res.status(200).json({ results });
    }

    if (type === 'search') {
      const data = await anthropic(req.body.payload);
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: 'Unknown request type' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
