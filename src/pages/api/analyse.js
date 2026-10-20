// Full pipeline runs server-side so results are cached once per day
// for everyone, instead of per browser tab.

export const config = { maxDuration: 300 };


const NOT_STARTED_EXCLUDE = ["FT", "AET", "PEN", "AWD", "WO", "1H", "2H", "HT", "ET", "P", "LIVE", "INT"];
const FINISHED = ["FT", "AET", "PEN"];

// Module-level cache. Survives between requests while the serverless
// instance stays warm. TTL keeps predictions fresh-ish through the day.
globalThis.__xgCache = globalThis.__xgCache || {};
const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Space request starts ~240ms apart (~250/min) so we never overrun
// the plan's per-minute rate limit, regardless of concurrency.
let __gate = Promise.resolve();
let __lastStart = 0;
const MIN_SPACING_MS = 220;
function rateGate() {
  __gate = __gate.then(async () => {
    const wait = Math.max(0, __lastStart + MIN_SPACING_MS - Date.now());
    if (wait) await new Promise(r => setTimeout(r, wait));
    __lastStart = Date.now();
  });
  return __gate;
}

async function apiFootball(path, retries = 1) {
  await rateGate();
  const res = await fetch(`https://v3.football.api-sports.io${path}`, {
    headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY }
  });
  if (!res.ok) {
    if (retries > 0 && (res.status === 429 || res.status >= 500)) {
      await new Promise(r => setTimeout(r, 5000));
      return apiFootball(path, retries - 1);
    }
    throw new Error(`API-Football error ${res.status}`);
  }
  const data = await res.json();
  return data.response || [];
}

// Run async work over a list with bounded concurrency, so we never
// blast hundreds of simultaneous requests at the API's rate limits.
async function pooled(items, worker, limit = 12) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await worker(items[idx]);
    }
  }));
  return results;
}

// Paul's formula. Each side is judged only on games played at the same
// venue as this fixture: the home side's last 10 home games and the away
// side's last 10 away games, using real goals. Only finished competitive
// matches played before kickoff count; club friendlies are left out
// because their "home" side is often nominal.
const VENUE_GAMES = 10;
const HISTORY_FETCH = 50;
const round2 = n => Math.round(n * 100) / 100;

async function venueAverages(teamId, venue, beforeIso) {
  let history = [];
  try { history = await apiFootball(`/fixtures?team=${teamId}&last=${HISTORY_FETCH}`); }
  catch { return null; }
  const before = beforeIso ? new Date(beforeIso).getTime() : Infinity;
  const games = history
    .filter(f => FINISHED.includes(f.fixture.status.short))
    .filter(f => !/friendlies/i.test((f.league && f.league.name) || ''))
    .filter(f => new Date(f.fixture.date).getTime() < before)
    .filter(f => venue === 'home' ? f.teams.home.id === teamId : f.teams.away.id === teamId)
    .filter(f => f.goals.home !== null && f.goals.away !== null)
    .sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date))
    .slice(0, VENUE_GAMES);
  if (!games.length) return null;
  let scored = 0, conceded = 0;
  for (const f of games) {
    scored += venue === 'home' ? f.goals.home : f.goals.away;
    conceded += venue === 'home' ? f.goals.away : f.goals.home;
  }
  // Averages are rounded first so every figure on the card can be
  // checked by hand from the ones shown above it.
  const avgScored = round2(scored / games.length);
  const avgConceded = round2(conceded / games.length);
  return { games: games.length, scored: avgScored, conceded: avgConceded, total: round2(avgScored + avgConceded) };
}

// home: the home side's home averages; away: the away side's away averages
function applyFormula(home, away) {
  const total = round2((home.total + away.total) / 2);
  const homeGoals = round2((home.scored + away.conceded) / 2);
  const awayGoals = round2((away.scored + home.conceded) / 2);
  const hs = Math.round(homeGoals);
  const as = Math.round(awayGoals);
  return {
    home_xg: homeGoals,
    away_xg: awayGoals,
    total_xg: total,
    predicted_score: `${hs}-${as}`,
    favourite: hs > as ? 'home' : as > hs ? 'away' : 'draw',
  };
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

// Neutral first pass: from the full worldwide list, pick the 60 fixtures
// most worth evaluating — no hardcoded league priority, no country bias.
async function pickFixtures(upcoming) {
  if (upcoming.length <= 60) return upcoming;
  const lines = upcoming.map((f, i) =>
    `${i}| ${f.teams.home.name} vs ${f.teams.away.name} (${f.league.name}, ${f.league.country})`
  ).join('\n');
  try {
    const data = await anthropic({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      system: 'You are a football analyst. From the numbered fixture list, choose the 60 fixtures most likely to be highest quality and highest scoring, judged on club stature, league standard, and likely goals. Judge every country and league on equal terms — do NOT favour any region. Return ONLY a JSON array of the chosen line numbers, e.g. [3,17,25]. No text, no markdown.',
      messages: [{ role: 'user', content: `Fixtures today:\n${lines}\n\nReturn only the JSON array of 60 line numbers.` }]
    });
    const idx = extractJsonArray(data).filter(n => Number.isInteger(n) && n >= 0 && n < upcoming.length);
    const picked = [...new Set(idx)].slice(0, 60).map(i => upcoming[i]);
    if (picked.length >= 20) return picked;
  } catch {}
  return upcoming.slice(0, 60);
}

const CANCELLED = ["PST", "CANC", "ABD", "AWD", "WO", "SUSP"];

async function runDaily(date) {
  const cached = globalThis.__xgCache[date];
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { fixtures: cached.data, dropped: cached.dropped || 0, cached: true };
  }

  const all = await apiFootball(`/fixtures?date=${date}`);
  if (!all.length) return { fixtures: [], dropped: 0, cached: false };

  // Today: only games that haven't kicked off. Other dates: every game
  // that wasn't called off.
  const today = new Date().toISOString().split('T')[0];
  const pool = date === today
    ? all.filter(f => !NOT_STARTED_EXCLUDE.includes(f.fixture.status.short))
    : all.filter(f => !CANCELLED.includes(f.fixture.status.short));
  if (!pool.length) return { fixtures: [], dropped: 0, cached: false };

  // Claude only chooses which 60 fixtures get calculated
  const picked = await pickFixtures(pool);

  // Two lookups per fixture: home side at home, away side away
  const tasks = picked.flatMap(f => [
    { key: `${f.fixture.id}:home`, teamId: f.teams.home.id, venue: 'home', before: f.fixture.date },
    { key: `${f.fixture.id}:away`, teamId: f.teams.away.id, venue: 'away', before: f.fixture.date },
  ]);
  const results = await pooled(tasks, async t => [t.key, await venueAverages(t.teamId, t.venue, t.before)]);
  const avg = Object.fromEntries(results);

  const combined = [];
  let dropped = 0;
  for (const f of picked) {
    const h = avg[`${f.fixture.id}:home`];
    const a = avg[`${f.fixture.id}:away`];
    if (!h || !a) { dropped++; continue; }
    combined.push({
      home: f.teams.home.name,
      away: f.teams.away.name,
      league: f.league.name,
      country: f.league.country,
      kickoff: f.fixture.date, // full ISO — client renders local time
      ...applyFormula(h, a),
      workings: { home: h, away: a },
    });
  }

  combined.sort((a, b) => b.total_xg - a.total_xg);

  globalThis.__xgCache[date] = { at: Date.now(), data: combined, dropped };
  return { fixtures: combined, dropped, cached: false };
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
