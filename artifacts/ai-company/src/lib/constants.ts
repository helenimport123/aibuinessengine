import { Brain, Megaphone, Target } from "lucide-react";

export const AGENT_CONFIG = {
  ceo: {
    name: "AI CEO",
    label: "Phân Tích Thị Trường",
    icon: Brain,
    color: "text-cyan-400",
    bg: "bg-cyan-400/10",
    border: "border-cyan-400/30",
    glow: "shadow-[0_0_20px_rgba(34,211,238,0.25)]",
    accent: "cyan",
    progressColor: "bg-cyan-400",
  },
  marketing: {
    name: "AI Marketing",
    label: "Kế Hoạch Marketing",
    icon: Megaphone,
    color: "text-fuchsia-400",
    bg: "bg-fuchsia-400/10",
    border: "border-fuchsia-400/30",
    glow: "shadow-[0_0_20px_rgba(232,121,249,0.25)]",
    accent: "fuchsia",
    progressColor: "bg-fuchsia-400",
  },
  sales: {
    name: "AI Sales",
    label: "Sales Playbook",
    icon: Target,
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
    border: "border-emerald-400/30",
    glow: "shadow-[0_0_20px_rgba(52,211,153,0.25)]",
    accent: "emerald",
    progressColor: "bg-emerald-400",
  },
} as const;

export const AGENT_ORDER: AgentType[] = ["ceo", "marketing", "sales"];

export type AgentType = keyof typeof AGENT_CONFIG;
