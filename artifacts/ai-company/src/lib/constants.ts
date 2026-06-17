import { Brain, Megaphone, Target, Headphones, Users, Calculator, Scale } from "lucide-react";

export const AGENT_CONFIG = {
  ceo: {
    name: "AI CEO",
    icon: Brain,
    color: "text-cyan-400",
    bg: "bg-cyan-400/10",
    border: "border-cyan-400/30",
    glow: "shadow-[0_0_15px_rgba(34,211,238,0.3)]",
  },
  marketing: {
    name: "AI Marketing",
    icon: Megaphone,
    color: "text-fuchsia-400",
    bg: "bg-fuchsia-400/10",
    border: "border-fuchsia-400/30",
    glow: "shadow-[0_0_15px_rgba(232,121,249,0.3)]",
  },
  sales: {
    name: "AI Sales",
    icon: Target,
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
    border: "border-emerald-400/30",
    glow: "shadow-[0_0_15px_rgba(52,211,153,0.3)]",
  },
  cskh: {
    name: "AI CSKH",
    icon: Headphones,
    color: "text-rose-400",
    bg: "bg-rose-400/10",
    border: "border-rose-400/30",
    glow: "shadow-[0_0_15px_rgba(251,113,133,0.3)]",
  },
  hr: {
    name: "AI HR",
    icon: Users,
    color: "text-amber-400",
    bg: "bg-amber-400/10",
    border: "border-amber-400/30",
    glow: "shadow-[0_0_15px_rgba(251,191,36,0.3)]",
  },
  accountant: {
    name: "AI Accountant",
    icon: Calculator,
    color: "text-blue-400",
    bg: "bg-blue-400/10",
    border: "border-blue-400/30",
    glow: "shadow-[0_0_15px_rgba(96,165,250,0.3)]",
  },
  legal: {
    name: "AI Legal",
    icon: Scale,
    color: "text-slate-300",
    bg: "bg-slate-300/10",
    border: "border-slate-300/30",
    glow: "shadow-[0_0_15px_rgba(203,213,225,0.3)]",
  },
} as const;

export type AgentType = keyof typeof AGENT_CONFIG;
