import React, { useState, useEffect, useCallback } from "react";
import { useRoute, Link } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  RefreshCw,
  Loader2,
  TrendingUp,
  DollarSign,
  Users,
  BarChart2,
  Megaphone,
  Scale,
  AlertTriangle,
  Lightbulb,
  Sparkles,
  Clock,
  CheckCircle2,
  BarChart,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type KpiItem = { value: number; unit: string; display: string };
type DimensionScores = { market: number; competition: number; finance: number; legal: number; marketing: number };
type BusinessScore = {
  overall: number;
  level: "EXCELLENT" | "GOOD" | "FAIR" | "POOR";
  dimensions: DimensionScores;
  risks: string[];
  opportunities: string[];
};
type ExecutiveData = {
  kpis: { investment: KpiItem; revenue: KpiItem; profit: KpiItem; breakEven: KpiItem; employeeCount: KpiItem; marketingBudget: KpiItem };
  score: BusinessScore;
  investorSummary: string;
  generatedAt: string;
};
type Task = { id: number; agentType: string; agentName: string; status: string };
type Project = { id: number; name: string; businessIdea: string; industry?: string; targetMarket?: string; status: string; completionPercent: number };

// ── SVG Gauge ────────────────────────────────────────────────────────────────
function GaugeChart({ value, color, size = 130 }: { value: number; color: string; size?: number }) {
  const r = 38;
  const cx = 50;
  const cy = 50;
  const arcLength = Math.PI * r;
  const dashOffset = arcLength * (1 - Math.min(100, Math.max(0, value)) / 100);

  return (
    <svg viewBox="0 0 100 58" width={size} height={size * 0.58} style={{ overflow: "visible" }}>
      <defs>
        <filter id={`glow-${color.replace("#", "")}`}>
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {/* Background track */}
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke="#1e293b"
        strokeWidth="9"
        strokeLinecap="round"
      />
      {/* Value arc */}
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke={color}
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={`${arcLength}`}
        strokeDashoffset={`${dashOffset}`}
        style={{ filter: `drop-shadow(0 0 4px ${color}80)` }}
      />
      {/* Value text */}
      <text x={cx} y={cy - 6} textAnchor="middle" fill="white" fontSize="15" fontWeight="bold" fontFamily="monospace">
        {value}
      </text>
    </svg>
  );
}

// ── Big Overall Gauge ─────────────────────────────────────────────────────────
function OverallGauge({ score, level }: { score: number; level: BusinessScore["level"] }) {
  const r = 42;
  const cx = 60;
  const cy = 60;
  const arcLength = Math.PI * r;
  const dashOffset = arcLength * (1 - score / 100);

  const colors: Record<string, string> = {
    EXCELLENT: "#22c55e",
    GOOD: "#22d3ee",
    FAIR: "#f59e0b",
    POOR: "#ef4444",
  };
  const levelLabels: Record<string, string> = {
    EXCELLENT: "XUẤT SẮC",
    GOOD: "TỐT",
    FAIR: "KHÁ",
    POOR: "YẾU",
  };

  const color = colors[level] ?? "#22d3ee";
  const label = levelLabels[level] ?? level;

  return (
    <div className="flex flex-col items-center gap-2">
      <svg viewBox="0 0 120 74" width={200} height={124} style={{ overflow: "visible" }}>
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="#1e293b"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${arcLength}`}
          strokeDashoffset={`${dashOffset}`}
          style={{ filter: `drop-shadow(0 0 6px ${color}90)` }}
        />
        <text x={cx} y={cy - 12} textAnchor="middle" fill="white" fontSize="26" fontWeight="bold" fontFamily="monospace">
          {score}
        </text>
        <text x={cx} y={cy + 2} textAnchor="middle" fill={color} fontSize="8" fontWeight="bold" fontFamily="monospace" letterSpacing="2">
          {label}
        </text>
      </svg>
    </div>
  );
}

// ── KPI Card ─────────────────────────────────────────────────────────────────
type KpiCardProps = {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: string;
  borderColor: string;
  bgColor: string;
  description: string;
};

function KpiCard({ label, value, icon, color, borderColor, bgColor, description }: KpiCardProps) {
  return (
    <div className={cn("rounded-xl border p-4 bg-card/30 backdrop-blur-sm flex flex-col gap-3 transition-all hover:bg-card/50", borderColor)}>
      <div className="flex items-start justify-between">
        <div className={cn("p-2 rounded-lg", bgColor)}>
          <div className={color}>{icon}</div>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider pt-1">{description}</span>
      </div>
      <div>
        <p className="text-xl font-bold text-white font-mono leading-none">{value}</p>
        <p className="text-xs text-muted-foreground mt-1.5">{label}</p>
      </div>
    </div>
  );
}

// ── Score Dimension ───────────────────────────────────────────────────────────
const DIMENSION_CONFIG = {
  market: { label: "Thị Trường", color: "#22d3ee" },
  competition: { label: "Cạnh Tranh", color: "#f59e0b" },
  finance: { label: "Tài Chính", color: "#10b981" },
  legal: { label: "Pháp Lý", color: "#8b5cf6" },
  marketing: { label: "Marketing", color: "#e879f9" },
} as const;

// ── Empty/Generate State ──────────────────────────────────────────────────────
function GenerateState({
  project,
  completedCount,
  onGenerate,
  generating,
}: {
  project: Project;
  completedCount: number;
  onGenerate: () => void;
  generating: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-8">
      <div className="p-6 rounded-2xl bg-primary/5 border border-primary/20">
        <BarChart className="w-14 h-14 text-primary/50 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">Executive Dashboard</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          AI sẽ phân tích toàn bộ outputs từ {completedCount} agents và tạo báo cáo dành cho nhà đầu tư.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 max-w-sm w-full">
        {["📊 KPI Cards", "🎯 Business Score", "📝 Investor Summary"].map((item) => (
          <div key={item} className="p-3 rounded-xl border border-border/30 bg-muted/5 text-center">
            <p className="text-xs text-muted-foreground font-mono">{item}</p>
          </div>
        ))}
      </div>

      {completedCount === 0 ? (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/5">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <p className="text-xs text-amber-400 font-mono">Chưa có agent nào hoàn thành. Hãy chạy Auto Orchestrate trước.</p>
        </div>
      ) : (
        <Button
          onClick={onGenerate}
          disabled={generating}
          size="lg"
          className="bg-primary hover:bg-primary/80 text-primary-foreground font-semibold shadow-[0_0_20px_rgba(34,211,238,0.35)] px-8"
        >
          {generating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
          {generating ? "Đang phân tích..." : "Tạo Executive Report"}
        </Button>
      )}
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function ExecutiveDashboard() {
  const [, params] = useRoute("/projects/:id/executive");
  const projectId = parseInt(params?.id ?? "0", 10);

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [executive, setExecutive] = useState<ExecutiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const { toast } = useToast();

  const completedCount = tasks.filter((t) => t.status === "completed").length;

  const fetchData = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`${BASE}/api/projects/${projectId}/executive`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setProject(data.project);
      setTasks(data.tasks ?? []);
      setExecutive(data.executive);
    } catch {
      toast({ variant: "destructive", title: "Lỗi", description: "Không thể tải dữ liệu." });
    } finally {
      setLoading(false);
    }
  }, [projectId, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`${BASE}/api/projects/${projectId}/executive/generate`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error ?? `HTTP ${res.status}`);
      }
      const data: ExecutiveData = await res.json();
      setExecutive(data);
      toast({ title: "✓ Hoàn thành", description: "Executive Report đã được tạo." });
    } catch (err) {
      toast({ variant: "destructive", title: "Lỗi", description: String(err) });
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (!project) {
    return (
      <Layout>
        <div className="text-center py-20 text-muted-foreground">Không tìm thấy dự án.</div>
      </Layout>
    );
  }

  const kpiCards: KpiCardProps[] = executive
    ? [
        {
          label: "Vốn Đầu Tư",
          value: executive.kpis.investment?.display ?? "—",
          icon: <DollarSign className="w-4 h-4" />,
          color: "text-cyan-400",
          borderColor: "border-cyan-400/20",
          bgColor: "bg-cyan-400/10",
          description: "CAPEX + Chi phí ban đầu",
        },
        {
          label: "Doanh Thu Năm 1",
          value: executive.kpis.revenue?.display ?? "—",
          icon: <TrendingUp className="w-4 h-4" />,
          color: "text-emerald-400",
          borderColor: "border-emerald-400/20",
          bgColor: "bg-emerald-400/10",
          description: "Dự báo 12 tháng đầu",
        },
        {
          label: "Lợi Nhuận Ròng",
          value: executive.kpis.profit?.display ?? "—",
          icon: <BarChart2 className="w-4 h-4" />,
          color: "text-teal-400",
          borderColor: "border-teal-400/20",
          bgColor: "bg-teal-400/10",
          description: "Sau thuế năm 1",
        },
        {
          label: "Điểm Hòa Vốn",
          value: executive.kpis.breakEven?.display ?? "—",
          icon: <Clock className="w-4 h-4" />,
          color: "text-amber-400",
          borderColor: "border-amber-400/20",
          bgColor: "bg-amber-400/10",
          description: "Break-even point",
        },
        {
          label: "Nhân Sự",
          value: executive.kpis.employeeCount?.display ?? "—",
          icon: <Users className="w-4 h-4" />,
          color: "text-blue-400",
          borderColor: "border-blue-400/20",
          bgColor: "bg-blue-400/10",
          description: "Dự kiến năm 1",
        },
        {
          label: "Ngân Sách Marketing",
          value: executive.kpis.marketingBudget?.display ?? "—",
          icon: <Megaphone className="w-4 h-4" />,
          color: "text-fuchsia-400",
          borderColor: "border-fuchsia-400/20",
          bgColor: "bg-fuchsia-400/10",
          description: "Tổng chi marketing",
        },
      ]
    : [];

  return (
    <Layout>
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-400 max-w-7xl mx-auto">

        {/* ── Back + Header ── */}
        <Link href={`/projects/${projectId}`}>
          <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-white transition-colors font-mono mb-1">
            <ArrowLeft className="w-3.5 h-3.5" />
            Quay lại Project Detail
          </button>
        </Link>

        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="p-2 rounded-lg bg-primary/10 border border-primary/30">
                <BarChart className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">Executive Dashboard</h1>
                <p className="text-sm text-muted-foreground font-mono">{project.name}</p>
              </div>
            </div>
            {project.industry && (
              <span className="mt-2 inline-block text-[11px] font-mono text-muted-foreground px-2 py-1 rounded border border-border/40 bg-muted/10">
                {project.industry}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {executive && (
              <p className="text-[10px] font-mono text-muted-foreground">
                Cập nhật: {new Date(executive.generatedAt).toLocaleString("vi-VN")}
              </p>
            )}
            {executive && (
              <Button
                variant="outline"
                size="sm"
                onClick={generate}
                disabled={generating || completedCount === 0}
                className="text-xs border-primary/30 text-primary hover:bg-primary/10"
              >
                {generating ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                Cập nhật
              </Button>
            )}
          </div>
        </div>

        {/* ── Agent status bar ── */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Agents:</span>
          {tasks.map((t) => (
            <div
              key={t.id}
              className={cn(
                "flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono border",
                t.status === "completed"
                  ? "border-green-500/40 bg-green-500/10 text-green-400"
                  : t.status === "running"
                  ? "border-amber-400/40 bg-amber-400/10 text-amber-400"
                  : "border-border/30 bg-muted/10 text-muted-foreground/50"
              )}
            >
              {t.status === "completed" ? <CheckCircle2 className="w-2.5 h-2.5" /> : <Clock className="w-2.5 h-2.5" />}
              {t.agentName}
            </div>
          ))}
        </div>

        {/* ── No data state ── */}
        {!executive ? (
          <GenerateState
            project={project}
            completedCount={completedCount}
            onGenerate={generate}
            generating={generating}
          />
        ) : (
          <div className="space-y-6">

            {/* ── KPI Cards ── */}
            <section>
              <h2 className="text-xs font-mono text-primary uppercase tracking-widest mb-4">
                KEY PERFORMANCE INDICATORS
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {kpiCards.map((card) => (
                  <KpiCard key={card.label} {...card} />
                ))}
              </div>
            </section>

            {/* ── Business Score ── */}
            <section className="rounded-2xl border border-border/30 bg-card/20 p-6">
              <h2 className="text-xs font-mono text-primary uppercase tracking-widest mb-6">
                BUSINESS SCORE ANALYSIS
              </h2>

              <div className="flex flex-col lg:flex-row gap-8 items-center">
                {/* Overall score */}
                <div className="flex flex-col items-center shrink-0">
                  <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">
                    Overall Score
                  </p>
                  <OverallGauge score={executive.score.overall} level={executive.score.level} />
                  <LevelBadge level={executive.score.level} />
                </div>

                {/* Dimension gauges */}
                <div className="flex-1 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6 justify-items-center">
                  {(Object.entries(executive.score.dimensions) as [keyof DimensionScores, number][]).map(([key, val]) => {
                    const cfg = DIMENSION_CONFIG[key];
                    return (
                      <div key={key} className="flex flex-col items-center gap-1">
                        <GaugeChart value={val} color={cfg.color} size={110} />
                        <p className="text-[10px] font-mono text-muted-foreground text-center">{cfg.label}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* ── Risks & Opportunities ── */}
            <div className="grid md:grid-cols-2 gap-4">
              {/* Risks */}
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  <h3 className="text-xs font-mono text-red-400 uppercase tracking-wider">Rủi Ro Chính</h3>
                </div>
                <div className="space-y-2.5">
                  {executive.score.risks.length > 0 ? (
                    executive.score.risks.map((risk, i) => (
                      <div key={i} className="flex gap-3 items-start">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-red-500/20 border border-red-500/30 text-red-400 text-[10px] font-bold font-mono flex items-center justify-center mt-0.5">
                          {i + 1}
                        </span>
                        <p className="text-xs text-muted-foreground leading-relaxed">{risk}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground">Không có rủi ro được xác định.</p>
                  )}
                </div>
              </div>

              {/* Opportunities */}
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Lightbulb className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-mono text-emerald-400 uppercase tracking-wider">Cơ Hội</h3>
                </div>
                <div className="space-y-2.5">
                  {executive.score.opportunities.length > 0 ? (
                    executive.score.opportunities.map((opp, i) => (
                      <div key={i} className="flex gap-3 items-start">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold font-mono flex items-center justify-center mt-0.5">
                          {i + 1}
                        </span>
                        <p className="text-xs text-muted-foreground leading-relaxed">{opp}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground">Không có cơ hội được xác định.</p>
                  )}
                </div>
              </div>
            </div>

            {/* ── Investor Summary ── */}
            <section className="rounded-2xl border border-primary/20 bg-card/20 p-6">
              <div className="flex items-center gap-2 mb-5">
                <Scale className="w-4 h-4 text-primary" />
                <h2 className="text-xs font-mono text-primary uppercase tracking-wider">
                  CEO Summary — Dành Cho Nhà Đầu Tư
                </h2>
              </div>
              <div className="prose prose-sm prose-invert max-w-none">
                {executive.investorSummary.split("\n\n").map((para, i) => (
                  <p key={i} className="text-sm text-muted-foreground leading-7 mb-4 last:mb-0">
                    {para}
                  </p>
                ))}
              </div>
            </section>

          </div>
        )}
      </div>
    </Layout>
  );
}

function LevelBadge({ level }: { level: BusinessScore["level"] }) {
  const configs: Record<string, { label: string; className: string }> = {
    EXCELLENT: { label: "✦ XUẤT SẮC", className: "border-green-500/50 bg-green-500/10 text-green-400" },
    GOOD: { label: "✓ TỐT", className: "border-cyan-500/50 bg-cyan-500/10 text-cyan-400" },
    FAIR: { label: "◎ KHÁ", className: "border-amber-500/50 bg-amber-500/10 text-amber-400" },
    POOR: { label: "✗ YẾU", className: "border-red-500/50 bg-red-500/10 text-red-400" },
  };
  const cfg = configs[level] ?? configs.GOOD;
  return (
    <span className={cn("mt-1 px-3 py-1 rounded-full text-[11px] font-bold font-mono border tracking-widest", cfg.className)}>
      {cfg.label}
    </span>
  );
}
