type Kind = "plane" | "helo";

export function planeKindFor(model: string | null | undefined): Kind {
  if (!model) return "plane";
  return /HELO|Bell|MD/i.test(model) ? "helo" : "plane";
}

type Props = {
  size?: number;
  kind?: Kind;
  color?: string;
  heading?: number;
};

export function PlaneIcon({
  size = 16,
  kind = "plane",
  color = "#fff",
  heading = 0,
}: Props) {
  if (kind === "helo") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        style={{ transform: `rotate(${heading}deg)` }}
      >
        <line x1="3" y1="6" x2="21" y2="6" stroke={color} strokeWidth="1.4" />
        <line x1="12" y1="6" x2="12" y2="9" stroke={color} strokeWidth="1.4" />
        <ellipse
          cx="12"
          cy="13"
          rx="5"
          ry="3.2"
          fill="none"
          stroke={color}
          strokeWidth="1.6"
        />
        <line x1="17" y1="13" x2="22" y2="13" stroke={color} strokeWidth="1.4" />
        <line x1="20" y1="11" x2="22" y2="13" stroke={color} strokeWidth="1.2" />
        <line x1="20" y1="15" x2="22" y2="13" stroke={color} strokeWidth="1.2" />
        <line x1="9" y1="17" x2="15" y2="17" stroke={color} strokeWidth="1.4" />
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ transform: `rotate(${heading}deg)` }}
    >
      <path
        d="M12 2 L13.4 10 L22 13 L22 14.5 L13.4 13.2 L12.6 18.5 L15 20 L15 21 L12 20.2 L9 21 L9 20 L11.4 18.5 L10.6 13.2 L2 14.5 L2 13 L10.6 10 Z"
        fill={color}
      />
    </svg>
  );
}
