import { useState } from 'react';

export default function Home() {
  const today = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [fixtures, setFixtures] = useState([]);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState('');

  async function callClaude(system, user) {
    const res = await fetch('/api/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 2048,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
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
    setError(''); setFixtures([]); setLoading(true); setSearched(date);
    try {
      const system = `You are a football data analyst. Search for the top 10 most interesting football fixtures on the requested date across all major worldwide leagues (Premier League, La Liga, Bundesliga, Serie A, Ligue 1, Champions League, Europa League, MLS, Liga MX, Brasileirao, Eredivisie, Primeira Liga, Scottish Prem, etc).

For each fixture return a JSON array. Respond ONLY with a valid JSON array, no markdown, no explanation, no backticks. Format:
[
  {
    "home": "Team Name",
    "away": "Team Name", 
    "league": "League Name",
    "time": "18:45 UTC",
    "home_xg": 1.6,
    "away_xg": 1.1,
    "predicted_score": "2-1",
    "favourite": "home"
  }
]

Base xG predictions on: current season form, head-to-head, home advantage, injuries/suspensions, league position. Pick the 10 most high-profile or interesting matches. If exact xG data is available from FBref or SofaScore use it, otherwise estimate from form. favourite field should be "home", "away", or "draw".`;

      const user = `Find the top 10 football fixtures for ${date} worldwide. Return only the JSON array.`;
      const result = await callClaude(system, user);
      
      let parsed;
      try {
        const clean = result.replace(/```json|```/g, '').trim();
        parsed = JSON.parse(clean);
      } catch(e) {
        throw new Error('Could not parse fixture data. Try again.');
      }
      setFixtures(parsed);
    } catch(e) { setError('Error: ' + e.message); }
    setLoading(false);
  }

  function xgBar(val, max) {
    const pct = Math.min((val / max) * 100, 100);
    return (
      <div style={{background:'#1e2540',borderRadius:'3px',height:'4px',width:'100%',marginTop:'4px'}}>
        <div style={{background:'#00e5a0',borderRadius:'3px',height:'4px',width:pct+'%'}}></div>
      </div>
    );
  }

  const maxXG = fixtures.length ? Math.max(...fixtures.map(f => Math.max(f.home_xg, f.away_xg))) : 3;

  const favColour = (fav, side) => fav === side ? '#00e5a0' : '#8892b0';

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: sans-serif; background: #0a0e1a; color: #e8eaf0; min-height: 100vh; }
        .header { background: #0a0e1a; border-bottom: 1px solid #1e2540; padding: 20px 24px 16px; }
        .header-top { display: flex; align-items: center; gap: 12px; }
        .logo { width: 36px; height: 36px; background: #00e5a0; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; color: #0a0e1a; flex-shrink:0; }
        .title { font-weight: 700; font-size: 22px; letter-spacing: 1px; color: #fff; text-transform: uppercase; }
        .subtitle { font-size: 12px; color: #5a6380; text-transform: uppercase; margin-top: 1px; }
        .content { padding: 24px; max-width: 900px; margin: 0 auto; }
        .date-row { display: flex; gap: 10px; align-items: flex-end; margin-bottom: 24px; margin-top: 20px; }
        input[type=date] { background: #111827; border: 1px solid #1e2540; border-radius: 6px; padding: 10px 14px; font-size: 15px; color: #e8eaf0; outline: none; flex:1; max-width: 220px; }
        input[type=date]:focus { border-color: #00e5a0; }
        button.go { background: #00e5a0; border: none; border-radius: 6px; padding: 11px 28px; font-weight: 700; font-size: 13px; letter-spacing: 1.5px; text-transform: uppercase; color: #0a0e1a; cursor: pointer; height: 42px; white-space: nowrap; }
        button.go:disabled { background: #1e2540; color: #3a4260; cursor: not-allowed; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 12px; }
        .card { background: #111827; border: 1px solid #1e2540; border-radius: 10px; padding: 16px; }
        .card-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .league { font-size: 10px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; color: #3a5080; }
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
        .xg-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
        .xg-label { font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: #3a4260; }
        .xg-vals { display: flex; gap: 16px; align-items: center; }
        .xg-val { font-size: 13px; font-weight: 700; }
        .xg-val.home { color: #00e5a0; }
        .xg-val.away { color: #6090d0; }
        .xg-bars { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 8px; }
        .xg-bar-wrap { display: flex; flex-direction: column; }
        .xg-bar-label { font-size: 9px; color: #2e3550; margin-bottom: 3px; letter-spacing: 0.5px; }
        .bar-bg { background: #1e2540; border-radius: 3px; height: 5px; }
        .bar-fill { border-radius: 3px; height: 5px; }
        .loading-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 12px; }
        .skeleton { background: #111827; border: 1px solid #1e2540; border-radius: 10px; padding: 16px; height: 160px; position: relative; overflow: hidden; }
        .skeleton::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent 0%, #1e2540 50%, transparent 100%); animation: shimmer 1.5s infinite; }
        @keyframes shimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(100%)} }
        .err { color: #e05555; font-size: 13px; padding: 10px 12px; background: #1a0d0d; border: 1px solid #3a1a1a; border-radius: 6px; margin-bottom: 16px; }
        .date-heading { font-size: 11px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; color: #2e3550; margin-bottom: 16px; }
      `}</style>

      <div className="header">
        <div className="header-top">
          <div className="logo">xG</div>
          <div>
            <div className="title">Daily xG Fixtures <span style={{color:'#00e5a0',fontSize:'13px',letterSpacing:'2px'}}>LIVE</span></div>
            <div className="subtitle">Top 10 fixtures · xG predictions · All major leagues</div>
          </div>
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
            {[...Array(6)].map((_, i) => <div key={i} className="skeleton" />)}
          </div>
        )}

        {!loading && fixtures.length > 0 && (
          <>
            <div className="date-heading">Top fixtures — {new Date(searched + 'T12:00:00').toLocaleDateString('en-GB', {weekday:'long', day:'numeric', month:'long', year:'numeric'})}</div>
            <div className="grid">
              {fixtures.map((f, i) => {
                const homeMax = maxXG;
                const homePct = Math.min((f.home_xg / homeMax) * 100, 100);
                const awayPct = Math.min((f.away_xg / homeMax) * 100, 100);
                return (
                  <div key={i} className="card">
                    <div className="card-top">
                      <span className="league">{f.league}</span>
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
      </div>
    </>
  );
}
