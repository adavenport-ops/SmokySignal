// ui.jsx — Shared visual primitives for SmokySignal
// Aesthetic: clean modern + aviation HUD. Near-black bg, off-white fg,
// signal-amber for alert, clear-green for all-clear. Geist Mono for data,
// Inter for chrome.

const SS_TOKENS = {
  // Background ladder
  bg0:    '#0b0d10',          // page (deepest)
  bg1:    '#11141a',          // card surface
  bg2:    '#171b22',          // raised
  bg3:    '#1e232c',          // hover / divider
  // Foreground
  fg0:    '#eef0f3',          // primary text
  fg1:    '#a8adb6',           // secondary
  fg2:    '#6b7280',           // tertiary / labels
  fg3:    '#3f4651',           // disabled / muted
  // Signal
  alert:    '#f5b840',          // amber — Smoky is up
  alertDim: 'rgba(245,184,64,.18)',
  clear:    '#5fcf8a',          // green — all clear
  clearDim: 'rgba(95,207,138,.16)',
  // Sky
  sky:      '#7dd3fc',
  skyDim:   'rgba(125,211,252,.16)',
  // Borders
  hairline: 'rgba(255,255,255,0.06)',
  hairline2:'rgba(255,255,255,0.10)',
};

const SS_FONT = {
  ui:   'Inter, -apple-system, "SF Pro Text", system-ui, sans-serif',
  mono: '"Geist Mono", "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
};

// Inject base styles + fonts once
if (!document.getElementById('ss-base')) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600&display=swap';
  document.head.appendChild(link);
  const s = document.createElement('style');
  s.id = 'ss-base';
  s.textContent = `
    .ss-app * { box-sizing: border-box; }
    .ss-app { font-family: ${SS_FONT.ui}; color: ${SS_TOKENS.fg0}; background: ${SS_TOKENS.bg0}; -webkit-font-smoothing: antialiased; }
    .ss-mono { font-family: ${SS_FONT.mono}; font-feature-settings: "ss01","tnum"; letter-spacing: .02em; }
    .ss-eyebrow { font-family: ${SS_FONT.mono}; font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase; color: ${SS_TOKENS.fg2}; }
    .ss-divider { height: .5px; background: ${SS_TOKENS.hairline}; }
    @keyframes ss-blink { 0%,100%{opacity:1} 50%{opacity:.35} }
    @keyframes ss-pulse { 0%{box-shadow:0 0 0 0 var(--c)} 70%{box-shadow:0 0 0 14px transparent} 100%{box-shadow:0 0 0 0 transparent} }
    @keyframes ss-sweep { 0%{transform:rotate(0)} 100%{transform:rotate(360deg)} }
    @keyframes ss-orbit { 0%{transform:rotate(0deg) translateX(var(--r)) rotate(0deg)} 100%{transform:rotate(360deg) translateX(var(--r)) rotate(-360deg)} }
    .ss-scroll::-webkit-scrollbar { width: 0; height: 0; }
  `;
  document.head.appendChild(s);
}

// ─── Status pill ────────────────────────────────────────────────────────────
function SSStatusPill({ kind = 'clear', label, sub, big = false }) {
  const isAlert = kind === 'alert';
  const c = isAlert ? SS_TOKENS.alert : SS_TOKENS.clear;
  const bg = isAlert ? SS_TOKENS.alertDim : SS_TOKENS.clearDim;
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: big ? '6px 12px' : '4px 9px',
      borderRadius: 999, background: bg,
      border: `.5px solid ${c}55`,
      fontSize: big ? 12 : 11, fontWeight: 600,
      color: c, letterSpacing: '.02em',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: c,
        animation: isAlert ? 'ss-blink 1.4s ease-in-out infinite' : 'none',
        boxShadow: `0 0 8px ${c}`,
      }} />
      <span>{label}</span>
      {sub && <span style={{ color: c, opacity: .65, fontWeight: 400 }}>· {sub}</span>}
    </div>
  );
}

// ─── Card ───────────────────────────────────────────────────────────────────
function SSCard({ children, style = {}, padded = true, raised = false }) {
  return (
    <div style={{
      background: raised ? SS_TOKENS.bg2 : SS_TOKENS.bg1,
      border: `.5px solid ${SS_TOKENS.hairline}`,
      borderRadius: 14,
      padding: padded ? 14 : 0,
      ...style,
    }}>{children}</div>
  );
}

// ─── Plane row (compact) ───────────────────────────────────────────────────
function SSPlaneRow({ plane, onClick }) {
  const up = plane.airborne;
  const c = up ? SS_TOKENS.alert : SS_TOKENS.fg2;
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 14px', cursor: 'pointer',
      borderBottom: `.5px solid ${SS_TOKENS.hairline}`,
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        background: up ? SS_TOKENS.alertDim : SS_TOKENS.bg2,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
      }}>
        <SSPlaneIcon size={18} kind={planeKindFor(plane)} color={c} />
        {up && <span style={{
          position: 'absolute', top: -2, right: -2, width: 8, height: 8, borderRadius: '50%',
          background: SS_TOKENS.alert, boxShadow: `0 0 6px ${SS_TOKENS.alert}`,
          animation: 'ss-blink 1.4s ease-in-out infinite',
        }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span className="ss-mono" style={{ fontSize: 13.5, fontWeight: 600, color: SS_TOKENS.fg0 }}>{plane.tail}</span>
          {plane.nickname && <span style={{ fontSize: 11, color: SS_TOKENS.fg1 }}>"{plane.nickname}"</span>}
        </div>
        <div style={{ fontSize: 11, color: SS_TOKENS.fg2, marginTop: 2 }}>
          {plane.operator} · {plane.model}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        {up ? (
          <>
            <div className="ss-mono" style={{ fontSize: 12, fontWeight: 600, color: SS_TOKENS.alert }}>
              {plane.altitude_ft?.toLocaleString()}′
            </div>
            <div style={{ fontSize: 10.5, color: SS_TOKENS.fg2, marginTop: 2 }}>
              {plane.corridor || 'airborne'}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 11, color: SS_TOKENS.fg2 }}>
            {fmtAgo(plane.last_seen_min)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Plane icon (cessna fixed-wing vs helo) ─────────────────────────────────
function planeKindFor(plane) {
  if (!plane) return 'plane';
  return /HELO|Bell|MD/i.test(plane.model || '') ? 'helo' : 'plane';
}

function SSPlaneIcon({ size = 16, kind = 'plane', color = '#fff', heading = 0 }) {
  if (kind === 'helo') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" style={{ transform: `rotate(${heading}deg)` }}>
        <line x1="3" y1="6" x2="21" y2="6" stroke={color} strokeWidth="1.4"/>
        <line x1="12" y1="6" x2="12" y2="9" stroke={color} strokeWidth="1.4"/>
        <ellipse cx="12" cy="13" rx="5" ry="3.2" fill="none" stroke={color} strokeWidth="1.6"/>
        <line x1="17" y1="13" x2="22" y2="13" stroke={color} strokeWidth="1.4"/>
        <line x1="20" y1="11" x2="22" y2="13" stroke={color} strokeWidth="1.2"/>
        <line x1="20" y1="15" x2="22" y2="13" stroke={color} strokeWidth="1.2"/>
        <line x1="9" y1="17" x2="15" y2="17" stroke={color} strokeWidth="1.4"/>
      </svg>
    );
  }
  // fixed-wing
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ transform: `rotate(${heading}deg)` }}>
      <path d="M12 2 L13.4 10 L22 13 L22 14.5 L13.4 13.2 L12.6 18.5 L15 20 L15 21 L12 20.2 L9 21 L9 20 L11.4 18.5 L10.6 13.2 L2 14.5 L2 13 L10.6 10 Z"
        fill={color} stroke="none"/>
    </svg>
  );
}

// ─── Mini orbit visual (track + plane) ─────────────────────────────────────
function SSOrbitGlyph({ size = 96, history = [], color = SS_TOKENS.alert }) {
  // Normalize history to [0,1] in both dims, then center
  if (!history.length) return <div style={{ width: size, height: size }} />;
  const lats = history.map(p => p.lat), lons = history.map(p => p.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const w = maxLon - minLon || 1, h = maxLat - minLat || 1;
  const pad = 0.15;
  const norm = (p) => ({
    x: pad * size + ((p.lon - minLon) / w) * size * (1 - 2 * pad),
    y: pad * size + (1 - (p.lat - minLat) / h) * size * (1 - 2 * pad),
  });
  const pts = history.map(norm);
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg width={size} height={size} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`og-${size}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={color} stopOpacity="0"/>
          <stop offset="1" stopColor={color} stopOpacity=".9"/>
        </linearGradient>
      </defs>
      <path d={d} fill="none" stroke={`url(#og-${size})`} strokeWidth="1.4"/>
      <circle cx={last.x} cy={last.y} r="3.5" fill={color} />
      <circle cx={last.x} cy={last.y} r="7" fill={color} fillOpacity=".22" />
    </svg>
  );
}

// ─── Format helpers ────────────────────────────────────────────────────────
function fmtAgo(min) {
  if (min == null) return '—';
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  if (min < 1440) return `${Math.floor(min / 60)}h ago`;
  return `${Math.floor(min / 1440)}d ago`;
}

function fmtAloft(min) {
  if (min < 60) return `${min}m aloft`;
  return `${Math.floor(min / 60)}h ${min % 60}m aloft`;
}

// ─── Tab bar (bottom nav) ──────────────────────────────────────────────────
function SSTabBar({ value, onChange, tabs }) {
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0,
      display: 'flex', justifyContent: 'space-around',
      padding: '10px 8px 28px',
      background: 'linear-gradient(to top, rgba(11,13,16,.96) 70%, rgba(11,13,16,0))',
      backdropFilter: 'blur(20px)',
      borderTop: `.5px solid ${SS_TOKENS.hairline}`,
    }}>
      {tabs.map(t => {
        const active = value === t.id;
        return (
          <button key={t.id} onClick={() => onChange(t.id)} style={{
            background: 'transparent', border: 0, padding: '6px 10px', cursor: 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            color: active ? SS_TOKENS.fg0 : SS_TOKENS.fg2,
          }}>
            <span style={{ fontSize: 18, lineHeight: 1 }}>{t.icon}</span>
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.02em' }}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Export
Object.assign(window, {
  SS_TOKENS, SS_FONT,
  SSStatusPill, SSCard, SSPlaneRow, SSPlaneIcon, SSOrbitGlyph, SSTabBar,
  fmtAgo, fmtAloft, planeKindFor,
});
