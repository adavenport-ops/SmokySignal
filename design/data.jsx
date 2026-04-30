// data.jsx — Mock aircraft data + tail registry
// Tail numbers transcribed from the user's photo.
// In production, /api/aircraft (Vercel serverless fn) returns this shape
// after polling adsb.fi + OpenSky and merging by tail.

const TAIL_REGISTRY = [
  // WSP Cessnas — Smoky and friends
  { tail: 'N305DK', operator: 'WSP',     model: 'Cessna 182', nickname: 'Smoky',   role: 'Speed enforcement' },
  { tail: 'N305RC', operator: 'WSP',     model: 'Cessna 182', nickname: null,      role: 'Speed enforcement' },
  { tail: 'N2446X', operator: 'WSP',     model: 'Cessna 206', nickname: null,      role: 'Speed enforcement' },
  { tail: 'N102LP', operator: 'WSP',     model: 'Cessna 182', nickname: null,      role: 'Speed enforcement' },
  // King County Sheriff helicopters — "Guardian One" fleet
  { tail: 'N422CT', operator: 'KC SO',   model: 'Bell 407',   nickname: 'Guardian',role: 'Patrol / pursuit' },
  { tail: 'N71KP',  operator: 'KC SO',   model: 'Bell 407',   nickname: null,      role: 'Patrol / pursuit' },
  { tail: 'N407KS', operator: 'KC SO',   model: 'Bell 407',   nickname: null,      role: 'Patrol / pursuit' },
  { tail: 'N67817', operator: 'KC SO',   model: 'MD 500',     nickname: null,      role: 'Patrol / pursuit' },
  { tail: 'N790RJ', operator: 'KC SO',   model: 'Bell 407',   nickname: null,      role: 'Patrol / pursuit' },
  // Pierce County Cessnas
  { tail: 'N9446P', operator: 'Pierce',  model: 'Cessna 182', nickname: null,      role: 'Speed enforcement' },
  { tail: 'N24289', operator: 'Pierce',  model: 'Cessna 182', nickname: null,      role: 'Speed enforcement' },
  // Other
  { tail: 'N207HB', operator: 'WSP?',    model: 'Beech 200',  nickname: null,      role: 'Surveillance' },
  { tail: 'N3532K', operator: 'Unknown', model: 'Unknown',    nickname: null,      role: 'Unknown' },
];

// Live snapshot — what /api/aircraft would return.
// Mix of airborne + grounded so the prototype shows both states.
// Coords are around the I-5 / I-405 / I-90 corridors near Seattle.
const LIVE_SNAPSHOT = {
  fetched_at: Date.now(),
  aircraft: [
    {
      tail: 'N305DK', // Smoky, airborne
      airborne: true,
      lat: 47.5301, lon: -122.2612, // over I-5 near Tukwila
      altitude_ft: 2800, ground_speed_kt: 118, heading: 184,
      orbiting: true, orbit_center: { lat: 47.5295, lon: -122.2620 }, orbit_radius_mi: 0.7,
      corridor: 'I-5 SB · Tukwila → SeaTac',
      time_aloft_min: 47,
      last_seen_min: 0,
      track_history: generateOrbitTrack(47.5295, -122.2620, 0.012, 90),
    },
    {
      tail: 'N422CT', // Guardian, airborne
      airborne: true,
      lat: 47.6710, lon: -122.3345, // over Capitol Hill
      altitude_ft: 1400, ground_speed_kt: 88, heading: 270,
      orbiting: true, orbit_center: { lat: 47.6705, lon: -122.3340 }, orbit_radius_mi: 0.4,
      corridor: 'Capitol Hill / Central District',
      time_aloft_min: 12,
      last_seen_min: 0,
      track_history: generateOrbitTrack(47.6705, -122.3340, 0.008, 60),
    },
    {
      tail: 'N9446P', // Pierce Cessna, airborne
      airborne: true,
      lat: 47.2080, lon: -122.4015, // SR-512 / Tacoma
      altitude_ft: 3100, ground_speed_kt: 105, heading: 92,
      orbiting: true, orbit_center: { lat: 47.2080, lon: -122.4020 }, orbit_radius_mi: 0.9,
      corridor: 'SR-512 EB · Lakewood',
      time_aloft_min: 23,
      last_seen_min: 0,
      track_history: generateOrbitTrack(47.2080, -122.4020, 0.014, 75),
    },
    // grounded
    { tail: 'N305RC', airborne: false, last_seen_min: 95 },
    { tail: 'N2446X', airborne: false, last_seen_min: 380 },
    { tail: 'N102LP', airborne: false, last_seen_min: 1240 },
    { tail: 'N71KP',  airborne: false, last_seen_min: 220 },
    { tail: 'N407KS', airborne: false, last_seen_min: 60 },
    { tail: 'N67817', airborne: false, last_seen_min: 1890 },
    { tail: 'N790RJ', airborne: false, last_seen_min: 145 },
    { tail: 'N24289', airborne: false, last_seen_min: 410 },
    { tail: 'N207HB', airborne: false, last_seen_min: 2880 },
    { tail: 'N3532K', airborne: false, last_seen_min: 8640 },
  ],
};

function generateOrbitTrack(lat, lon, radius, count) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 6; // ~3 orbits
    pts.push({
      lat: lat + Math.cos(angle) * radius,
      lon: lon + Math.sin(angle) * radius * 1.4,
      t: i,
    });
  }
  return pts;
}

// Hot zones — where these planes have historically orbited.
// In prod this comes from a rolling 30-day window of position data.
const HOT_ZONES = [
  { id: 'i5-tukwila',   name: 'I-5 · Tukwila',          mi: 0.7, hits: 142, peak: 'Weekday PM rush', risk: 'high' },
  { id: 'i405-bellevue',name: 'I-405 · Bellevue',       mi: 1.2, hits: 118, peak: 'Weekday AM rush', risk: 'high' },
  { id: 'i90-issaquah', name: 'I-90 · Issaquah',        mi: 1.4, hits:  86, peak: 'Sunday afternoon', risk: 'med'  },
  { id: 'sr18-auburn',  name: 'SR-18 · Auburn',         mi: 0.9, hits:  74, peak: 'Saturday afternoon', risk: 'med' },
  { id: 'sr512-lkwd',   name: 'SR-512 · Lakewood',      mi: 1.0, hits:  61, peak: 'Weekday PM rush', risk: 'med' },
  { id: 'us2-monroe',   name: 'US-2 · Monroe',          mi: 1.6, hits:  44, peak: 'Weekend mornings', risk: 'low' },
  { id: 'i5-marysville',name: 'I-5 · Marysville',       mi: 1.1, hits:  39, peak: 'Friday PM',        risk: 'low' },
];

// Recent activity feed
const ACTIVITY_FEED = [
  { t: '2 min ago',  tail: 'N305DK', kind: 'orbit',     msg: 'Smoky tightened orbit over I-5 NB · Tukwila' },
  { t: '8 min ago',  tail: 'N422CT', kind: 'descent',   msg: 'Guardian descending toward Capitol Hill' },
  { t: '12 min ago', tail: 'N305DK', kind: 'takeoff',   msg: 'Smoky off the deck from KBFI' },
  { t: '47 min ago', tail: 'N9446P', kind: 'orbit',     msg: 'Pierce Cessna circling SR-512 · Lakewood' },
  { t: '1 h ago',    tail: 'N407KS', kind: 'landing',   msg: 'KC SO 407KS down at Boeing Field' },
  { t: '3 h ago',    tail: 'N305RC', kind: 'landing',   msg: 'WSP 305RC wheels down · 1h 12m flight' },
];

// Predicted hot windows for today
const PREDICTIONS_TODAY = [
  { window: '06:30 – 09:00', zones: ['I-5 · Tukwila', 'I-405 · Bellevue'], confidence: 0.82, label: 'AM rush sweep' },
  { window: '15:30 – 18:30', zones: ['I-5 · Tukwila', 'I-405 · Bellevue', 'SR-512 · Lakewood'], confidence: 0.91, label: 'PM rush sweep' },
  { window: '13:00 – 16:00', zones: ['I-90 · Issaquah'], confidence: 0.54, label: 'Weekend canyon run' },
];

window.SS_DATA = {
  TAIL_REGISTRY, LIVE_SNAPSHOT, HOT_ZONES, ACTIVITY_FEED, PREDICTIONS_TODAY,
  airborneCount() { return LIVE_SNAPSHOT.aircraft.filter(a => a.airborne).length; },
  byTail(tail) {
    const reg = TAIL_REGISTRY.find(t => t.tail === tail);
    const live = LIVE_SNAPSHOT.aircraft.find(a => a.tail === tail);
    return { ...reg, ...live };
  },
  smoky() { return this.byTail('N305DK'); },
  airborne() {
    return LIVE_SNAPSHOT.aircraft
      .filter(a => a.airborne)
      .map(a => ({ ...TAIL_REGISTRY.find(t => t.tail === a.tail), ...a }));
  },
};
