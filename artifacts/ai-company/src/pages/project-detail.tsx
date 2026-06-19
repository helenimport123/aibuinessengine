import React, { useState, useRef, useEffect, useCallback } from "react";
import { useRoute, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetProject,
  getGetProjectQueryKey,
  useDeleteProject,
  getListProjectsQueryKey,
} from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";
import {
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowLeft,
  Trash2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Terminal,
  Coins,
  GitBranch,
  Sparkles,
  FileDown,
  FileText,
  FileType2,
  BarChart,
} from "lucide-react";
import { AGENT_CONFIG, AgentType } from "@/lib/constants";

type ExecutionPlanItem = { agent: string; reason: string };

type LogEntry = {
  message: string;
};

type AgentStreamState = {
  streaming: boolean;
  text: string;
  logs: LogEntry[];
  progress: number;
  tokens?: number;
  cost?: number;
  showLogs: boolean;
};

const defaultStreamState = (): AgentStreamState => ({
  streaming: false,
  text: "",
  logs: [],
  progress: 0,
  tokens: undefined,
  cost: undefined,
  showLogs: false,
});

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

export default function ProjectDetail() {
  const [, params] = useRoute("/projects/:id");
  const projectId = parseInt(params?.id || "0");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: project, isLoading } = useGetProject(projectId, {
    query: {
      enabled: !!projectId,
      queryKey: getGetProjectQueryKey(projectId),
      refetchInterval: 4000,
    },
  });

  const deleteProject = useDeleteProject();

  const [agentStreams, setAgentStreams] = useState<Record<string, AgentStreamState>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [runningAll, setRunningAll] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "docx" | "markdown" | null>(null);

  const bottomRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const logBottomRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const activeAgentTypes = Object.keys(agentStreams).filter((k) => agentStreams[k]?.streaming);

  useEffect(() => {
    for (const type of activeAgentTypes) {
      if (agentStreams[type]?.streaming) {
        bottomRefs.current[type]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [agentStreams]);

  useEffect(() => {
    for (const type of activeAgentTypes) {
      if (agentStreams[type]?.streaming && agentStreams[type]?.showLogs) {
        logBottomRefs.current[type]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [agentStreams]);

  const runAgent = useCallback(
    async (agentType: string) => {
      if (!projectId) return;

      setAgentStreams((prev) => ({
        ...prev,
        [agentType]: { ...defaultStreamState(), streaming: true, showLogs: prev[agentType]?.showLogs ?? false },
      }));
      setExpanded((prev) => ({ ...prev, [agentType]: true }));

      queryClient.setQueryData(getGetProjectQueryKey(projectId), (old: any) => {
        if (!old) return old;
        return {
          ...old,
          tasks: old.tasks.map((t: any) =>
            t.agentType === agentType ? { ...t, status: "running", output: null } : t
          ),
        };
      });

      try {
        const res = await fetch(`${BASE}/api/projects/${projectId}/agents/${agentType}/run`, {
          method: "POST",
        });

        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;
            try {
              const evt = JSON.parse(raw);

              if (evt.type === "log") {
                setAgentStreams((prev) => ({
                  ...prev,
                  [agentType]: {
                    ...(prev[agentType] ?? defaultStreamState()),
                    logs: [...(prev[agentType]?.logs ?? []), { message: evt.message }],
                  },
                }));
              } else if (evt.type === "progress") {
                setAgentStreams((prev) => ({
                  ...prev,
                  [agentType]: {
                    ...(prev[agentType] ?? defaultStreamState()),
                    progress: evt.percent,
                  },
                }));
              } else if (evt.type === "text" || evt.text) {
                const content = evt.content ?? evt.text ?? "";
                setAgentStreams((prev) => ({
                  ...prev,
                  [agentType]: {
                    ...(prev[agentType] ?? defaultStreamState()),
                    text: (prev[agentType]?.text ?? "") + content,
                    streaming: true,
                  },
                }));
              } else if (evt.type === "plan") {
                // CEO execution plan received — refetch immediately to get new tasks
                queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
                queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
              } else if (evt.type === "done" || evt.done) {
                setAgentStreams((prev) => ({
                  ...prev,
                  [agentType]: {
                    ...(prev[agentType] ?? defaultStreamState()),
                    streaming: false,
                    progress: 100,
                    tokens: evt.tokens,
                    cost: evt.cost,
                  },
                }));
              } else if (evt.type === "error") {
                setAgentStreams((prev) => ({
                  ...prev,
                  [agentType]: {
                    ...(prev[agentType] ?? defaultStreamState()),
                    streaming: false,
                  },
                }));
              }
            } catch {
              /* ignore parse errors */
            }
          }
        }

        setAgentStreams((prev) => ({
          ...prev,
          [agentType]: {
            ...(prev[agentType] ?? defaultStreamState()),
            streaming: false,
            text: "",
          },
        }));
        queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      } catch (err) {
        setAgentStreams((prev) => ({
          ...prev,
          [agentType]: {
            ...(prev[agentType] ?? defaultStreamState()),
            streaming: false,
          },
        }));
        queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
        const config = AGENT_CONFIG[agentType as AgentType];
        toast({
          variant: "destructive",
          title: `${config?.name ?? agentType} thất bại`,
          description: "Không thể kết nối. Vui lòng thử lại.",
        });
      }
    },
    [projectId, queryClient, toast]
  );

  const handleRunAll = async () => {
    if (!project) return;
    setRunningAll(true);
    try {
      await fetch(`${BASE}/api/projects/${projectId}/run-all`, { method: "POST" });
      toast({
        title: "CEO Orchestrator đã kích hoạt",
        description: "CEO đang phân tích và tự động lập kế hoạch thực thi.",
      });
      queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
    } catch {
      toast({ variant: "destructive", title: "Lỗi", description: "Không thể khởi động orchestrator." });
    } finally {
      setRunningAll(false);
    }
  };

  const handleDelete = () => {
    if (!confirm("Xoá dự án này?")) return;
    deleteProject.mutate(
      { id: projectId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          toast({ title: "Đã xoá dự án" });
          window.location.href = import.meta.env.BASE_URL || "/";
        },
      }
    );
  };

  const downloadExport = async (format: "pdf" | "docx" | "markdown") => {
    if (!project) return;
    const tasks: any[] = (project as any).tasks ?? [];
    const allCompleted = (project as any).status === "completed" && tasks.every((t: any) => t.status === "completed");
    if (!allCompleted) {
      toast({
        variant: "destructive",
        title: "Không thể xuất",
        description: "Cần hoàn thành tất cả agent trước khi export.",
      });
      return;
    }

    setExporting(format);
    try {
      const res = await fetch(`${BASE}/api/projects/${projectId}/export/${format}`);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      const blob = await res.blob();
      const ext = format === "markdown" ? "md" : format;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `business-plan-${projectId}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({ title: `Xuất ${format.toUpperCase()} thành công`, description: `business-plan-${projectId}.${ext}` });
    } catch (err) {
      toast({ variant: "destructive", title: "Lỗi xuất file", description: String(err) });
    } finally {
      setExporting(null);
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="space-y-6">
          <Skeleton className="h-10 w-1/3 bg-muted/20" />
          <Skeleton className="h-6 w-2/3 bg-muted/20" />
          <Skeleton className="h-4 w-full bg-muted/20" />
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 w-full rounded-xl bg-muted/20" />
          ))}
        </div>
      </Layout>
    );
  }

  if (!project) {
    return (
      <Layout>
        <p className="text-muted-foreground">Không tìm thấy dự án.</p>
      </Layout>
    );
  }

  const anyAgentRunning = Object.values(agentStreams).some((s) => s.streaming);
  const isProjectRunning = project.status === "running" || anyAgentRunning;
  const executionPlan = (project as any).executionPlan as ExecutionPlanItem[] | null;
  const tasks: any[] = (project as any).tasks ?? [];

  return (
    <Layout>
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-400">
        {/* Back */}
        <Link href="/">
          <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-white transition-colors font-mono mb-1">
            <ArrowLeft className="w-3.5 h-3.5" />
            Quay lại Dashboard
          </button>
        </Link>

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-white">{project.name}</h1>
              <StatusBadge status={project.status} isRunning={isProjectRunning} />
            </div>
            <p className="text-sm text-muted-foreground max-w-2xl">{project.businessIdea}</p>
            {(project.industry || project.targetMarket) && (
              <div className="flex gap-3 text-xs font-mono text-muted-foreground pt-1">
                {project.industry && (
                  <span className="px-2 py-1 rounded border border-border/50 bg-muted/20">
                    {project.industry}
                  </span>
                )}
                {project.targetMarket && (
                  <span className="px-2 py-1 rounded border border-border/50 bg-muted/20">
                    {project.targetMarket}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="border-destructive/30 text-destructive hover:bg-destructive/10 text-xs"
              onClick={handleDelete}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              Xoá
            </Button>
            <Link href={`/projects/${projectId}/executive`}>
              <Button
                variant="outline"
                size="sm"
                className="border-violet-400/30 text-violet-400 hover:bg-violet-400/10 text-xs"
              >
                <BarChart className="w-3.5 h-3.5 mr-1.5" />
                Executive
              </Button>
            </Link>
            <Button
              size="sm"
              className="bg-primary hover:bg-primary/80 text-primary-foreground font-semibold shadow-[0_0_12px_rgba(34,211,238,0.35)] text-xs"
              onClick={handleRunAll}
              disabled={runningAll || anyAgentRunning || isProjectRunning}
            >
              {runningAll ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 mr-1.5" />
              )}
              Auto Orchestrate
            </Button>
          </div>
        </div>

        {/* Global Progress */}
        <div className="rounded-xl border border-primary/20 bg-card/30 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono text-primary uppercase tracking-wider">Tiến Độ Tổng Thể</span>
            <span className="text-sm font-bold text-white font-mono">{project.completionPercent}%</span>
          </div>
          <Progress value={project.completionPercent} className="h-1.5" />
        </div>

        {/* Export Section */}
        <div className="rounded-xl border border-border/30 bg-card/20 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <FileDown className="w-4 h-4 text-primary" />
                <span className="text-xs font-mono text-primary uppercase tracking-wider">Xuất Kế Hoạch Kinh Doanh</span>
              </div>
              {(project as any).status !== "completed" || tasks.some((t: any) => t.status !== "completed") ? (
                <p className="text-[11px] text-amber-400/80 font-mono">
                  ⚠ Cần hoàn thành tất cả agent trước khi export
                </p>
              ) : (
                <p className="text-[11px] text-green-400/80 font-mono">
                  ✓ Sẵn sàng xuất — tất cả agents đã hoàn thành
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="border-red-400/30 text-red-400 hover:bg-red-400/10 text-xs font-mono gap-1.5"
                onClick={() => downloadExport("pdf")}
                disabled={!!exporting}
              >
                {exporting === "pdf" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FileDown className="w-3.5 h-3.5" />
                )}
                PDF
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-blue-400/30 text-blue-400 hover:bg-blue-400/10 text-xs font-mono gap-1.5"
                onClick={() => downloadExport("docx")}
                disabled={!!exporting}
              >
                {exporting === "docx" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FileType2 className="w-3.5 h-3.5" />
                )}
                DOCX
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-green-400/30 text-green-400 hover:bg-green-400/10 text-xs font-mono gap-1.5"
                onClick={() => downloadExport("markdown")}
                disabled={!!exporting}
              >
                {exporting === "markdown" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FileText className="w-3.5 h-3.5" />
                )}
                Markdown
              </Button>
            </div>
          </div>
        </div>

        {/* Agent Cards */}
        <div className="space-y-4">
          {tasks.map((task) => {
            const agentType: string = task.agentType;
            const config = AGENT_CONFIG[agentType as AgentType] ?? {
              name: task.agentName ?? agentType,
              label: agentType,
              icon: GitBranch,
              color: "text-slate-400",
              bg: "bg-slate-400/10",
              border: "border-slate-400/30",
              glow: "",
              accent: "slate",
              progressColor: "bg-slate-400",
            };
            const Icon = config.icon;
            const stream = agentStreams[agentType] ?? defaultStreamState();
            const isStreaming = stream.streaming;
            const streamText = stream.text;
            const isOpen = expanded[agentType] ?? false;

            const displayOutput = isStreaming ? streamText : (task?.output ?? null);
            const hasOutput = !!displayOutput;
            const taskStatus = isStreaming ? "running" : (task?.status ?? "pending");

            const hasLogs = stream.logs.length > 0;
            const agentProgress = stream.progress;
            const showAgentProgress = isStreaming && agentProgress > 0;

            const isCeo = agentType === "ceo";

            return (
              <React.Fragment key={agentType}>
                <div
                  className={`rounded-xl border bg-card/30 transition-all duration-300 ${config.border} ${
                    taskStatus === "running" ? config.glow : ""
                  }`}
                >
                  {/* Card Header */}
                  <div className="flex items-center justify-between p-4 gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`p-2.5 rounded-lg ${config.bg} ${config.color} shrink-0`}>
                        <Icon className={`w-5 h-5 ${taskStatus === "running" ? "animate-pulse" : ""}`} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-white text-sm">{config.name}</span>
                          <span className={`text-xs ${config.color} font-mono`}>{config.label}</span>
                          {isCeo && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-400/10 text-cyan-400 border border-cyan-400/20">
                              ORCHESTRATOR
                            </span>
                          )}
                        </div>
                        <TaskStatusBadge status={taskStatus} />
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {stream.tokens !== undefined && stream.tokens > 0 && (
                        <div className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground border border-border/30 rounded px-2 py-1 bg-muted/10">
                          <Coins className="w-3 h-3" />
                          <span>{stream.tokens.toLocaleString()} tok</span>
                          {stream.cost !== undefined && (
                            <span className="text-green-400/80 ml-1">${stream.cost.toFixed(4)}</span>
                          )}
                        </div>
                      )}

                      {hasLogs && (
                        <button
                          onClick={() =>
                            setAgentStreams((prev) => ({
                              ...prev,
                              [agentType]: {
                                ...(prev[agentType] ?? defaultStreamState()),
                                showLogs: !prev[agentType]?.showLogs,
                              },
                            }))
                          }
                          className={`flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded border transition-colors ${
                            stream.showLogs
                              ? "border-primary/50 text-primary bg-primary/10"
                              : "border-border/30 text-muted-foreground hover:text-white hover:border-border"
                          }`}
                        >
                          <Terminal className="w-3 h-3" />
                          Logs
                        </button>
                      )}

                      {hasOutput && (
                        <button
                          onClick={() => setExpanded((p) => ({ ...p, [agentType]: !isOpen }))}
                          className="text-muted-foreground hover:text-white transition-colors"
                        >
                          {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      )}
                      <Button
                        size="sm"
                        variant={taskStatus === "completed" ? "outline" : "default"}
                        className={
                          taskStatus === "completed"
                            ? `border-${config.accent}-400/30 text-${config.accent}-400 hover:bg-${config.accent}-400/10 text-xs`
                            : `${config.bg} ${config.color} border ${config.border} hover:opacity-80 text-xs`
                        }
                        onClick={() => runAgent(agentType)}
                        disabled={isStreaming || taskStatus === "running"}
                      >
                        {isStreaming || taskStatus === "running" ? (
                          <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                        ) : taskStatus === "completed" ? (
                          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                        ) : (
                          <Play className="w-3.5 h-3.5 mr-1.5" />
                        )}
                        {isStreaming || taskStatus === "running"
                          ? "Đang chạy..."
                          : taskStatus === "completed"
                          ? "Chạy lại"
                          : "Chạy Agent"}
                      </Button>
                    </div>
                  </div>

                  {/* Per-agent progress bar */}
                  {showAgentProgress && (
                    <div className="px-4 pb-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-[11px] font-mono ${config.color} flex items-center gap-1.5`}>
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                          AI đang xử lý...
                        </span>
                        <span className="text-[11px] font-mono text-muted-foreground">{agentProgress}%</span>
                      </div>
                      <div className="h-1 w-full rounded-full bg-muted/20 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${config.progressColor ?? "bg-primary"}`}
                          style={{ width: `${agentProgress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Execution Logs Panel */}
                  {hasLogs && stream.showLogs && (
                    <div className="mx-4 mb-3 rounded-lg bg-black/40 border border-border/30 overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/20 bg-black/20">
                        <Terminal className="w-3 h-3 text-muted-foreground" />
                        <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">
                          Execution Logs
                        </span>
                      </div>
                      <div className="p-3 max-h-36 overflow-y-auto space-y-0.5 font-mono text-[11px] leading-relaxed">
                        {stream.logs.map((entry, i) => (
                          <div key={i} className="text-green-400/80">
                            {entry.message}
                          </div>
                        ))}
                        <div ref={(el) => { logBottomRefs.current[agentType] = el; }} />
                      </div>
                    </div>
                  )}

                  {/* Output */}
                  {hasOutput && (isOpen || isStreaming) && (
                    <div className="border-t border-border/40 mx-4 mb-4 pt-4">
                      <div className="bg-black/20 rounded-lg p-4 max-h-[500px] overflow-y-auto">
                        <div className="prose prose-sm prose-invert max-w-none text-[13px] leading-relaxed">
                          <ReactMarkdown>{displayOutput}</ReactMarkdown>
                        </div>
                        <div ref={(el) => { bottomRefs.current[agentType] = el; }} />
                      </div>
                    </div>
                  )}

                  {/* Collapsed preview for completed tasks */}
                  {hasOutput && !isOpen && !isStreaming && taskStatus === "completed" && (
                    <div
                      className="px-4 pb-4 cursor-pointer"
                      onClick={() => setExpanded((p) => ({ ...p, [agentType]: true }))}
                    >
                      <div className="relative bg-black/20 rounded-lg p-3 max-h-16 overflow-hidden border border-border/20">
                        <div className="text-xs text-muted-foreground font-mono line-clamp-2">
                          {displayOutput.substring(0, 180)}...
                        </div>
                        <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black/60 to-transparent rounded-b-lg" />
                      </div>
                      <p className="text-[11px] text-center text-muted-foreground mt-1.5 font-mono">
                        Nhấn để xem đầy đủ
                      </p>
                    </div>
                  )}
                </div>

                {/* Execution Plan Panel — shown right after CEO card */}
                {isCeo && taskStatus === "completed" && executionPlan && executionPlan.length > 0 && (
                  <ExecutionPlanPanel plan={executionPlan} tasks={tasks} />
                )}
              </React.Fragment>
            );
          })}

          {/* Empty state when no tasks exist */}
          {tasks.length === 0 && (
            <div className="rounded-xl border border-border/30 bg-card/20 p-8 text-center">
              <Sparkles className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-50" />
              <p className="text-sm text-muted-foreground">
                Nhấn <strong className="text-white">Auto Orchestrate</strong> để CEO phân tích và tự động lập kế hoạch.
              </p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

function ExecutionPlanPanel({ plan, tasks }: { plan: ExecutionPlanItem[]; tasks: any[] }) {
  return (
    <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="flex items-center gap-2">
        <GitBranch className="w-4 h-4 text-violet-400" />
        <span className="text-xs font-mono text-violet-400 uppercase tracking-wider">
          CEO Execution Plan
        </span>
        <span className="ml-auto text-[11px] font-mono text-muted-foreground">
          {plan.length} agents được chọn
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        CEO đã phân tích và quyết định kích hoạt các agents sau:
      </p>

      <div className="space-y-2">
        {plan.map((item) => {
          const config = AGENT_CONFIG[item.agent as AgentType];
          const Icon = config?.icon ?? GitBranch;
          const task = tasks.find((t) => t.agentType === item.agent);
          const statusIcon = task?.status === "completed"
            ? <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" />
            : task?.status === "running" || task?.status === "pending"
            ? <Loader2 className="w-3 h-3 text-amber-400 animate-spin shrink-0" />
            : task?.status === "failed"
            ? <XCircle className="w-3 h-3 text-red-400 shrink-0" />
            : <Clock className="w-3 h-3 text-muted-foreground shrink-0" />;

          return (
            <div
              key={item.agent}
              className="flex items-start gap-3 p-2.5 rounded-lg bg-black/20 border border-border/20"
            >
              {config && (
                <div className={`p-1.5 rounded-md shrink-0 ${config.bg} ${config.color}`}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-semibold ${config?.color ?? "text-white"}`}>
                    {config?.name ?? item.agent}
                  </span>
                  {statusIcon}
                  {task?.status && (
                    <span className={`text-[10px] font-mono ${
                      task.status === "completed" ? "text-green-400" :
                      task.status === "running" ? "text-amber-400" :
                      task.status === "failed" ? "text-red-400" :
                      "text-muted-foreground"
                    }`}>
                      {task.status === "completed" ? "Hoàn thành" :
                       task.status === "running" ? "Đang chạy..." :
                       task.status === "pending" ? "Đang chờ" :
                       task.status === "failed" ? "Thất bại" : task.status}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{item.reason}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusBadge({ status, isRunning }: { status: string; isRunning: boolean }) {
  if (isRunning || status === "running") {
    return (
      <Badge variant="outline" className="border-amber-500/50 text-amber-400 bg-amber-500/10 text-xs animate-pulse">
        Đang chạy
      </Badge>
    );
  }
  if (status === "completed") {
    return (
      <Badge variant="outline" className="border-green-500/50 text-green-400 bg-green-500/10 text-xs">
        Hoàn thành
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-primary/50 text-primary bg-primary/10 text-xs">
      {status === "draft" ? "Mới tạo" : status}
    </Badge>
  );
}

function TaskStatusBadge({ status }: { status: string }) {
  if (status === "completed") {
    return (
      <div className="flex items-center gap-1 mt-0.5">
        <CheckCircle2 className="w-3 h-3 text-green-400" />
        <span className="text-[11px] text-green-400 font-mono">Hoàn thành</span>
      </div>
    );
  }
  if (status === "running") {
    return (
      <div className="flex items-center gap-1 mt-0.5">
        <Loader2 className="w-3 h-3 text-amber-400 animate-spin" />
        <span className="text-[11px] text-amber-400 font-mono animate-pulse">Đang xử lý...</span>
      </div>
    );
  }
  if (status === "failed") {
    return (
      <div className="flex items-center gap-1 mt-0.5">
        <XCircle className="w-3 h-3 text-red-400" />
        <span className="text-[11px] text-red-400 font-mono">Thất bại</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 mt-0.5">
      <Clock className="w-3 h-3 text-muted-foreground" />
      <span className="text-[11px] text-muted-foreground font-mono">Chờ thực thi</span>
    </div>
  );
}
