export function fmtAgo(min: number | null | undefined): string {
  if (min == null || Number.isNaN(min) || min <= 0) return "a while";
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  if (min < 1440) return `${Math.floor(min / 60)}h ago`;
  return `${Math.floor(min / 1440)}d ago`;
}

export function fmtAloft(min: number | null | undefined): string {
  if (min == null) return "—";
  if (min < 60) return `${min}m aloft`;
  return `${Math.floor(min / 60)}h ${min % 60}m aloft`;
}
