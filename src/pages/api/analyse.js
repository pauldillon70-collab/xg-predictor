// Full pipeline runs server-side so results are cached once per day
// for everyone, instead of per browser tab.

export const config = { maxDuration: 60 };

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

// Extract both teams' real xG from one fixture's statistics
async function getFixtureXgMap(fixtureId) {
  try {
    const stats = await apiFootball(`/fixtures/statistics?fixture=${fixtureId}`);
    const map = {};
    for (const entry of stats) {
      const stat = (entry.statistics || []).find(s => (s.type || '').toLowerCase().replace(/[^a-z]/g, '') === 'expectedgoals');
      const v = stat ? parseFloat(stat.value) : NaN;
      if (entry.team) map[entry.team.id] = Number.isFinite(v) ? v : null;
    }
    return map;
  } catch {
    return {};
  }
}

// Build last-5 form for a set of teams, including real xG for/against
// per game where the league provides it. Everything is best-effort:
// a failed lookup degrades to goals-only form, or no form at all.
async function buildFormMap(teamIds) {
  const lastFixtures = await Promise.all(teamIds.map(async id => {
    try { return [id, await apiFootball(`/fixtures?team=${id}&last=5`)]; }
    catch { return [id, []]; }
  }));
  const teamFixtures = Object.fromEntries(lastFixtures);

  // One statistics call per unique finished fixture (deduped across teams)
  const statIds = [...new Set(
    Object.values(teamFixtures).flat()
      .filter(f => FINISHED.includes(f.fixture.status.short))
      .map(f => f.fixture.id)
  )];
  const statsEntries = await Promise.all(statIds.map(async id => [id, await getFixtureXgMap(id)]));
  const statsMap = Object.fromEntries(statsEntries);

  const formMap = {};
  for (const teamId of teamIds) {
    const fixtures = teamFixtures[teamId] || [];
    let gf = 0, ga = 0, xgf = 0, xga = 0, xgGames = 0;
    const seq = [];
    for (const f of fixtures) {
      const isHome = f.teams.home.id === teamId;
      const mine = isHome ? f.goals.home : f.goals.away;
      const theirs = isHome ? f.goals.away : f.goals.home;
      if (mine === null || theirs === null) continue;
      gf += mine; ga += theirs;
      seq.push(mine > theirs ? 'W' : mine < theirs ? 'L' : 'D');
      const sm = statsMap[f.fixture.id];
      if (sm) {
        const oppId = isHome ? f.teams.away.id : f.teams.home.id;
        if (sm[teamId] != null && sm[oppId] != null) {
          xgf += sm[teamId]; xga += sm[oppId]; xgGames++;
        }
      }
    }
    if (!seq.length) { formMap[teamId] = null; continue; }
    let s = `${seq.join('')}, scored ${gf}, conceded ${ga}`;
    if (xgGames) {
      s += `, xG for ${(xgf / xgGames).toFixed(2)}/game, xG against ${(xga / xgGames).toFixed(2)}/game over ${xgGames} games`;
    }
    formMap[teamId] = s;
  }
  return formMap;
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

  // Happy path: complete array present
  const match = text.match(/\[[\s\S]*\]/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }

  // Salvage path: response was truncated mid-array. Take everything
  // from the first bracket, cut back to the last complete object,
  // and close the array ourselves.
  const start = text.indexOf('[');
  if (start === -1) throw new Error('No JSON array in model response');
  const partial = text.slice(start);
  const lastBrace = partial.lastIndexOf('}');
  if (lastBrace === -1) throw new Error('No complete predictions in model response');
  const repaired = partial.slice(0, lastBrace + 1) + ']';
  try {
    return JSON.parse(repaired);
  } catch {
    throw new Error('Could not parse predictions from model response');
  }
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
    home_id: f.teams.home.id,
    away_id: f.teams.away.id,
    league: f.league.name,
    country: f.league.country,
    kickoff: f.fixture.date, // full ISO — client renders local time
  }));

  // Fetch last-5 form (with real xG where available) for every team in the batch
  const teamIds = [...new Set(batch.flatMap(f => [f.home_id, f.away_id]))];
  const formMap = await buildFormMap(teamIds);

  // Predictions echo team names so we can match by name, not position
  const list = batch.map(f => {
    const fh = formMap[f.home_id];
    const fa = formMap[f.away_id];
    const h = fh ? `${f.home} [last 5: ${fh}]` : f.home;
    const a = fa ? `${f.away} [last 5: ${fa}]` : f.away;
    return `${h} vs ${a} (${f.league})`;
  }).join('\n');
  const data = await anthropic({
    model: 'claude-sonnet-4-5',
    max_tokens: 8192,
    system: 'You are a football analyst. Given a list of fixtures, predict xG for each. Many teams include real last-5 form in brackets: result sequence, goals scored and conceded, and where available their REAL xG for and against per game from actual match data. The xG for/against figures are the strongest signal — a team creating 1.8 xG/game is genuinely dangerous regardless of results, and a team conceding 2.0 xG/game is genuinely leaky even if scorelines flattered them. Weight xG form first, then results form, then team quality, league level, and home advantage. Return ONLY a JSON array, no markdown, no text. One object per fixture. Each object MUST repeat the exact home and away team names from the input (WITHOUT the form brackets). Format: [{"home":"Team A","away":"Team B","home_xg":1.5,"away_xg":1.1,"predicted_score":"2-1","favourite":"home"}]. favourite is home/away/draw.',
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

// Fetch real match xG from fixture statistics for a set of finished games.
// xG coverage varies by league — missing values come back as null.
async function getFixtureXg(items) {
  const capped = (items || []).slice(0, 25);
  const out = {};
  await Promise.all(capped.map(async it => {
    try {
      const stats = await apiFootball(`/fixtures/statistics?fixture=${it.fixture_id}`);
      const findXg = teamId => {
        const entry = stats.find(s => s.team && s.team.id === teamId);
        const stat = entry && entry.statistics
          ? entry.statistics.find(s => (s.type || '').toLowerCase().replace(/[^a-z]/g, '') === 'expectedgoals')
          : null;
        const v = stat ? parseFloat(stat.value) : NaN;
        return Number.isFinite(v) ? v : null;
      };
      out[it.fixture_id] = { home_xg: findXg(it.home_id), away_xg: findXg(it.away_id) };
    } catch {
      out[it.fixture_id] = { home_xg: null, away_xg: null };
    }
  }));
  return out;
}

async function getResults(date) {
  const all = await apiFootball(`/fixtures?date=${date}`);
  return all
    .filter(f => FINISHED.includes(f.fixture.status.short))
    .map(f => ({
      fixture_id: f.fixture.id,
      home: f.teams.home.name,
      away: f.teams.away.name,
      home_id: f.teams.home.id,
      away_id: f.teams.away.id,
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

    if (type === 'xg') {
      const xg = await getFixtureXg(req.body.items);
      return res.status(200).json({ xg });
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
