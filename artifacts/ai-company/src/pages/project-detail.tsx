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
} from "lucide-react";
import { AGENT_CONFIG, AGENT_ORDER, AgentType } from "@/lib/constants";

type AgentStreamState = {
  streaming: boolean;
  text: string;
};

export default function ProjectDetail() {
  const [, params] = useRoute("/projects/:id");
  const projectId = parseInt(params?.id || "0");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useRoute("/");

  const { data: project, isLoading } = useGetProject(projectId, {
    query: {
      enabled: !!projectId,
      queryKey: getGetProjectQueryKey(projectId),
      refetchInterval: 4000,
    },
  });

  const deleteProject = useDeleteProject();

  // Per-agent streaming state
  const [agentStreams, setAgentStreams] = useState<Record<string, AgentStreamState>>({});
  // Per-agent expanded/collapsed output
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Running-all flag
  const [runningAll, setRunningAll] = useState(false);

  const bottomRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Auto-scroll when streaming
  useEffect(() => {
    for (const type of AGENT_ORDER) {
      if (agentStreams[type]?.streaming) {
        bottomRefs.current[type]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [agentStreams]);

  const runAgent = useCallback(
    async (agentType: string) => {
      if (!projectId) return;

      // Optimistic UI
      setAgentStreams((prev) => ({ ...prev, [agentType]: { streaming: true, text: "" } }));
      setExpanded((prev) => ({ ...prev, [agentType]: true }));

      // Optimistically mark task as running
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
        const res = await fetch(`/api/projects/${projectId}/agents/${agentType}/run`, {
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
              if (evt.text) {
                setAgentStreams((prev) => ({
                  ...prev,
                  [agentType]: {
                    streaming: true,
                    text: (prev[agentType]?.text ?? "") + evt.text,
                  },
                }));
              }
              if (evt.done) break;
            } catch {
              /* ignore parse errors */
            }
          }
        }

        // Stream finished — clear local stream and refetch from DB
        setAgentStreams((prev) => ({ ...prev, [agentType]: { streaming: false, text: "" } }));
        queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      } catch (err) {
        setAgentStreams((prev) => ({ ...prev, [agentType]: { streaming: false, text: "" } }));
        queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
        toast({
          variant: "destructive",
          title: `${AGENT_CONFIG[agentType as AgentType]?.name ?? agentType} thất bại`,
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
      await fetch(`/api/projects/${projectId}/run-all`, { method: "POST" });
      toast({ title: "Đã kích hoạt 3 AI agents", description: "Các agents đang chạy song song." });
      queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
    } catch {
      toast({ variant: "destructive", title: "Lỗi", description: "Không thể chạy tất cả agents." });
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
            <Button
              size="sm"
              className="bg-primary hover:bg-primary/80 text-primary-foreground font-semibold shadow-[0_0_12px_rgba(34,211,238,0.35)] text-xs"
              onClick={handleRunAll}
              disabled={runningAll || anyAgentRunning}
            >
              {runningAll ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5 mr-1.5" />
              )}
              Chạy Tất Cả Agents
            </Button>
          </div>
        </div>

        {/* Progress */}
        <div className="rounded-xl border border-primary/20 bg-card/30 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono text-primary uppercase tracking-wider">Tiến Độ Tổng Thể</span>
            <span className="text-sm font-bold text-white font-mono">{project.completionPercent}%</span>
          </div>
          <Progress value={project.completionPercent} className="h-1.5" />
        </div>

        {/* Agent Cards */}
        <div className="space-y-4">
          {AGENT_ORDER.map((agentType) => {
            const config = AGENT_CONFIG[agentType];
            const Icon = config.icon;
            const task = project.tasks?.find((t) => t.agentType === agentType);
            const stream = agentStreams[agentType];
            const isStreaming = stream?.streaming ?? false;
            const streamText = stream?.text ?? "";
            const isOpen = expanded[agentType] ?? false;

            // What output to display: streamed text (live) or saved output (from DB)
            const displayOutput = isStreaming ? streamText : (task?.output ?? null);
            const hasOutput = !!displayOutput;

            const taskStatus = isStreaming ? "running" : (task?.status ?? "pending");

            return (
              <div
                key={agentType}
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
                      </div>
                      <TaskStatusBadge status={taskStatus} />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
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

                {/* Streaming indicator */}
                {isStreaming && (
                  <div className={`px-4 pb-2 flex items-center gap-2 text-xs ${config.color} font-mono`}>
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                    AI đang phân tích...
                  </div>
                )}

                {/* Output */}
                {hasOutput && (isOpen || isStreaming) && (
                  <div className="border-t border-border/40 mx-4 mb-4 pt-4">
                    <div className="bg-black/20 rounded-lg p-4 max-h-[500px] overflow-y-auto">
                      <div className="prose prose-sm prose-invert max-w-none text-[13px] leading-relaxed">
                        <ReactMarkdown>{displayOutput}</ReactMarkdown>
                      </div>
                      <div
                        ref={(el) => {
                          bottomRefs.current[agentType] = el;
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Empty state preview for completed tasks (collapsed) */}
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
            );
          })}
        </div>
      </div>
    </Layout>
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
