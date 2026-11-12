import type { ReactNode, SVGProps } from "react";
import { defineWebModule } from "@aihot/web/modules";
import { DARK_MARKS } from "./marks";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function ChartIcon({ size = 18, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}

const chart = (p: { size?: number }) => <ChartIcon size={p.size} />;

export const leaderboardWeb = defineWebModule({
  name: "leaderboard",
  darkMarks: DARK_MARKS,
  sidebar: {
    section: "监控",
    items: [{ to: "/leaderboard", label: "模型榜", icon: chart }],
  },
  tools: [{ to: "/leaderboard", label: "模型榜", icon: <ChartIcon size={20} /> satisfies ReactNode }],
});
