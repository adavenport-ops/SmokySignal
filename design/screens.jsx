// screens.jsx — All SmokySignal screens, kept compact.

const T = window.SS_TOKENS;
const F = window.SS_FONT;

// ─── HOME · A — GLANCEABLE ────────────────────────────────────────────────
function ScreenGlanceable({ goto }) {
  const D = window.SS_DATA, smoky = D.smoky();
  const airborne = D.airborne(), others = airborne.filter(a => a.tail !== 'N305DK');
  const up = smoky.airborne;
  return (
    <div style={{ padding: '8px 18px 100px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
        <span className="ss-eyebrow">SmokySignal · Live</span>
        <span className="ss-mono" style={{ fontSize: 10.5, color: T.fg2 }}>
          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: T.clear, marginRight: 6, verticalAlign: 'middle', animation: 'ss-blink 1.6s infinite' }}/>
          UPDATED 8s AGO
        </span>
      </div>
      {/* Hero */}
      <div style={{
        background: up ? `radial-gradient(120% 80% at 50% 0%, ${T.alertDim}, transparent 70%), ${T.bg1}`
                       : `radial-gradient(120% 80% at 50% 0%, ${T.clearDim}, transparent 70%), ${T.bg1}`,
        border: `.5px solid ${T.hairline}`, borderRadius: 22, padding: '32px 22px 26px',
      }}>
        <div className="ss-eyebrow" style={{ color: up ? T.alert : T.clear }}>
          {up ? 'THE BIRD IS UP' : 'ALL CLEAR'}
        </div>
        <div style={{ fontSize: 60, fontWeight: 800, letterSpacing: '-.04em', lineHeight: 1, marginTop: 10, color: T.fg0 }}>
          Smoky's<br/>
          <span style={{ color: up ? T.alert : T.clear }}>{up ? 'watching.' : 'down.'}</span>
        </div>
        <div style={{ marginTop: 14, fontSize: 14, color: T.fg1, lineHeight: 1.45 }}>
          {up ? <>Circling <b style={{ color: T.fg0 }}>{smoky.corridor}</b> at <span className="ss-mono">{smoky.altitude_ft.toLocaleString()}′</span>. Mind the throttle.</>
              : <>No WSP plane up locally for <b style={{ color: T.fg0 }}>{fmtAgo(smoky.last_seen_min || 95)}</b>. Send it.</>}
        </div>
        {up && (
          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <SSStatusPill kind="alert" label={fmtAloft(smoky.time_aloft_min)} />
            <SSStatusPill kind="alert" label={`${smoky.ground_speed_kt} kt`} />
          </div>
        )}
      </div>
      {/* Others */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 4px 8px' }}>
          <span className="ss-eyebrow">Also airborne</span>
          <span className="ss-mono" style={{ fontSize: 10.5, color: T.fg2 }}>{others.length} ACTIVE</span>
        </div>
        <SSCard padded={false}>
          {others.map((p, i) => (
            <div key={p.tail} onClick={() => goto('detail', p.tail)} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', cursor: 'pointer',
              borderBottom: i === others.length - 1 ? 0 : `.5px solid ${T.hairline}`,
            }}>
              <SSPlaneIcon size={18} kind={planeKindFor(p)} color={T.alert}/>
              <div style={{ flex: 1 }}>
                <div className="ss-mono" style={{ fontSize: 13, fontWeight: 600 }}>{p.tail}
                  {p.nickname && <span style={{ color: T.fg1, fontWeight: 400, marginLeft: 6 }}>"{p.nickname}"</span>}
                </div>
                <div style={{ fontSize: 11, color: T.fg2, marginTop: 1 }}>{p.operator} · {p.corridor}</div>
              </div>
              <div className="ss-mono" style={{ fontSize: 12, color: T.fg1 }}>{p.altitude_ft.toLocaleString()}′</div>
            </div>
          ))}
        </SSCard>
      </div>
      {/* Prediction */}
      <PredictionCard />
    </div>
  );
}

function PredictionCard() {
  const next = window.SS_DATA.PREDICTIONS_TODAY[1];
  return (
    <SSCard>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="ss-eyebrow" style={{ color: T.fg2, marginBottom: 6 }}>Next likely sweep</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: T.fg0 }}>{next.label}</div>
          <div className="ss-mono" style={{ fontSize: 12, color: T.fg1, marginTop: 4 }}>{next.window}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="ss-mono" style={{ fontSize: 22, fontWeight: 700, color: T.alert }}>{Math.round(next.confidence * 100)}%</div>
          <div style={{ fontSize: 9.5, color: T.fg2, letterSpacing: '.08em' }}>CONFIDENCE</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
        {next.zones.map(z => (
          <span key={z} className="ss-mono" style={{ fontSize: 10.5, padding: '3px 8px', borderRadius: 6,
            background: T.bg2, color: T.fg1, border: `.5px solid ${T.hairline}` }}>{z}</span>
        ))}
      </div>
    </SSCard>
  );
}

// ─── HOME · B — RADAR MAP ─────────────────────────────────────────────────
function ScreenRadar({ goto }) {
  const D = window.SS_DATA, smoky = D.smoky(), airborne = D.airborne();
  const up = smoky.airborne;
  const me = { lat: 47.48, lon: -122.20 };
  const hotZones = D.HOT_ZONES.map(z => ({ ...z, ...window.SS_HOT_COORDS[z.id] }));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '12px 16px 12px', borderBottom: `.5px solid ${T.hairline}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <SSStatusPill kind={up ? 'alert' : 'clear'} label={up ? 'SMOKY UP' : 'SMOKY DOWN'} big/>
          <span className="ss-mono" style={{ fontSize: 10.5, color: T.fg2 }}>{airborne.length}/{D.TAIL_REGISTRY.length} AIRBORNE</span>
        </div>
        {up && (
          <div style={{ marginTop: 10, fontSize: 13, color: T.fg1 }}>
            <span style={{ color: T.fg0, fontWeight: 600 }}>{smoky.corridor}</span>
            <span style={{ color: T.fg2 }}> · </span>
            <span className="ss-mono">{smoky.altitude_ft.toLocaleString()}′ · {smoky.ground_speed_kt}kt</span>
          </div>
        )}
      </div>
      <div style={{ position: 'relative', flex: 1, padding: 12 }}>
        <SSRegionMap width={342} height={460} planes={airborne} me={me} hotZones={hotZones}/>
        <div className="ss-mono" style={{ position: 'absolute', top: 22, right: 22, width: 28, height: 28, borderRadius: '50%',
          border: `.5px solid ${T.hairline2}`, background: 'rgba(11,13,16,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: T.fg1 }}>N</div>
      </div>
      <div style={{ padding: '4px 16px 100px' }}>
        <div className="ss-eyebrow" style={{ marginBottom: 8 }}>Up right now · tap to track</div>
        <div className="ss-scroll" style={{ display: 'flex', gap: 10, overflowX: 'auto' }}>
          {airborne.map(p => (
            <div key={p.tail} onClick={() => goto('detail', p.tail)} style={{
              minWidth: 200, padding: 12, borderRadius: 12, background: T.bg1, border: `.5px solid ${T.hairline}`, cursor: 'pointer',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.alert, animation: 'ss-blink 1.6s infinite' }}/>
                <span className="ss-mono" style={{ fontSize: 13, fontWeight: 600 }}>{p.tail}</span>
                {p.nickname && <span style={{ fontSize: 11, color: T.fg1 }}>"{p.nickname}"</span>}
              </div>
              <div style={{ fontSize: 11, color: T.fg2, marginTop: 5 }}>{p.corridor}</div>
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <Stat label="ALT" value={`${p.altitude_ft.toLocaleString()}′`}/>
                <Stat label="GS"  value={`${p.ground_speed_kt}kt`}/>
                <Stat label="TIME" value={`${p.time_aloft_min}m`}/>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="ss-mono" style={{ fontSize: 9.5, color: T.fg2, letterSpacing: '.08em' }}>{label}</div>
      <div className="ss-mono" style={{ fontSize: 12, fontWeight: 600, color: T.fg0, marginTop: 1 }}>{value}</div>
    </div>
  );
}

// ─── HOME · C — DASHBOARD ─────────────────────────────────────────────────
function ScreenDashboard({ goto, mph = 62, limit = 60 }) {
  const D = window.SS_DATA, smoky = D.smoky(), airborne = D.airborne();
  const up = smoky.airborne, speeding = mph > limit;
  const nearestMi = 4.2;
  return (
    <div style={{ padding: '10px 16px 100px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="ss-eyebrow">SmokySignal · Puget Sound</span>
        <SSStatusPill kind={up ? 'alert' : 'clear'} label={up ? 'BIRD UP' : 'CLEAR'} sub={`${airborne.length}/${D.TAIL_REGISTRY.length}`}/>
      </div>

      <SSCard padded={false}>
        <div style={{ padding: 14, display: 'flex', gap: 14, alignItems: 'center' }}>
          <Speedo mph={mph} limit={limit}/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ss-eyebrow">Nearest bird</div>
            <div className="ss-mono" style={{ fontSize: 19, fontWeight: 700, color: up ? T.alert : T.fg1, marginTop: 2 }}>
              {up ? `${nearestMi} mi` : 'NONE'}
            </div>
            <div style={{ fontSize: 11, color: T.fg2, marginTop: 2, lineHeight: 1.4 }}>
              {up ? `${smoky.tail} · ${smoky.corridor}` : 'No aircraft in 25 mi'}
            </div>
            <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 9,
              background: speeding && up ? T.alertDim : T.bg2,
              border: `.5px solid ${speeding && up ? T.alert + '55' : T.hairline}`,
              fontSize: 11.5, color: speeding && up ? T.alert : T.fg1, fontWeight: 600, lineHeight: 1.35,
            }}>
              {speeding && up ? '⚠︎ Bird overhead — ease off.' : speeding ? 'Over limit, but sky is clear.' : 'You\u2019re clean. Ride safe.'}
            </div>
          </div>
        </div>
      </SSCard>

      {/* Smoky card */}
      <SSCard>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="ss-eyebrow" style={{ color: up ? T.alert : T.clear }}>{up ? 'SMOKY · WATCHING' : 'SMOKY · GROUNDED'}</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{up ? smoky.corridor : 'KBFI · Boeing Field'}</div>
            <div className="ss-mono" style={{ fontSize: 11.5, color: T.fg2, marginTop: 4 }}>
              {up ? `${smoky.altitude_ft.toLocaleString()}′ · ${smoky.ground_speed_kt}kt · ${fmtAloft(smoky.time_aloft_min)}` : `last seen ${fmtAgo(smoky.last_seen_min || 95)}`}
            </div>
          </div>
          {up && smoky.track_history && <SSOrbitGlyph size={66} history={smoky.track_history} color={T.alert}/>}
        </div>
        <button onClick={() => goto('detail', 'N305DK')} style={{
          marginTop: 12, width: '100%', padding: '9px 12px', background: T.bg2, color: T.fg0,
          border: `.5px solid ${T.hairline2}`, borderRadius: 9, fontFamily: F.ui, fontSize: 12, fontWeight: 600, cursor: 'pointer',
        }}>Track Smoky →</button>
      </SSCard>

      {/* All airborne */}
      <SSCard padded={false}>
        <div style={{ padding: '12px 14px 8px', display: 'flex', justifyContent: 'space-between' }}>
          <span className="ss-eyebrow">All airborne</span>
          <span className="ss-mono" style={{ fontSize: 10, color: T.fg2 }}>BY DISTANCE</span>
        </div>
        {airborne.map((p, i) => (
          <div key={p.tail} onClick={() => goto('detail', p.tail)} style={{ cursor: 'pointer' }}>
            <SSPlaneRow plane={p}/>
          </div>
        ))}
      </SSCard>

      {/* Activity */}
      <SSCard padded={false}>
        <div style={{ padding: '12px 14px 8px' }}><span className="ss-eyebrow">Recent activity</span></div>
        {D.ACTIVITY_FEED.slice(0, 4).map((e, i) => (
          <div key={i} style={{ padding: '10px 14px', display: 'flex', gap: 10,
            borderTop: `.5px solid ${T.hairline}`, alignItems: 'flex-start' }}>
            <span className="ss-mono" style={{ fontSize: 10, color: T.fg2, minWidth: 52, marginTop: 2 }}>{e.t}</span>
            <span style={{ flex: 1, fontSize: 12, color: T.fg1, lineHeight: 1.4 }}>{e.msg}</span>
          </div>
        ))}
      </SSCard>
    </div>
  );
}

function Speedo({ mph, limit }) {
  const speeding = mph > limit;
  const c = speeding ? T.alert : T.clear;
  const pct = Math.min(1, mph / 100);
  // arc from -135deg to +135deg (270deg total)
  const r = 38, cx = 50, cy = 50;
  const a0 = -135 * Math.PI / 180, a1 = (-135 + 270 * pct) * Math.PI / 180;
  const arcEnd = { x: cx + r * Math.cos(a1), y: cy + r * Math.sin(a1) };
  const arcStart = { x: cx + r * Math.cos(a0), y: cy + r * Math.sin(a0) };
  const large = pct > 0.5 ? 1 : 0;
  return (
    <div style={{ width: 100, height: 100, position: 'relative', flexShrink: 0 }}>
      <svg width="100" height="100" viewBox="0 0 100 100">
        <path d={`M ${arcStart.x} ${arcStart.y} A ${r} ${r} 0 1 1 ${cx + r*Math.cos(135*Math.PI/180)} ${cy + r*Math.sin(135*Math.PI/180)}`}
          fill="none" stroke={T.bg2} strokeWidth="6" strokeLinecap="round"/>
        <path d={`M ${arcStart.x} ${arcStart.y} A ${r} ${r} 0 ${large} 1 ${arcEnd.x} ${arcEnd.y}`}
          fill="none" stroke={c} strokeWidth="6" strokeLinecap="round"/>
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div className="ss-mono" style={{ fontSize: 26, fontWeight: 700, color: c, lineHeight: 1 }}>{mph}</div>
        <div style={{ fontSize: 9, color: T.fg2, marginTop: 2, letterSpacing: '.08em' }}>MPH · LIM {limit}</div>
      </div>
    </div>
  );
}

// ─── PLANE DETAIL ─────────────────────────────────────────────────────────
function ScreenDetail({ tail, goto }) {
  const p = window.SS_DATA.byTail(tail || 'N305DK');
  const up = p.airborne;
  const me = { lat: 47.48, lon: -122.20 };
  return (
    <div style={{ padding: '8px 16px 100px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <button onClick={() => goto('home')} style={{
        background: 'transparent', border: 0, color: T.fg1, fontSize: 13, cursor: 'pointer',
        padding: '6px 0', display: 'flex', alignItems: 'center', gap: 6, fontFamily: F.ui,
      }}>← Back</button>

      {/* Header */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="ss-mono" style={{ fontSize: 28, fontWeight: 700, color: T.fg0, letterSpacing: '-.02em' }}>{p.tail}</span>
          {p.nickname && <span style={{ fontSize: 14, color: T.fg1, fontStyle: 'italic' }}>"{p.nickname}"</span>}
        </div>
        <div style={{ fontSize: 12, color: T.fg2, marginTop: 4 }}>{p.operator} · {p.model} · {p.role}</div>
        <div style={{ marginTop: 10 }}>
          <SSStatusPill kind={up ? 'alert' : 'clear'} big
            label={up ? 'AIRBORNE · WATCHING' : 'GROUNDED'}
            sub={up ? fmtAloft(p.time_aloft_min) : `last seen ${fmtAgo(p.last_seen_min)}`}/>
        </div>
      </div>

      {/* Live data */}
      {up && (
        <SSCard>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <SSOrbitGlyph size={88} history={p.track_history} color={T.alert}/>
            <div style={{ flex: 1 }}>
              <div className="ss-eyebrow">Currently</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{p.corridor}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
                <KV label="ALT" value={`${p.altitude_ft.toLocaleString()}′`}/>
                <KV label="GS" value={`${p.ground_speed_kt} kt`}/>
                <KV label="HDG" value={`${p.heading}°`}/>
                <KV label="ORBIT" value={`${p.orbit_radius_mi} mi`}/>
              </div>
            </div>
          </div>
        </SSCard>
      )}

      {/* Mini map */}
      {up && (
        <div style={{ borderRadius: 14, overflow: 'hidden', border: `.5px solid ${T.hairline}` }}>
          <SSRegionMap width={358} height={240} planes={[p]} me={me}/>
        </div>
      )}

      {/* Pattern history */}
      <SSCard>
        <div className="ss-eyebrow" style={{ marginBottom: 10 }}>Typical haunts</div>
        {[
          { z: 'I-5 · Tukwila',    pct: 42 },
          { z: 'I-405 · Bellevue', pct: 28 },
          { z: 'SR-512 · Lakewood',pct: 14 },
          { z: 'Other',            pct: 16 },
        ].map(b => (
          <div key={b.z} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: T.fg1 }}>
              <span>{b.z}</span><span className="ss-mono">{b.pct}%</span>
            </div>
            <div style={{ height: 4, background: T.bg2, borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
              <div style={{ width: `${b.pct}%`, height: '100%', background: T.alert }}/>
            </div>
          </div>
        ))}
      </SSCard>

      {/* Notify */}
      <SSCard>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Notify when {p.nickname || p.tail} goes up</div>
            <div style={{ fontSize: 11.5, color: T.fg2, marginTop: 3 }}>Web push, instant.</div>
          </div>
          <div style={{ width: 44, height: 26, borderRadius: 999, background: T.alert, position: 'relative' }}>
            <div style={{ position: 'absolute', top: 2, right: 2, width: 22, height: 22, borderRadius: '50%', background: '#fff' }}/>
          </div>
        </div>
      </SSCard>
    </div>
  );
}

function KV({ label, value }) {
  return (
    <div style={{ background: T.bg2, padding: '8px 10px', borderRadius: 8 }}>
      <div className="ss-mono" style={{ fontSize: 9, color: T.fg2, letterSpacing: '.1em' }}>{label}</div>
      <div className="ss-mono" style={{ fontSize: 14, fontWeight: 600, color: T.fg0, marginTop: 2 }}>{value}</div>
    </div>
  );
}

// ─── HOT ZONES ────────────────────────────────────────────────────────────
function ScreenZones({ goto }) {
  const D = window.SS_DATA;
  return (
    <div style={{ padding: '8px 16px 100px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <span className="ss-eyebrow">SmokySignal · Hot zones</span>
        <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>Where they orbit.</div>
        <div style={{ fontSize: 12.5, color: T.fg1, marginTop: 4 }}>30-day pattern data. The bird is not random.</div>
      </div>

      <div style={{ borderRadius: 14, overflow: 'hidden', border: `.5px solid ${T.hairline}` }}>
        <SSRegionMap width={358} height={300} planes={[]}
          hotZones={D.HOT_ZONES.map(z => ({ ...z, ...window.SS_HOT_COORDS[z.id] }))}/>
      </div>

      <SSCard padded={false}>
        {D.HOT_ZONES.map((z, i) => (
          <div key={z.id} style={{
            padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12,
            borderTop: i === 0 ? 0 : `.5px solid ${T.hairline}`,
          }}>
            <div style={{
              width: 8, height: 8, borderRadius: 99,
              background: z.risk === 'high' ? T.alert : z.risk === 'med' ? T.alert + 'aa' : T.fg2,
            }}/>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{z.name}</div>
              <div className="ss-mono" style={{ fontSize: 11, color: T.fg2, marginTop: 2 }}>
                {z.hits} hits · peak: {z.peak}
              </div>
            </div>
            <span className="ss-mono" style={{
              fontSize: 10, padding: '3px 7px', borderRadius: 5, letterSpacing: '.08em',
              background: z.risk === 'high' ? T.alertDim : T.bg2,
              color: z.risk === 'high' ? T.alert : T.fg1,
              border: `.5px solid ${z.risk === 'high' ? T.alert + '55' : T.hairline}`,
            }}>{z.risk.toUpperCase()}</span>
          </div>
        ))}
      </SSCard>

      {/* Today's predictions */}
      <SSCard>
        <div className="ss-eyebrow" style={{ marginBottom: 10 }}>Today's forecast</div>
        {D.PREDICTIONS_TODAY.map((p, i) => (
          <div key={i} style={{
            padding: '10px 0', borderTop: i === 0 ? 0 : `.5px solid ${T.hairline}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{p.label}</span>
              <span className="ss-mono" style={{ fontSize: 12, color: T.alert, fontWeight: 700 }}>{Math.round(p.confidence*100)}%</span>
            </div>
            <div className="ss-mono" style={{ fontSize: 11, color: T.fg1, marginTop: 3 }}>{p.window}</div>
            <div style={{ display: 'flex', gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
              {p.zones.map(z => (
                <span key={z} className="ss-mono" style={{ fontSize: 10, padding: '2px 6px', background: T.bg2, color: T.fg1, borderRadius: 5 }}>{z}</span>
              ))}
            </div>
          </div>
        ))}
      </SSCard>
    </div>
  );
}

// ─── ADMIN: TAIL REGISTRY ─────────────────────────────────────────────────
function ScreenAdmin({ goto }) {
  const D = window.SS_DATA;
  const [showAdd, setShowAdd] = React.useState(false);
  return (
    <div style={{ padding: '8px 16px 100px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <span className="ss-eyebrow">SmokySignal · Admin</span>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>Tail registry</div>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} style={{
          padding: '8px 12px', borderRadius: 8, background: T.alert, color: '#1a1206',
          border: 0, fontFamily: F.ui, fontSize: 12, fontWeight: 700, cursor: 'pointer',
        }}>+ Add tail</button>
      </div>

      {showAdd && (
        <SSCard>
          <div className="ss-eyebrow" style={{ marginBottom: 10 }}>New tail</div>
          {[
            { l: 'Tail #', p: 'N12345' },
            { l: 'Operator', p: 'WSP / KC SO / Pierce' },
            { l: 'Model', p: 'Cessna 182' },
            { l: 'Nickname', p: 'optional' },
          ].map(f => (
            <div key={f.l} style={{ marginBottom: 8 }}>
              <div className="ss-mono" style={{ fontSize: 10, color: T.fg2, marginBottom: 4, letterSpacing: '.08em' }}>{f.l.toUpperCase()}</div>
              <input placeholder={f.p} style={{
                width: '100%', padding: '8px 10px', borderRadius: 8, background: T.bg0,
                border: `.5px solid ${T.hairline2}`, color: T.fg0, fontFamily: F.mono, fontSize: 12.5, outline: 'none',
              }}/>
            </div>
          ))}
          <button style={{
            marginTop: 6, padding: '9px 12px', width: '100%', borderRadius: 8, background: T.fg0, color: '#000',
            border: 0, fontFamily: F.ui, fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}>Save tail</button>
        </SSCard>
      )}

      <SSCard padded={false}>
        {D.TAIL_REGISTRY.map((t, i) => {
          const live = D.LIVE_SNAPSHOT.aircraft.find(a => a.tail === t.tail);
          const up = live?.airborne;
          return (
            <div key={t.tail} style={{
              padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12,
              borderTop: i === 0 ? 0 : `.5px solid ${T.hairline}`,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: 99,
                background: up ? T.alert : T.fg3 }}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ss-mono" style={{ fontSize: 13, fontWeight: 600 }}>{t.tail}
                  {t.nickname && <span style={{ color: T.fg1, fontWeight: 400, marginLeft: 6 }}>"{t.nickname}"</span>}
                </div>
                <div style={{ fontSize: 11, color: T.fg2, marginTop: 1 }}>{t.operator} · {t.model}</div>
              </div>
              <span className="ss-mono" style={{ fontSize: 10, color: up ? T.alert : T.fg2, letterSpacing: '.06em' }}>
                {up ? 'UP' : fmtAgo(live?.last_seen_min || 0)}
              </span>
              <span style={{ color: T.fg2, fontSize: 16 }}>›</span>
            </div>
          );
        })}
      </SSCard>
    </div>
  );
}

// ─── SPEED WARNING (FULLSCREEN) ───────────────────────────────────────────
function ScreenSpeedWarning() {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: `linear-gradient(180deg, ${T.alert} 0%, ${T.alert}cc 70%, ${T.bg0} 100%)`,
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      padding: '40px 20px',
    }}>
      <div style={{ textAlign: 'center', marginTop: 30 }}>
        <div style={{ fontSize: 44, marginBottom: 12 }}>⚠</div>
        <div style={{ fontSize: 36, fontWeight: 800, color: '#1a1206', letterSpacing: '-.03em', lineHeight: 1.05 }}>
          The bird is<br/>watching you.
        </div>
        <div style={{ marginTop: 12, fontSize: 14, color: '#1a1206cc', fontWeight: 500 }}>
          Smoky's orbiting <b>I-5 SB · Tukwila</b><br/>4.2 mi behind you.
        </div>
      </div>
      <div style={{
        background: 'rgba(0,0,0,.85)', borderRadius: 18, padding: '18px 20px',
        color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div className="ss-eyebrow" style={{ color: T.alert }}>YOUR SPEED</div>
          <div className="ss-mono" style={{ fontSize: 56, fontWeight: 700, color: T.alert, lineHeight: 1, marginTop: 4 }}>72</div>
          <div style={{ fontSize: 12, color: T.fg1, marginTop: 4 }}>limit 60 · +12 over</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="ss-eyebrow" style={{ color: T.fg2 }}>EASE TO</div>
          <div className="ss-mono" style={{ fontSize: 38, fontWeight: 700, color: T.clear, lineHeight: 1, marginTop: 4 }}>58</div>
          <div style={{ fontSize: 12, color: T.fg1, marginTop: 4 }}>safe range</div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  ScreenGlanceable, ScreenRadar, ScreenDashboard,
  ScreenDetail, ScreenZones, ScreenAdmin, ScreenSpeedWarning,
});
