import { useState, useEffect } from 'react';

const STORE_KEY = 'xg-predictions-v1';

function loadStore() {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}

function saveStore(store) {
  if (typeof window === 'undefined') return;
  // Keep only the most recent 14 dates
  const dates = Object.keys(store).sort().slice(-14);
  const trimmed = {};
  dates.forEach(d => { trimmed[d] = store[d]; });
  try { localStorage.setItem(STORE_KEY, JSON.stringify(trimmed)); } catch {}
}

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export default function Home() {
  const today = new Date().toISOString().split('T')[0];
  const [tab, setTab] = useState('fixtures');
  const [date, setDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState('');
  const [fixtures, setFixtures] = useState([]);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState('');
  const [dataSource, setDataSource] = useState('');
  const [store, setStore] = useState({});
  const [scoring, setScoring] = useState('');
  const [scores, setScores] = useState({});

  useEffect(() => { setStore(loadStore()); }, []);

  function localTime(iso) {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  }

  async function runSearch() {
    if (!date) return setError('Please select a date.');
    setError(''); setSearched(date); setFixtures([]); setLoading(true);

    try {
      if (date === today) {
        setStage('Fetching and predicting...');
        const res = await fetch('/api/analyse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'daily', date })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        const fx = data.fixtures || [];
        if (!fx.length) {
          setError('No upcoming fixtures left today.');
        } else {
          setDataSource(data.cached ? 'cached' : 'live');
          setFixtures(fx);
          // Save today's predictions for accuracy tracking
          const next = { ...loadStore(), [date]: { savedAt: Date.now(), fixtures: fx } };
          saveStore(next);
          setStore(next);
        }
      } else {
        setStage('Searching...');
        const res = await fetch('/api/analyse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'search',
            payload: {
              model: 'claude-sonnet-4-5',
              max_tokens: 2048,
              system: 'You are a football analyst. Find the top 20 most high-profile football fixtures on the given date worldwide. Return ONLY a JSON array, no markdown. Format: [{"home":"Team","away":"Team","league":"League","time":"HH:MM UTC","home_xg":1.5,"away_xg":1.1,"predicted_score":"2-1","favourite":"home"}]. Sort by combined xG descending.',
              messages: [{ role: 'user', content: `Find top 20 football fixtures for ${date} worldwide sorted by predicted xG. Return only the JSON array.` }]
            }
          })
        });
        const data = await res.json();
        if (data.error) throw new Error(typeof data.error === 'string' ? data.error : data.error.message);
        const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
        const m = text.match(/\[[\s\S]*\]/);
        const results = m ? JSON.parse(m[0]) : [];
        if (!results.length) { setError('No fixtures found for this date.'); }
        else {
          results.sort((a, b) => (b.home_xg + b.away_xg) - (a.home_xg + a.away_xg));
          setDataSource('claude');
          setFixtures(results);
        }
      }
    } catch (e) { setError('Error: ' + e.message); }
    setLoading(false);
    setStage('');
  }

  async function scoreDate(d) {
    setScoring(d);
    try {
      const res = await fetch('/api/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'results', date: d })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const results = data.results || [];
      const preds = store[d]?.fixtures || [];

      const rows = [];
      let outcomeRight = 0, exactRight = 0, matched = 0;

      preds.forEach(p => {
        const r = results.find(x => norm(x.home) === norm(p.home) && norm(x.away) === norm(p.away));
        if (!r || r.home_score === null) return;
        matched++;
        const actual = r.home_score > r.away_score ? 'home' : r.away_score > r.home_score ? 'away' : 'draw';
        const outcomeOk = actual === p.favourite;
        const exactOk = p.predicted_score === `${r.home_score}-${r.away_score}`;
        if (outcomeOk) outcomeRight++;
        if (exactOk) exactRight++;
        rows.push({
          home: p.home, away: p.away, league: p.league,
          predicted: p.predicted_score, actual: `${r.home_score}-${r.away_score}`,
          outcomeOk, exactOk
        });
      });

      setScores(s => ({ ...s, [d]: { rows, matched, outcomeRight, exactRight, total: preds.length } }));
    } catch (e) {
      setScores(s => ({ ...s, [d]: { error: e.message } }));
    }
    setScoring('');
  }

  const maxXG = fixtures.length ? Math.max(...fixtures.map(f => Math.max(f.home_xg || 0, f.away_xg || 0))) : 3;
  const storedDates = Object.keys(store).filter(d => d !== today).sort().reverse();

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: sans-serif; background: #0a0e1a; color: #e8eaf0; min-height: 100vh; }
        .header { background: #0a0e1a; border-bottom: 1px solid #1e2540; padding: 20px 24px 0; }
        .header-top { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
        .logo { width: 36px; height: 36px; background: #00e5a0; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; color: #0a0e1a; flex-shrink:0; }
        .title { font-weight: 700; font-size: 22px; letter-spacing: 1px; color: #fff; text-transform: uppercase; }
        .subtitle { font-size: 12px; color: #5a6380; text-transform: uppercase; margin-top: 1px; }
        .tabs { display: flex; }
        .tabbtn { font-weight: 600; font-size: 13px; letter-spacing: 1px; text-transform: uppercase; padding: 10px 20px; border: none; background: none; color: #5a6380; cursor: pointer; border-bottom: 2px solid transparent; }
        .tabbtn.active { color: #00e5a0; border-bottom-color: #00e5a0; }
        .content { padding: 24px; max-width: 960px; margin: 0 auto; }
        .date-row { display: flex; gap: 10px; align-items: center; margin-bottom: 24px; flex-wrap: wrap; }
        input[type=date] { background: #111827; border: 1px solid #1e2540; border-radius: 6px; padding: 10px 14px; font-size: 15px; color: #e8eaf0; outline: none; }
        input[type=date]:focus { border-color: #00e5a0; }
        .go { background: #00e5a0; border: none; border-radius: 6px; padding: 11px 28px; font-weight: 700; font-size: 13px; letter-spacing: 1.5px; text-transform: uppercase; color: #0a0e1a; cursor: pointer; height: 42px; white-space: nowrap; }
        .go:disabled { background: #1e2540; color: #3a4260; cursor: not-allowed; }
        .today-btn { background: none; border: 1px solid #1e2540; border-radius: 6px; padding: 11px 16px; font-size: 12px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: #3a4260; cursor: pointer; height: 42px; }
        .stage-msg { font-size: 12px; color: #3a5080; }
        .badge { font-size: 10px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; padding: 2px 8px; border-radius: 4px; }
        .badge.live { background: #0d1f14; color: #00e5a0; border: 1px solid #004d2a; }
        .badge.cached { background: #0d1a20; color: #40b0c0; border: 1px solid #1a3a44; }
        .badge.ai { background: #0d1420; color: #6090d0; border: 1px solid #1e2540; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 12px; }
        .card { background: #111827; border: 1px solid #1e2540; border-radius: 10px; padding: 16px; }
        .card-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .league-tag { font-size: 10px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: #3a5080; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .kick { font-size: 11px; color: #3a4260; flex-shrink: 0; }
        .teams { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 14px; }
        .team { flex: 1; min-width: 0; }
        .team.away { text-align: right; }
        .team-name { font-size: 14px; font-weight: 600; color: #c8d0e0; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .team-name.fav { color: #00e5a0; }
        .score-box { background: #0d1220; border: 1px solid #1e2540; border-radius: 6px; padding: 6px 12px; text-align: center; flex-shrink: 0; min-width: 60px; }
        .score { font-size: 20px; font-weight: 700; color: #fff; letter-spacing: 1px; }
        .score-lbl { font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: #2e3550; margin-top: 1px; }
        .xg-section { border-top: 1px solid #1e2540; padding-top: 12px; }
        .xg-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
        .xg-lbl { font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: #3a4260; }
        .xg-vals { display: flex; gap: 12px; align-items: center; }
        .xg-val { font-size: 13px; font-weight: 700; }
        .xg-val.h { color: #00e5a0; }
        .xg-val.a { color: #6090d0; }
        .bars { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .bar-wrap { display: flex; flex-direction: column; }
        .bar-lbl { font-size: 9px; color: #2e3550; margin-bottom: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .bar-bg { background: #1e2540; border-radius: 3px; height: 5px; }
        .bar-fill { border-radius: 3px; height: 5px; }
        .skeletons { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 12px; }
        .skeleton { background: #111827; border: 1px solid #1e2540; border-radius: 10px; height: 160px; position: relative; overflow: hidden; }
        .skeleton::after { content:''; position:absolute; inset:0; background:linear-gradient(90deg,transparent 0%,#1e2540 50%,transparent 100%); animation:shimmer 1.5s infinite; }
        @keyframes shimmer { 0%{transform:translateX(-100%)}100%{transform:translateX(100%)} }
        .err { color:#e05555; font-size:13px; padding:10px 12px; background:#1a0d0d; border:1px solid #3a1a1a; border-radius:6px; margin-bottom:16px; }
        .date-heading { font-size:11px; font-weight:600; letter-spacing:2px; text-transform:uppercase; color:#2e3550; margin-bottom:16px; display:flex; align-items:center; gap:10px; }
        .acc-block { background:#111827; border:1px solid #1e2540; border-radius:10px; padding:16px; margin-bottom:12px; }
        .acc-head { display:flex; justify-content:space-between; align-items:center; }
        .acc-date { font-size:14px; font-weight:600; color:#c8d0e0; }
        .acc-sub { font-size:11px; color:#3a4260; margin-top:2px; }
        .score-btn { background:none; border:1px solid #00e5a0; border-radius:6px; padding:6px 14px; font-size:11px; font-weight:600; letter-spacing:1px; text-transform:uppercase; color:#00e5a0; cursor:pointer; }
        .score-btn:disabled { border-color:#1e2540; color:#3a4260; cursor:wait; }
        .acc-summary { display:flex; gap:20px; margin-top:12px; padding-top:12px; border-top:1px solid #1e2540; }
        .acc-stat { text-align:center; }
        .acc-num { font-size:22px; font-weight:700; color:#00e5a0; }
        .acc-num.dim { color:#6090d0; }
        .acc-cap { font-size:9px; letter-spacing:1px; text-transform:uppercase; color:#3a4260; margin-top:2px; }
        .acc-rows { margin-top:12px; }
        .acc-row { display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid #0d1220; font-size:12px; }
        .acc-row:last-child { border-bottom:none; }
        .acc-match { color:#8892b0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; }
        .acc-res { display:flex; gap:10px; align-items:center; flex-shrink:0; }
        .acc-pred { color:#3a5080; }
        .acc-act { color:#c8d0e0; font-weight:600; }
        .tick { color:#00e5a0; }
        .cross { color:#e05555; }
        .note { font-size:12px; color:#3a4260; line-height:1.6; margin-bottom:16px; }
        .empty { text-align:center; padding:40px 20px; color:#3a4260; font-size:14px; }
      `}</style>

      <div className="header">
        <div className="header-top">
          <div className="logo">xG</div>
          <div>
            <div className="title">Daily xG Fixtures <span style={{color:'#00e5a0',fontSize:'13px',letterSpacing:'2px'}}>LIVE</span></div>
            <div className="subtitle">Top 20 upcoming fixtures by predicted xG</div>
          </div>
        </div>
        <div className="tabs">
          <button className={'tabbtn'+(tab==='fixtures'?' active':'')} onClick={()=>setTab('fixtures')}>Fixtures</button>
          <button className={'tabbtn'+(tab==='accuracy'?' active':'')} onClick={()=>setTab('accuracy')}>Accuracy</button>
        </div>
      </div>

      <div className="content">
        {tab === 'fixtures' && <>
          <div className="date-row">
            <input type="date" value={date} onChange={e=>setDate(e.target.value)} />
            <button className="today-btn" onClick={()=>setDate(today)}>Today</button>
            <button className="go" onClick={runSearch} disabled={loading}>{loading?'Loading...':'Get Fixtures →'}</button>
            {loading && stage && <span className="stage-msg">{stage}</span>}
          </div>

          {error && <div className="err">{error}</div>}
          {loading && <div className="skeletons">{[...Array(8)].map((_,i)=><div key={i} className="skeleton"/>)}</div>}

          {!loading && fixtures.length>0 && (
            <>
              <div className="date-heading">
                {new Date(searched+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}
                {dataSource==='live' && <span className="badge live">Live data</span>}
                {dataSource==='cached' && <span className="badge cached">Cached</span>}
                {dataSource==='claude' && <span className="badge ai">AI predictions</span>}
                <span style={{marginLeft:'auto',fontSize:'10px',color:'#2e3550'}}>{fixtures.length} fixtures · sorted by xG</span>
              </div>
              <div className="grid">
                {fixtures.map((f,i)=>{
                  const hp=Math.min(((f.home_xg||0)/maxXG)*100,100);
                  const ap=Math.min(((f.away_xg||0)/maxXG)*100,100);
                  const kick = f.kickoff ? localTime(f.kickoff) : f.time;
                  return (
                    <div key={i} className="card">
                      <div className="card-top">
                        <span className="league-tag">{f.league}{f.country?' · '+f.country:''}</span>
                        <span className="kick">{kick}</span>
                      </div>
                      <div className="teams">
                        <div className="team"><div className={'team-name'+(f.favourite==='home'?' fav':'')}>{f.home}</div></div>
                        <div className="score-box">
                          <div className="score">{f.predicted_score}</div>
                          <div className="score-lbl">predicted</div>
                        </div>
                        <div className="team away"><div className={'team-name'+(f.favourite==='away'?' fav':'')}>{f.away}</div></div>
                      </div>
                      <div className="xg-section">
                        <div className="xg-row">
                          <span className="xg-lbl">xG Prediction</span>
                          <div className="xg-vals">
                            <span className="xg-val h">{f.home_xg} xG</span>
                            <span style={{color:'#2e3550',fontSize:'11px'}}>vs</span>
                            <span className="xg-val a">{f.away_xg} xG</span>
                          </div>
                        </div>
                        <div className="bars">
                          <div className="bar-wrap"><div className="bar-lbl">{f.home}</div><div className="bar-bg"><div className="bar-fill" style={{width:hp+'%',background:'#00e5a0'}}/></div></div>
                          <div className="bar-wrap"><div className="bar-lbl" style={{textAlign:'right'}}>{f.away}</div><div className="bar-bg"><div className="bar-fill" style={{width:ap+'%',background:'#6090d0'}}/></div></div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>}

        {tab === 'accuracy' && <>
          <p className="note">
            Each day's predictions are saved automatically when you load today's fixtures. Come back the next day and hit
            Score to compare them against the real results. Note: the API-Football free plan only serves results within
            about a day, so score each day promptly — yesterday works, last week won't.
          </p>

          {!storedDates.length && <div className="empty">No saved predictions yet. Load today's fixtures first, then come back tomorrow.</div>}

          {storedDates.map(d => {
            const s = scores[d];
            const preds = store[d]?.fixtures || [];
            return (
              <div key={d} className="acc-block">
                <div className="acc-head">
                  <div>
                    <div className="acc-date">{new Date(d+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'})}</div>
                    <div className="acc-sub">{preds.length} predictions saved</div>
                  </div>
                  <button className="score-btn" onClick={()=>scoreDate(d)} disabled={scoring===d}>
                    {scoring===d ? 'Scoring...' : s ? 'Re-score' : 'Score'}
                  </button>
                </div>

                {s && s.error && <div className="err" style={{marginTop:'12px'}}>{s.error}</div>}

                {s && !s.error && (
                  <>
                    <div className="acc-summary">
                      <div className="acc-stat">
                        <div className="acc-num">{s.matched ? Math.round((s.outcomeRight/s.matched)*100) : 0}%</div>
                        <div className="acc-cap">Outcome right</div>
                      </div>
                      <div className="acc-stat">
                        <div className="acc-num dim">{s.exactRight}</div>
                        <div className="acc-cap">Exact scores</div>
                      </div>
                      <div className="acc-stat">
                        <div className="acc-num" style={{color:'#5a6380'}}>{s.matched}/{s.total}</div>
                        <div className="acc-cap">Matched</div>
                      </div>
                    </div>
                    {s.rows.length > 0 && (
                      <div className="acc-rows">
                        {s.rows.map((r,i)=>(
                          <div key={i} className="acc-row">
                            <span className="acc-match">{r.home} v {r.away}</span>
                            <span className="acc-res">
                              <span className="acc-pred">{r.predicted}</span>
                              <span className="acc-act">{r.actual}</span>
                              <span className={r.outcomeOk?'tick':'cross'}>{r.outcomeOk?'✓':'✗'}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </>}
      </div>
    </>
  );
}
