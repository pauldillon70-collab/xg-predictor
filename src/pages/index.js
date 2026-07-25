import { useState } from 'react';

const cache = {};

export default function Home() {
  const today = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState('');
  const [fixtures, setFixtures] = useState([]);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState('');
  const [dataSource, setDataSource] = useState('');

  async function callPredict(fixtureList) {
    const list = fixtureList.map(f => `${f.home} vs ${f.away} (${f.league})`).join('\n');
    const res = await fetch('/api/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'predict',
        payload: {
          model: 'claude-sonnet-4-5',
          max_tokens: 2048,
          system: 'You are a football analyst. Given a list of fixtures, predict xG for each. Return ONLY a JSON array, no markdown, no text. One object per fixture in the same order. Format: [{"home_xg":1.5,"away_xg":1.1,"predicted_score":"2-1","favourite":"home"}]. favourite is home/away/draw. Base on team quality, league, home advantage, current form.',
          messages: [{ role: 'user', content: `Predict xG for all these fixtures:\n${list}\n\nReturn only the JSON array with exactly ${fixtureList.length} entries in order.` }]
        }
      })
    });
    const data = await res.json();
    const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('Could not parse predictions');
    return JSON.parse(match[0]);
  }

  async function callSearch(date) {
    const res = await fetch('/api/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'search',
        payload: {
          model: 'claude-sonnet-4-5',
          max_tokens: 2048,
          system: 'You are a football analyst. Find the top 20 most high-profile football fixtures on the given date worldwide across all leagues. Return ONLY a JSON array, no markdown. Format: [{"home":"Team","away":"Team","league":"League","time":"HH:MM UTC","home_xg":1.5,"away_xg":1.1,"predicted_score":"2-1","favourite":"home"}]. Sort by combined xG descending. favourite is home/away/draw.',
          messages: [{ role: 'user', content: `Find top 20 football fixtures for ${date} worldwide sorted by predicted xG. Return only the JSON array.` }]
        }
      })
    });
    const data = await res.json();
    const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    return JSON.parse(match[0]);
  }

  async function runSearch() {
    if (!date) return setError('Please select a date.');
    const cacheKey = date;
    setError(''); setSearched(date);

    if (cache[cacheKey]) {
      setFixtures(cache[cacheKey]);
      setDataSource(cache[cacheKey + '_src'] || '');
      return;
    }

    setFixtures([]); setLoading(true);

    try {
      if (date === today) {
        // Step 1: get all fixtures from API-Football
        setStage('Fetching today\'s fixtures...');
        const res = await fetch('/api/analyse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'fixtures', date })
        });
        const data = await res.json();
        const allFixtures = data.fixtures || [];

        if (!allFixtures.length) {
          setError('No fixtures found for today.');
          setLoading(false);
          return;
        }

        // Step 2: format all fixtures
        const formatted = allFixtures.filter(f => !["FT","AET","PEN","AWD","WO","1H","2H","HT","ET","P","LIVE","INT"].includes(f.fixture.status.short)).map(f => ({
          home: f.teams.home.name,
          away: f.teams.away.name,
          league: f.league.name,
          country: f.league.country,
          time: new Date(f.fixture.date).toISOString().slice(11, 16) + ' UTC',
          status: f.fixture.status.short,
          home_score: f.goals.home,
          away_score: f.goals.away,
        }));

        // Step 3: get xG predictions for all fixtures in batches of 20
        setStage('Generating xG predictions...');
        const batch = formatted.slice(0, 40); // limit to 40 for token budget
        const predictions = await callPredict(batch);

        // Step 4: combine and sort by total xG descending, take top 20
        const combined = batch.map((f, i) => ({
          ...f,
          home_xg: predictions[i]?.home_xg ?? 1.2,
          away_xg: predictions[i]?.away_xg ?? 1.0,
          predicted_score: predictions[i]?.predicted_score ?? '1-1',
          favourite: predictions[i]?.favourite ?? 'draw',
          total_xg: (predictions[i]?.home_xg ?? 1.2) + (predictions[i]?.away_xg ?? 1.0),
        }));

        combined.sort((a, b) => b.total_xg - a.total_xg);
        const top20 = combined.slice(0, 20);

        cache[cacheKey] = top20;
        cache[cacheKey + '_src'] = 'live';
        setDataSource('live');
        setFixtures(top20);
      } else {
        setStage('Searching for fixtures...');
        const results = await callSearch(date);
        if (!results.length) {
          setError('No fixtures found for this date.');
          setLoading(false);
          return;
        }
        results.sort((a, b) => (b.home_xg + b.away_xg) - (a.home_xg + a.away_xg));
        cache[cacheKey] = results;
        cache[cacheKey + '_src'] = 'claude';
        setDataSource('claude');
        setFixtures(results);
      }
    } catch(e) { setError('Error: ' + e.message); }
    setLoading(false);
    setStage('');
  }

  const maxXG = fixtures.length ? Math.max(...fixtures.map(f => Math.max(f.home_xg || 0, f.away_xg || 0))) : 3;
  const isLive = f => ['1H','2H','HT','ET','P','LIVE'].includes(f.status);
  const isFinished = f => ['FT','AET','PEN'].includes(f.status);

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
        .content { padding: 24px; max-width: 960px; margin: 0 auto; }
        .date-row { display: flex; gap: 10px; align-items: center; margin-bottom: 24px; margin-top: 20px; flex-wrap: wrap; }
        input[type=date] { background: #111827; border: 1px solid #1e2540; border-radius: 6px; padding: 10px 14px; font-size: 15px; color: #e8eaf0; outline: none; }
        input[type=date]:focus { border-color: #00e5a0; }
        .go { background: #00e5a0; border: none; border-radius: 6px; padding: 11px 28px; font-weight: 700; font-size: 13px; letter-spacing: 1.5px; text-transform: uppercase; color: #0a0e1a; cursor: pointer; height: 42px; white-space: nowrap; }
        .go:disabled { background: #1e2540; color: #3a4260; cursor: not-allowed; }
        .today-btn { background: none; border: 1px solid #1e2540; border-radius: 6px; padding: 11px 16px; font-size: 12px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: #3a4260; cursor: pointer; height: 42px; }
        .today-btn:hover { color: #5a6380; }
        .stage-msg { font-size: 12px; color: #3a5080; letter-spacing: 0.5px; }
        .badge { font-size: 10px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; padding: 2px 8px; border-radius: 4px; }
        .badge.live { background: #0d1f14; color: #00e5a0; border: 1px solid #004d2a; }
        .badge.ai { background: #0d1420; color: #6090d0; border: 1px solid #1e2540; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 12px; }
        .card { background: #111827; border: 1px solid #1e2540; border-radius: 10px; padding: 16px; }
        .card.is-live { border-color: #00e5a0; }
        .card-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .league-tag { font-size: 10px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: #3a5080; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .kick { font-size: 11px; color: #3a4260; flex-shrink: 0; }
        .live-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #00e5a0; margin-right: 4px; animation: pulse 1.5s infinite; }
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.3} }
        .teams { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 14px; }
        .team { flex: 1; min-width: 0; }
        .team.away { text-align: right; }
        .team-name { font-size: 14px; font-weight: 600; color: #c8d0e0; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .team-name.fav { color: #00e5a0; }
        .score-box { background: #0d1220; border: 1px solid #1e2540; border-radius: 6px; padding: 6px 12px; text-align: center; flex-shrink: 0; min-width: 60px; }
        .score-box.is-live { border-color: #00e5a0; }
        .score { font-size: 20px; font-weight: 700; color: #fff; letter-spacing: 1px; }
        .score-lbl { font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: #2e3550; margin-top: 1px; }
        .score-lbl.is-live { color: #00e5a0; }
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
        .xg-rank { font-size: 10px; color: #2e3550; font-weight: 600; }
      `}</style>

      <div className="header">
        <div className="header-top">
          <div className="logo">xG</div>
          <div>
            <div className="title">Daily xG Fixtures <span style={{color:'#00e5a0',fontSize:'13px',letterSpacing:'2px'}}>LIVE</span></div>
            <div className="subtitle">Top 20 fixtures by predicted xG · All leagues</div>
          </div>
        </div>
      </div>

      <div className="content">
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
              {dataSource==='claude' && <span className="badge ai">AI predictions</span>}
              <span style={{marginLeft:'auto',fontSize:'10px',color:'#2e3550'}}>{fixtures.length} fixtures · sorted by xG</span>
            </div>
            <div className="grid">
              {fixtures.map((f,i)=>{
                const hp=Math.min(((f.home_xg||0)/maxXG)*100,100);
                const ap=Math.min(((f.away_xg||0)/maxXG)*100,100);
                const live=isLive(f);
                const fin=isFinished(f);
                const hasScore=f.home_score!==null&&f.home_score!==undefined;
                return (
                  <div key={i} className={'card'+(live?' is-live':'')}>
                    <div className="card-top">
                      <span className="league-tag">{f.league}{f.country?' · '+f.country:''}</span>
                      <span className="kick">
                        {live&&<span className="live-dot"/>}
                        {live?'LIVE':fin?'FT':f.time}
                      </span>
                    </div>
                    <div className="teams">
                      <div className="team"><div className={'team-name'+(f.favourite==='home'?' fav':'')}>{f.home}</div></div>
                      <div className={'score-box'+(live?' is-live':'')}>
                        {hasScore?(
                          <><div className="score">{f.home_score}-{f.away_score}</div><div className={'score-lbl'+(live?' is-live':'')}>{live?'live':'result'}</div></>
                        ):(
                          <><div className="score">{f.predicted_score}</div><div className="score-lbl">predicted</div></>
                        )}
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
      </div>
    </>
  );
}
