import React, { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Zap, CheckCircle2, XCircle, Clock, ChevronDown, ChevronUp,
  Sparkles, Network, FileText, BarChart2, Users, Scale, Headphones, DollarSign,
  Bot, ArrowRight
} from "lucide-react";
import ReactMarkdown from "react-markdown";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "";

type TaskStatus = "pending" | "running" | "completed" | "failed";

interface AgentTask {
  id: number;
  agentType: string;
  agentName: string;
  status: TaskStatus;
  output: string | null;
  errorMessage: string | null;
  completedAt: string | null;
}

interface ProjectProgress {
  projectId: number;
  name: string;
  businessIdea: string;
  status: string;
  completionPercent: number;
  executiveSummary: string | null;
  tasks: AgentTask[];
}

const AGENT_META: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  ceo: { icon: Bot, color: "text-cyan-400 border-cyan-500/40 bg-cyan-500/10", label: "AI CEO" },
  marketing: { icon: BarChart2, color: "text-pink-400 border-pink-500/40 bg-pink-500/10", label: "AI Marketing" },
  sales: { icon: ArrowRight, color: "text-orange-400 border-orange-500/40 bg-orange-500/10", label: "AI Sales" },
  hr: { icon: Users, color: "text-violet-400 border-violet-500/40 bg-violet-500/10", label: "AI HR" },
  accountant: { icon: DollarSign, color: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10", label: "AI Kế Toán" },
  legal: { icon: Scale, color: "text-yellow-400 border-yellow-500/40 bg-yellow-500/10", label: "AI Pháp Lý" },
  cskh: { icon: Headphones, color: "text-sky-400 border-sky-500/40 bg-sky-500/10", label: "AI CSKH" },
};

function statusPercent(status: TaskStatus): number {
  if (status === "completed") return 100;
  if (status === "running") return 55;
  if (status === "failed") return 100;
  return 0;
}

function StatusBadge({ status }: { status: TaskStatus }) {
  if (status === "completed") return (
    <Badge className="bg-green-500/10 text-green-400 border-green-500/30 font-mono text-xs gap-1">
      <CheckCircle2 className="w-3 h-3" /> Hoàn thành
    </Badge>
  );
  if (status === "running") return (
    <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/30 font-mono text-xs gap-1">
      <Loader2 className="w-3 h-3 animate-spin" /> Đang chạy
    </Badge>
  );
  if (status === "failed") return (
    <Badge className="bg-red-500/10 text-red-400 border-red-500/30 font-mono text-xs gap-1">
      <XCircle className="w-3 h-3" /> Lỗi
    </Badge>
  );
  return (
    <Badge className="bg-muted/30 text-muted-foreground border-border font-mono text-xs gap-1">
      <Clock className="w-3 h-3" /> Chờ
    </Badge>
  );
}

function AgentCard({ task }: { task: AgentTask }) {
  const [expanded, setExpanded] = useState(false);
  const meta = AGENT_META[task.agentType] ?? { icon: Bot, color: "text-muted-foreground border-border bg-muted/10", label: task.agentName };
  const Icon = meta.icon;
  const pct = statusPercent(task.status);

  return (
    <Card className={`border transition-all duration-300 ${meta.color.split(" ").find(c => c.startsWith("border")) ?? "border-border"} bg-card/50`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className={`p-2 rounded-lg ${meta.color.split(" ").filter(c => c.startsWith("bg") || c.startsWith("border")).join(" ")} border`}>
            <Icon className={`w-4 h-4 ${meta.color.split(" ").find(c => c.startsWith("text")) ?? "text-muted-foreground"}`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-mono font-semibold text-sm text-white">{meta.label}</p>
          </div>
          <StatusBadge status={task.status} />
        </div>

        <div className="space-y-1.5">
          <Progress
            value={pct}
            className="h-1.5"
          />
          <div className="flex justify-between text-xs font-mono text-muted-foreground">
            <span>{task.status === "running" ? "Đang xử lý..." : task.status === "completed" ? "Hoàn thành" : task.status === "failed" ? "Thất bại" : "Chờ xử lý"}</span>
            <span>{pct}%</span>
          </div>
        </div>

        {task.output && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-3 w-full flex items-center justify-between text-xs font-mono text-muted-foreground hover:text-white transition-colors px-2 py-1.5 rounded border border-border/50 hover:border-border bg-muted/20"
          >
            <span>Xem báo cáo</span>
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        )}

        {expanded && task.output && (
          <div className="mt-3 max-h-80 overflow-y-auto rounded-lg border border-border/50 bg-muted/10 p-4">
            <div className="prose prose-sm prose-invert max-w-none text-xs leading-relaxed">
              <ReactMarkdown>{task.output}</ReactMarkdown>
            </div>
          </div>
        )}

        {task.errorMessage && (
          <p className="mt-2 text-xs font-mono text-red-400 bg-red-500/5 border border-red-500/20 rounded p-2">
            {task.errorMessage}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function OrchestratorForm({ onStart }: { onStart: (projectId: number) => void }) {
  const [idea, setIdea] = useState("");
  const [industry, setIndustry] = useState("");
  const [target, setTarget] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idea.trim() || idea.trim().length < 10) {
      setError("Vui lòng mô tả ý tưởng kinh doanh (ít nhất 10 ký tự)");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/orchestrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessIdea: idea.trim(), industry: industry.trim() || undefined, targetMarket: target.trim() || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      onStart(data.projectId);
    } catch (err: any) {
      setError(err.message ?? "Lỗi không xác định");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/30 shadow-[0_0_30px_rgba(34,211,238,0.15)] mb-2">
          <Network className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-3xl font-bold text-white tracking-tight">AI ORCHESTRATOR</h1>
        <p className="text-muted-foreground font-mono text-sm">
          Nhập ý tưởng kinh doanh — hệ thống sẽ tự động triển khai 7 AI agents song song
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(["CEO", "Marketing", "Sales", "HR", "Kế Toán", "Pháp Lý", "CSKH"] as const).map((label, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/50 bg-muted/20 text-xs font-mono text-muted-foreground">
            <Sparkles className="w-3 h-3 text-primary/60" />
            {label}
          </div>
        ))}
      </div>

      <Card className="mission-panel border-primary/20">
        <CardHeader className="pb-4">
          <CardTitle className="font-mono text-sm uppercase text-primary flex items-center gap-2">
            <Zap className="w-4 h-4" /> Khởi động Orchestrator
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="idea" className="font-mono text-xs uppercase text-muted-foreground">
                Ý tưởng kinh doanh *
              </Label>
              <Textarea
                id="idea"
                placeholder='Ví dụ: "Tôi muốn mở quán cà phê theo phong cách Hàn Quốc tại Hà Nội, tập trung vào không gian làm việc và học tập cho giới trẻ 18-30 tuổi"'
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                rows={4}
                className="font-mono text-sm bg-muted/30 border-border resize-none focus:border-primary/50"
                disabled={loading}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="industry" className="font-mono text-xs uppercase text-muted-foreground">
                  Ngành nghề (tuỳ chọn)
                </Label>
                <Input
                  id="industry"
                  placeholder="F&B, Tech, Bán lẻ..."
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="font-mono text-sm bg-muted/30 border-border"
                  disabled={loading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="target" className="font-mono text-xs uppercase text-muted-foreground">
                  Thị trường mục tiêu (tuỳ chọn)
                </Label>
                <Input
                  id="target"
                  placeholder="Hà Nội, TP.HCM, Toàn quốc..."
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="font-mono text-sm bg-muted/30 border-border"
                  disabled={loading}
                />
              </div>
            </div>

            {error && (
              <p className="text-red-400 text-sm font-mono bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2">
                ⚠ {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={loading || idea.trim().length < 10}
              className="w-full gap-2 bg-primary hover:bg-primary/80 text-primary-foreground font-semibold font-mono shadow-[0_0_20px_rgba(34,211,238,0.3)] transition-all h-11"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Đang khởi động...</>
              ) : (
                <><Zap className="w-4 h-4" /> KHỞI ĐỘNG ORCHESTRATOR</>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function OrchestratorProgress({ projectId }: { projectId: number }) {
  const [, navigate] = useLocation();
  const [progress, setProgress] = useState<ProjectProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);

  const fetchProgress = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/orchestrate/${projectId}/progress`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setProgress(data);
    } catch (e: any) {
      setError(e.message);
    }
  }, [projectId]);

  useEffect(() => {
    fetchProgress();
    const interval = setInterval(fetchProgress, 2500);
    return () => clearInterval(interval);
  }, [fetchProgress]);

  if (error) return (
    <div className="text-center py-12 text-red-400 font-mono text-sm">
      Lỗi tải dữ liệu: {error}
    </div>
  );

  if (!progress) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="w-8 h-8 text-primary animate-spin" />
    </div>
  );

  const isComplete = progress.status === "completed";
  const completedCount = progress.tasks.filter(t => t.status === "completed").length;
  const totalCount = progress.tasks.length;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Network className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-bold text-white font-mono uppercase tracking-wide">AI ORCHESTRATOR</h1>
            {isComplete ? (
              <Badge className="bg-green-500/10 text-green-400 border-green-500/30 font-mono text-xs gap-1">
                <CheckCircle2 className="w-3 h-3" /> Hoàn tất
              </Badge>
            ) : (
              <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/30 font-mono text-xs gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Đang chạy
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground text-sm line-clamp-2 max-w-lg">{progress.businessIdea}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="font-mono text-xs border-border text-muted-foreground hover:text-white shrink-0"
          onClick={() => navigate(`/projects/${projectId}`)}
        >
          <FileText className="w-3.5 h-3.5 mr-1.5" /> Xem chi tiết
        </Button>
      </div>

      {/* Overall progress */}
      <Card className="mission-panel border-primary/20">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 font-mono text-sm text-white">
              <Sparkles className="w-4 h-4 text-primary" />
              <span>TIẾN ĐỘ TỔNG THỂ</span>
            </div>
            <span className="font-mono font-bold text-primary text-lg">{progress.completionPercent}%</span>
          </div>
          <Progress value={progress.completionPercent} className="h-2.5" />
          <p className="text-xs font-mono text-muted-foreground mt-2">
            {completedCount}/{totalCount} agents hoàn thành
          </p>
        </CardContent>
      </Card>

      {/* Agent cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {progress.tasks.map((task) => (
          <AgentCard key={task.id} task={task} />
        ))}
      </div>

      {/* Executive Summary */}
      {isComplete && progress.executiveSummary && (
        <Card className="mission-panel border-green-500/20">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="font-mono text-sm uppercase text-green-400 flex items-center gap-2">
                <Sparkles className="w-4 h-4" /> EXECUTIVE SUMMARY
              </CardTitle>
              <button
                onClick={() => setShowSummary(!showSummary)}
                className="text-xs font-mono text-muted-foreground hover:text-white flex items-center gap-1"
              >
                {showSummary ? <><ChevronUp className="w-3.5 h-3.5" /> Thu gọn</> : <><ChevronDown className="w-3.5 h-3.5" /> Xem báo cáo</>}
              </button>
            </div>
          </CardHeader>
          {showSummary && (
            <CardContent className="pt-0">
              <div className="prose prose-sm prose-invert max-w-none text-sm leading-relaxed bg-muted/10 rounded-lg border border-border/50 p-5">
                <ReactMarkdown>{progress.executiveSummary}</ReactMarkdown>
              </div>
            </CardContent>
          )}
          {!showSummary && (
            <CardContent className="pt-0">
              <p className="text-sm text-muted-foreground font-mono italic line-clamp-3">
                {progress.executiveSummary.slice(0, 200)}…
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 font-mono text-xs border-green-500/30 text-green-400 hover:bg-green-500/10"
                onClick={() => setShowSummary(true)}
              >
                <FileText className="w-3.5 h-3.5 mr-1.5" /> Đọc Executive Summary
              </Button>
            </CardContent>
          )}
        </Card>
      )}

      {isComplete && !progress.executiveSummary && (
        <Card className="mission-panel border-amber-500/20">
          <CardContent className="p-4 flex items-center gap-3 text-amber-400 text-sm font-mono">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            Đang tổng hợp Executive Summary…
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function OrchestratorPage() {
  const [projectId, setProjectId] = useState<number | null>(null);

  return (
    <Layout>
      {projectId === null ? (
        <OrchestratorForm onStart={setProjectId} />
      ) : (
        <OrchestratorProgress projectId={projectId} />
      )}
    </Layout>
  );
}
