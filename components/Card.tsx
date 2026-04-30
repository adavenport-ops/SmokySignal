import { SS_TOKENS } from "@/lib/tokens";
import type { CSSProperties, ReactNode } from "react";

type Props = {
  children: ReactNode;
  padded?: boolean;
  raised?: boolean;
  style?: CSSProperties;
};

export function Card({ children, padded = true, raised = false, style }: Props) {
  return (
    <div
      style={{
        background: raised ? SS_TOKENS.bg2 : SS_TOKENS.bg1,
        border: `.5px solid ${SS_TOKENS.hairline}`,
        borderRadius: 14,
        padding: padded ? 14 : 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
