import { useState } from 'react';

const cache = {};

const LEAGUES = [
  'Premier League',
  'Championship',
  'League One',
  'League Two',
  'National League',
  'PL2',
  'La Liga',
  'Serie A',
  'Ligue 1',
  'Ligue 2',
  'Bundesliga',
  'Bundesliga 2',
  'Eredivisie',
  'Eerste Divisie',
  'Scottish Premiership',
  'Scottish Championship',
  'Scottish League One',
  'Irish Premier League',
  'MLS',
  'Liga MX',
  'Belgian Pro League',
  'Turkish Süper Lig',
  'Primeira Liga',
  'Swiss Super League',
  'Austrian Bundesliga',
  'Greek Super League',
  'Danish Superliga',
  'Eliteserien',
  'Allsvenskan',
  'Finnish Veikkausliiga',
  'Czech First League',
  'Polish Ekstraklasa',
  'Romanian Liga 1',
  'Croatian HNL',
  'Slovenian PrvaLiga',
  'Israeli Premier League',
  'Saudi Pro League',
  'J1 League',
  'Chinese Super League',
  'Malaysian Super League'
];

const DEFAULT_ON = new Set([
  'Premier League', 'Championship', 'La Liga', 'Serie A', 'Ligue 1', 'Bundesliga',
  'Eredivisie', 'Scottish Premiership', 'MLS'
]);

export default function Home() {
  const today = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [fixtures, setFixtures] = useState([]);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState('');
  const [activeLeagues, setActiveLeagues] = useState(new Set(DEFAULT_ON));
  const [showAll, setShowAll] = useState(false);

  function toggleLeague(l) {
    setActiveLeagues(prev => {
      const next = new Set(prev);
      if (next.has(l)) { if (next.size > 1) next.delete(l); } else next.add(l);
      return next;
    });
  }

  function selectAll() { setActiveLeagues(new Set(LEAGUES)); }
  function clearAll() { setActiveLeagues(new Set(['Premier League'])); }

  const visibleLeagues = showAll ? LEAGUES : LEAGUES.slice(0, 12);

  async function callClaude(system, user) {
    const res = await fetch('/api/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1024,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
        system,
        messages: [{ role: 'user', content: user }]
      })
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || 'API error ' + res.status); }
    const data = await res.json();
    return data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  }

  async function runSearch() {
    if (!date) return setError('Please select a date.');
    const leagueList = [...activeLeagues].join(', ');
    const cacheKey = date + '|' + leagueList;
    setError('');
    setSearched(date);

    if (cache[cacheKey]) {
      setFixtures(cache[cacheKey]);
      return;
    }

    setFixtures([]);
    setLoading(true);

    try {
      const system = `You are a football analyst. Find up to 5 matches on the given date from ONLY these leagues: ${leagueList}. Return ONLY a JSON array, no markdown, no text, no backticks. If fewer than 5 matches exist in those leagues that day, return only what exists. Format: [{"home":"Team","away":"Team","league":"League","time":"HH:MM UTC","home_xg":1.5,"away_xg":1.1,"predicted_score":"2-1","favourite":"home"}]. favourite is home/away/draw. Only include matches from the specified leagues.`;
      const user = `Find football fixtures for ${date} in these leagues only: ${leagueList}. Return only the JSON array.`;
      const result = await callClaude(system, user);

      let parsed;
      try {
        const match = result.match(/\[[\s\S]*\]/);
        if (!match) throw new Error('no array found');
        parsed = JSON.parse(match[0]);
      } catch(e) {
        throw new Error('Could not parse fixture data. Try again.');
      }

      cache[cacheKey] = parsed;
      setFixtures(parsed);
    } catch(e) { setError('Error: ' + e.message); }
    setLoading(false);
  }

  const maxXG = fixtures.length ? Math.max(...fixtures.map(f => Math.max(f.home_xg, f.away_xg))) : 3;

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: sans-serif; background: #0a0e1a; color: #e8eaf0; min-height: 100vh; }
        .header { background: #0a0e1a; border-bottom: 1px solid #1e2540; padding: 20px 24px 16px; }
        .header-top { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
        .logo { width: 36px; height: 36px; background: #00e5a0; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; color: #0a0e1a; flex-shrink:0; }
        .title { font-weight: 700; font-size: 22px; letter-spacing: 1px; color: #fff; text-transform: uppercase; }
        .subtitle { font-size: 12px; color: #5a6380; text-transform: uppercase; margin-top: 1px; }
        .league-controls { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
        .ctrl-btn { font-size: 10px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; background: none; border: 1px solid #1e2540; border-radius: 4px; color: #3a4260; padding: 3px 8px; cursor: pointer; }
        .ctrl-btn:hover { color: #5a6380; border-color: #2e3550; }
        .league-bar { display: flex; flex-wrap: wrap; gap: 6px; }
        .league-pill { font-size: 11px; font-weight: 600; letter-spacing: 0.3px; padding: 4px 10px; border-radius: 20px; border: 1px solid #1e2540; background: #111827; color: #5a6380; cursor: pointer; transition: all 0.15s; white-space: nowrap; }
        .league-pill.on { background: #0d1f14; border-color: #00e5a0; color: #00e5a0; }
        .show-more { font-size: 11px; font-weight: 600; letter-spacing: 0.5px; color: #3a5080; background: none; border: 1px dashed #1e2540; border-radius: 20px; padding: 4px 12px; cursor: pointer; white-space: nowrap; }
        .show-more:hover { color: #5a7090; border-color: #2e3550; }
        .content { padding: 24px; max-width: 900px; margin: 0 auto; }
        .date-row { display: flex; gap: 10px; align-items: flex-end; margin-bottom: 24px; margin-top: 4px; }
        input[type=date] { background: #111827; border: 1px solid #1e2540; border-radius: 6px; padding: 10px 14px; font-size: 15px; color: #e8eaf0; outline: none; flex:1; max-width: 220px; }
        input[type=date]:focus { border-color: #00e5a0; }
        button.go { background: #00e5a0; border: none; border-radius: 6px; padding: 11px 28px; font-weight: 700; font-size: 13px; letter-spacing: 1.5px; text-transform: uppercase; color: #0a0e1a; cursor: pointer; height: 42px; white-space: nowrap; }
        button.go:disabled { background: #1e2540; color: #3a4260; cursor: not-allowed; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 12px; }
        .card { background: #111827; border: 1px solid #1e2540; border-radius: 10px; padding: 16px; }
        .card-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .league-tag { font-size: 10px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; color: #3a5080; }
        .time { font-size: 11px; color: #3a4260; }
        .teams { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 14px; }
        .team { flex: 1; }
        .team.away { text-align: right; }
        .team-name { font-size: 14px; font-weight: 600; color: #c8d0e0; line-height: 1.3; }
        .team-name.fav { color: #00e5a0; }
        .score-box { background: #0d1220; border: 1px solid #1e2540; border-radius: 6px; padding: 6px 12px; text-align: center; flex-shrink: 0; }
        .score { font-size: 20px; font-weight: 700; color: #fff; letter-spacing: 1px; }
        .score-label { font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: #2e3550; margin-top: 1px; }
        .xg-section { border-top: 1px solid #1e2540; padding-top: 12px; }
        .xg-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
        .xg-label { font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: #3a4260; }
        .xg-vals { display: flex; gap: 16px; align-items: center; }
        .xg-val { font-size: 13px; font-weight: 700; }
        .xg-val.home { color: #00e5a0; }
        .xg-val.away { color: #6090d0; }
        .xg-bars { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .xg-bar-wrap { display: flex; flex-direction: column; }
        .xg-bar-label { font-size: 9px; color: #2e3550; margin-bottom: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .bar-bg { background: #1e2540; border-radius: 3px; height: 5px; }
        .bar-fill { border-radius: 3px; height: 5px; }
        .loading-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 12px; }
        .skeleton { background: #111827; border: 1px solid #1e2540; border-radius: 10px; height: 160px; position: relative; overflow: hidden; }
        .skeleton::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent 0%, #1e2540 50%, transparent 100%); animation: shimmer 1.5s infinite; }
        @keyframes shimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(100%)} }
        .err { color: #e05555; font-size: 13px; padding: 10px 12px; background: #1a0d0d; border: 1px solid #3a1a1a; border-radius: 6px; margin-bottom: 16px; }
        .date-heading { font-size: 11px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; color: #2e3550; margin-bottom: 16px; }
        .no-fixtures { text-align: center; padding: 40px 20px; color: #3a4260; font-size: 14px; }
        .active-count { font-size: 10px; color: #3a4260; margin-left: 4px; }
      `}</style>

      <div className="header">
        <div className="header-top">
          <div className="logo">xG</div>
          <div>
            <div className="title">Daily xG Fixtures <span style={{color:'#00e5a0',fontSize:'13px',letterSpacing:'2px'}}>LIVE</span></div>
            <div className="subtitle">xG predictions · {activeLeagues.size} league{activeLeagues.size !== 1 ? 's' : ''} selected</div>
          </div>
        </div>
        <div className="league-controls">
          <button className="ctrl-btn" onClick={selectAll}>All</button>
          <button className="ctrl-btn" onClick={clearAll}>None</button>
        </div>
        <div className="league-bar">
          {visibleLeagues.map(l => (
            <div key={l} className={'league-pill' + (activeLeagues.has(l) ? ' on' : '')} onClick={() => toggleLeague(l)}>{l}</div>
          ))}
          <button className="show-more" onClick={() => setShowAll(v => !v)}>
            {showAll ? '− Show less' : `+ ${LEAGUES.length - 12} more`}
          </button>
        </div>
      </div>

      <div className="content">
        <div className="date-row">
          <input type="date" value={date} onChange={e => setDate(e.target.value)} />
          <button className="go" onClick={runSearch} disabled={loading}>{loading ? 'Searching...' : 'Get Fixtures →'}</button>
        </div>

        {error && <div className="err">{error}</div>}

        {loading && (
          <div className="loading-grid">
            {[...Array(4)].map((_, i) => <div key={i} className="skeleton" />)}
          </div>
        )}

        {!loading && fixtures.length > 0 && (
          <>
            <div className="date-heading">
              {new Date(searched + 'T12:00:00').toLocaleDateString('en-GB', {weekday:'long', day:'numeric', month:'long', year:'numeric'})}
            </div>
            <div className="grid">
              {fixtures.map((f, i) => {
                const homePct = Math.min((f.home_xg / maxXG) * 100, 100);
                const awayPct = Math.min((f.away_xg / maxXG) * 100, 100);
                return (
                  <div key={i} className="card">
                    <div className="card-top">
                      <span className="league-tag">{f.league}</span>
                      <span className="time">{f.time}</span>
                    </div>
                    <div className="teams">
                      <div className="team">
                        <div className={'team-name' + (f.favourite === 'home' ? ' fav' : '')}>{f.home}</div>
                      </div>
                      <div className="score-box">
                        <div className="score">{f.predicted_score}</div>
                        <div className="score-label">predicted</div>
                      </div>
                      <div className="team away">
                        <div className={'team-name' + (f.favourite === 'away' ? ' fav' : '')}>{f.away}</div>
                      </div>
                    </div>
                    <div className="xg-section">
                      <div className="xg-row">
                        <span className="xg-label">Expected Goals</span>
                        <div className="xg-vals">
                          <span className="xg-val home">{f.home_xg} xG</span>
                          <span style={{color:'#2e3550',fontSize:'11px'}}>vs</span>
                          <span className="xg-val away">{f.away_xg} xG</span>
                        </div>
                      </div>
                      <div className="xg-bars">
                        <div className="xg-bar-wrap">
                          <div className="xg-bar-label">{f.home}</div>
                          <div className="bar-bg"><div className="bar-fill" style={{width:homePct+'%',background:'#00e5a0'}}></div></div>
                        </div>
                        <div className="xg-bar-wrap">
                          <div className="xg-bar-label" style={{textAlign:'right'}}>{f.away}</div>
                          <div className="bar-bg"><div className="bar-fill" style={{width:awayPct+'%',background:'#6090d0'}}></div></div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {!loading && searched && fixtures.length === 0 && !error && (
          <div className="no-fixtures">No fixtures found for the selected leagues on this date.</div>
        )}
      </div>
    </>
  );
}
