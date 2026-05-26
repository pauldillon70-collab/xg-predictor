import { useState } from 'react';

export default function Home() {
  const [tab, setTab] = useState('match');
  const [mHome, setMHome] = useState('');
  const [mAway, setMAway] = useState('');
  const [mDate, setMDate] = useState('');
  const [pName, setPName] = useState('');
  const [pSeason, setPSeason] = useState('2025-26');
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const [result, setResult] = useState('');
  const [resultLabel, setResultLabel] = useState('');
  const [error, setError] = useState('');

  async function callClaude(system, user) {
    const res = await fetch('/api/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system,
        messages: [{ role: 'user', content: user }]
      })
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || 'API error ' + res.status); }
    const data = await res.json();
    return data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  }

  async function runMatch() {
    if (!mHome || !mAway) return setError('Please enter both team names.');
    setError(''); setResult(''); setLoading(true); setStage(1);
    try {
      const system = 'You are an expert football data analyst. Use web search to find real xG data for the requested match from FBref, SofaScore, WhoScored or FotMob. Find home xG, away xG, shots on target, actual score if played. Produce: match details, xG stats, result verdict or scoreline prediction with win/draw/loss %, key narrative. Under 220 words. Specific with numbers.';
      const user = 'Find xG data for: ' + mHome + ' vs ' + mAway + (mDate ? ' on ' + mDate : ' (most recent or upcoming fixture)') + '. Produce a prediction or post-match xG analysis.';
      setStage(2);
      await new Promise(r => setTimeout(r, 800));
      setStage(3);
      const res = await callClaude(system, user);
      setResultLabel(mHome + ' vs ' + mAway + (mDate ? ' — ' + mDate : ''));
      setResult(res);
    } catch(e) { setError('Error: ' + e.message); }
    setLoading(false); setStage(0);
  }

  async function runPlayer() {
    if (!pName) return setError('Please enter a player name.');
    setError(''); setResult(''); setLoading(true); setStage(1);
    try {
      const system = 'You are a football data analyst. Use web search to find a player real season xG and xA stats from FBref, Understat or WhoScored. Find xG, xA, goals, assists, appearances, team, league. Produce: stats summary, xG over/underperformance, projected final season total, prediction range. Under 220 words.';
      const user = 'Find ' + pName + ' xG and xA stats for the ' + pSeason + ' season and produce a goal prediction and performance analysis.';
      setStage(2);
      await new Promise(r => setTimeout(r, 800));
      setStage(3);
      const res = await callClaude(system, user);
      setResultLabel(pName + ' — ' + pSeason);
      setResult(res);
    } catch(e) { setError('Error: ' + e.message); }
    setLoading(false); setStage(0);
  }

  const stageLabel = ['', 'Searching for xG data...', 'Extracting stats...', 'Running AI model...'];

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: sans-serif; background: #0a0e1a; color: #e8eaf0; min-height: 100vh; }
        .header { background: #0a0e1a; border-bottom: 1px solid #1e2540; padding: 20px 24px 0; }
        .header-top { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
        .logo { width: 36px; height: 36px; background: #00e5a0; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; color: #0a0e1a; }
        .title { font-weight: 700; font-size: 22px; letter-spacing: 1px; color: #fff; text-transform: uppercase; }
        .subtitle { font-size: 12px; color: #5a6380; text-transform: uppercase; margin-top: 1px; }
        .tabs { display: flex; }
        .tab { font-weight: 600; font-size: 13px; letter-spacing: 1px; text-transform: uppercase; padding: 10px 20px; border: none; background: none; color: #5a6380; cursor: pointer; border-bottom: 2px solid transparent; }
        .tab.active { color: #00e5a0; border-bottom-color: #00e5a0; }
        .content { padding: 24px; max-width: 800px; margin: 0 auto; }
        .hint { font-size: 12px; color: #3a4260; margin-bottom: 18px; line-height: 1.6; margin-top: 20px; }
        .row { display: flex; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; align-items: flex-end; }
        .fg { display: flex; flex-direction: column; gap: 5px; flex: 1; min-width: 130px; }
        .fl { font-size: 11px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; color: #5a6380; }
        input, select { background: #111827; border: 1px solid #1e2540; border-radius: 6px; padding: 10px 14px; font-size: 15px; color: #e8eaf0; outline: none; width: 100%; }
        input:focus, select:focus { border-color: #00e5a0; }
        input::placeholder { color: #2e3550; }
        button.go { background: #00e5a0; border: none; border-radius: 6px; padding: 11px 22px; font-weight: 700; font-size: 13px; letter-spacing: 1.5px; text-transform: uppercase; color: #0a0e1a; cursor: pointer; height: 42px; white-space: nowrap; }
        button.go:disabled { background: #1e2540; color: #3a4260; cursor: not-allowed; }
        .pipeline { background: #0d1220; border: 1px solid #1e2540; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
        .pipeline-title { font-size: 11px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; color: #2e3550; margin-bottom: 12px; }
        .stage-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #111827; }
        .stage-row:last-child { border-bottom: none; }
        .stage-num { width: 28px; height: 28px; border-radius: 50%; background: #1e2540; display: flex; align-items: center; justify-content: center; font-size: 13px; flex-shrink: 0; }
        .stage-num.active { background: #00e5a0; color: #0a0e1a; }
        .stage-num.done { background: #004d2a; color: #00e5a0; }
        .stage-text { font-size: 13px; font-weight: 600; text-transform: uppercase; color: #5a6380; }
        .stage-row.active .stage-text { color: #e8eaf0; }
        .result-box { background: #111827; border: 1px solid #1e2540; border-radius: 8px; overflow: hidden; margin-top: 4px; }
        .result-head { background: #0d1220; padding: 10px 16px; border-bottom: 1px solid #1e2540; font-size: 11px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; color: #5a6380; }
        .result-body { padding: 16px; font-size: 14px; line-height: 1.8; color: #8892b0; white-space: pre-wrap; }
        .err { color: #e05555; font-size: 13px; margin-top: 10px; padding: 10px 12px; background: #1a0d0d; border: 1px solid #3a1a1a; border-radius: 6px; }
      `}</style>

      <div className="header">
        <div className="header-top">
          <div className="logo">xG</div>
          <div>
            <div className="title">Goals Predictor <span style={{color:'#00e5a0',fontSize:'13px'}}>LIVE</span></div>
            <div className="subtitle">Web search · Real xG data · AI analysis</div>
          </div>
        </div>
        <div className="tabs">
          <button className={'tab' + (tab==='match'?' active':'')} onClick={() => { setTab('match'); setResult(''); setError(''); }}>Match xG</button>
          <button className={'tab' + (tab==='player'?' active':'')} onClick={() => { setTab('player'); setResult(''); setError(''); }}>Player Stats</button>
        </div>
      </div>

      <div className="content">
        {tab === 'match' && <>
          <p className="hint">Enter any fixture — Claude will search for real xG data and run the prediction model.</p>
          <div className="row">
            <div className="fg"><div className="fl">Home Team</div><input value={mHome} onChange={e=>setMHome(e.target.value)} placeholder="e.g. Saint-Etienne" onKeyDown={e=>e.key==='Enter'&&runMatch()} /></div>
            <div className="fg"><div className="fl">Away Team</div><input value={mAway} onChange={e=>setMAway(e.target.value)} placeholder="e.g. Nice" onKeyDown={e=>e.key==='Enter'&&runMatch()} /></div>
            <div className="fg" style={{flex:'0 0 auto',minWidth:0}}><div className="fl">Date (optional)</div><input value={mDate} onChange={e=>setMDate(e.target.value)} placeholder="e.g. 26 May 2026" style={{width:'160px'}} /></div>
            <button className="go" onClick={runMatch} disabled={loading}>{loading?'Searching...':'Analyse'}</button>
          </div>
        </>}

        {tab === 'player' && <>
          <p className="hint">Search for any player — Claude will find their season xG, xA and predict their final tally.</p>
          <div className="row">
            <div className="fg"><div className="fl">Player Name</div><input value={pName} onChange={e=>setPName(e.target.value)} placeholder="e.g. Cole Palmer" onKeyDown={e=>e.key==='Enter'&&runPlayer()} /></div>
            <div className="fg" style={{flex:'0 0 auto',minWidth:0}}><div className="fl">Season</div><select value={pSeason} onChange={e=>setPSeason(e.target.value)} style={{width:'140px'}}><option value="2025-26">2025/26</option><option value="2024-25">2024/25</option><option value="2023-24">2023/24</option></select></div>
            <button className="go" onClick={runPlayer} disabled={loading}>{loading?'Searching...':'Analyse'}</button>
          </div>
        </>}

        {error && <div className="err">{error}</div>}

        {loading && (
          <div className="pipeline">
            <div className="pipeline-title">Live data pipeline</div>
            {[1,2,3].map(s => (
              <div key={s} className={'stage-row' + (stage===s?' active':'')}>
                <div className={'stage-num' + (stage>s?' done':stage===s?' active':'')}>{stage>s?'✓':s}</div>
                <div className="stage-text">{stageLabel[s]}</div>
              </div>
            ))}
          </div>
        )}

        {result && (
          <div className="result-box">
            <div className="result-head">{resultLabel}</div>
            <div className="result-body">{result}</div>
          </div>
        )}
      </div>
    </>
  );
}
