import React, { useEffect, useState, useRef } from "react";
import { Link } from "wouter";
import { useListProjects } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import {
  PlusCircle, Activity, Box, CheckCircle2, ChevronRight,
  Hexagon, Server, Loader2, Clock, XCircle, Cpu, Zap
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "";

type JobUpdate = {
  type: "job_queued" | "job_started" | "job_completed" | "job_failed";
  taskId: number;
  agentType: string;
  agentName: string;
  projectId: number;
  projectName?: string;
  workerId?: string;
  tokens?: number;
  cost?: number;
  error?: string;
};

type LiveJob = {
  taskId: number;
  agentType: string;
  agentName: string;
  projectId: number;
  projectName: string;
  status: "queued" | "running" | "completed" | "failed";
  workerId?: string;
  tokens?: number;
  cost?: number;
  error?: string;
  updatedAt: number;
};

const AGENT_COLORS: Record<string, string> = {
  ceo: "text-primary border-primary/50 bg-primary/10",
  marketing: "text-pink-400 border-pink-500/50 bg-pink-500/10",
  sales: "text-orange-400 border-orange-500/50 bg-orange-500/10",
  cskh: "text-sky-400 border-sky-500/50 bg-sky-500/10",
  hr: "text-violet-400 border-violet-500/50 bg-violet-500/10",
  accountant: "text-emerald-400 border-emerald-500/50 bg-emerald-500/10",
  legal: "text-yellow-400 border-yellow-500/50 bg-yellow-500/10",
};

function JobStatusIcon({ status }: { status: LiveJob["status"] }) {
  if (status === "running") return <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />;
  if (status === "queued") return <Clock className="w-3.5 h-3.5 text-primary" />;
  if (status === "completed") return <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />;
  return <XCircle className="w-3.5 h-3.5 text-red-400" />;
}

function JobCard({ job }: { job: LiveJob }) {
  const colorCls = AGENT_COLORS[job.agentType] ?? "text-muted-foreground border-border bg-muted/10";
  return (
    <div className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-xs font-mono ${colorCls}`}>
      <JobStatusIcon status={job.status} />
      <div className="flex-1 min-w-0">
        <div className="font-semibold truncate">{job.agentName}</div>
        <div className="text-muted-foreground truncate">{job.projectName}</div>
      </div>
      {job.status === "running" && job.workerId && (
        <span className="text-muted-foreground shrink-0">{job.workerId}</span>
      )}
      {job.status === "completed" && job.tokens != null && (
        <span className="text-muted-foreground shrink-0">{job.tokens.toLocaleString()}t</span>
      )}
      {job.status === "failed" && (
        <span className="text-red-400 shrink-0 max-w-[6rem] truncate">{job.error}</span>
      )}
    </div>
  );
}

function JobQueuePanel() {
  const [jobs, setJobs] = useState<LiveJob[]>([]);
  const [sseStatus, setSseStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const jobsRef = useRef<LiveJob[]>([]);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    const es = new EventSource(`${BASE}/api/jobs/stream`);

    es.onopen = () => setSseStatus("connected");
    es.onerror = () => setSseStatus("error");

    es.onmessage = (evt) => {
      try {
        const raw = JSON.parse(evt.data) as { type: string };

        if (raw.type === "connected" || raw.type === "heartbeat") return;

        const evt2 = raw as unknown as JobUpdate;
        const now = Date.now();

        setJobs((prev) => {
          const filtered = prev.filter((j) => j.taskId !== evt2.taskId);
          let status: LiveJob["status"] = "queued";
          if (evt2.type === "job_started") status = "running";
          else if (evt2.type === "job_completed") status = "completed";
          else if (evt2.type === "job_failed") status = "failed";

          const updated: LiveJob = {
            taskId: evt2.taskId,
            agentType: evt2.agentType,
            agentName: evt2.agentName,
            projectId: evt2.projectId,
            projectName: evt2.projectName ?? `Project #${evt2.projectId}`,
            workerId: evt2.workerId,
            status,
            tokens: evt2.tokens,
            cost: evt2.cost,
            error: evt2.error,
            updatedAt: now,
          };

          // Keep max 20, sorted newest first
          return [updated, ...filtered].slice(0, 20);
        });
      } catch {}
    };

    return () => es.close();
  }, []);

  const running = jobs.filter((j) => j.status === "running");
  const queued = jobs.filter((j) => j.status === "queued");
  const recent = jobs.filter((j) => j.status === "completed" || j.status === "failed").slice(0, 5);

  const hasActivity = running.length > 0 || queued.length > 0;

  return (
    <Card className="mission-panel border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-mono uppercase flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-primary">
            <Cpu className="w-4 h-4" />
            WORKER.QUEUE
          </span>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${sseStatus === "connected" ? "bg-green-400 animate-pulse" : sseStatus === "error" ? "bg-red-400" : "bg-amber-400 animate-pulse"}`} />
            <span className="text-muted-foreground font-normal capitalize text-xs">{sseStatus}</span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {running.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-mono text-muted-foreground uppercase">▶ Running ({running.length})</p>
            {running.map((j) => <JobCard key={j.taskId} job={j} />)}
          </div>
        )}
        {queued.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-mono text-muted-foreground uppercase">◷ Queued ({queued.length})</p>
            {queued.map((j) => <JobCard key={j.taskId} job={j} />)}
          </div>
        )}
        {recent.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-mono text-muted-foreground uppercase">✓ Recent</p>
            {recent.map((j) => <JobCard key={j.taskId} job={j} />)}
          </div>
        )}
        {!hasActivity && recent.length === 0 && (
          <div className="text-center py-6 text-muted-foreground text-xs font-mono">
            <Zap className="w-6 h-6 mx-auto mb-2 opacity-30" />
            <p>No jobs in queue.</p>
            <p className="opacity-60 mt-1">Use AUTO ORCHESTRATE on a project to start.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { data: projects, isLoading } = useListProjects();

  const totalProjects = projects?.length || 0;
  const completedProjects = projects?.filter(p => p.status === "completed").length || 0;
  const runningProjects = projects?.filter(p => p.status === "running").length || 0;

  return (
    <Layout>
      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white mb-2 flex items-center gap-3">
              <Server className="w-8 h-8 text-primary" />
              SYSTEM.COMMAND
            </h1>
            <p className="text-muted-foreground font-mono text-sm">Main operations terminal. Global project overview.</p>
          </div>
          <Link href="/new">
            <Button className="gap-2 bg-primary hover:bg-primary/80 text-primary-foreground font-semibold shadow-[0_0_15px_rgba(34,211,238,0.4)] transition-all">
              <PlusCircle className="w-4 h-4" />
              KHỞI TẠO DỰ ÁN
            </Button>
          </Link>
        </div>

        {/* Global Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="mission-panel border-primary/20">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="p-4 rounded-lg bg-primary/10 border border-primary/30 text-primary">
                <Box className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-mono text-muted-foreground mb-1 uppercase">Tổng Dự Án</p>
                <div className="text-3xl font-bold text-white">
                  {isLoading ? <Skeleton className="h-9 w-16" /> : totalProjects}
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="mission-panel border-green-500/20">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-mono text-muted-foreground mb-1 uppercase">Đã Hoàn Thành</p>
                <div className="text-3xl font-bold text-white">
                  {isLoading ? <Skeleton className="h-9 w-16" /> : completedProjects}
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="mission-panel border-amber-500/20">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400">
                <Activity className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-mono text-muted-foreground mb-1 uppercase">Đang Xử Lý</p>
                <div className="text-3xl font-bold text-white">
                  {isLoading ? <Skeleton className="h-9 w-16" /> : runningProjects}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main content — projects + job queue side-by-side on large screens */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Project List — 2/3 width */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-lg font-mono text-white flex items-center gap-2 border-b border-border/50 pb-2">
              <Hexagon className="w-5 h-5 text-primary" />
              ACTIVE.PROJECTS
            </h2>

            {isLoading ? (
              <div className="space-y-3">
                {[1,2,3].map(i => (
                  <Skeleton key={i} className="h-24 w-full rounded-xl bg-muted/20" />
                ))}
              </div>
            ) : projects && projects.length > 0 ? (
              <div className="grid gap-4">
                {projects.map(project => (
                  <Link key={project.id} href={`/projects/${project.id}`}>
                    <Card className="mission-panel neon-border cursor-pointer group hover:bg-muted/10 transition-colors">
                      <CardContent className="p-0 flex flex-col md:flex-row items-start md:items-center">
                        <div className="p-6 flex-1 w-full space-y-3">
                          <div className="flex items-center justify-between">
                            <h3 className="text-xl font-bold text-white group-hover:text-primary transition-colors">
                              {project.name}
                            </h3>
                            <Badge variant="outline" className={`
                              font-mono text-xs uppercase
                              ${project.status === 'completed' ? 'border-green-500/50 text-green-400 bg-green-500/10' :
                                project.status === 'running' ? 'border-amber-500/50 text-amber-400 bg-amber-500/10' :
                                'border-primary/50 text-primary bg-primary/10'}
                            `}>
                              {project.status}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-1">
                            {project.businessIdea}
                          </p>
                          <div className="flex items-center gap-4">
                            <div className="flex-1">
                              <Progress value={project.completionPercent} className="h-1.5" />
                            </div>
                            <span className="text-xs font-mono text-primary min-w-[3rem] text-right">
                              {project.completionPercent}%
                            </span>
                          </div>
                        </div>
                        <div className="hidden md:flex p-6 border-l border-border/50 items-center justify-center text-muted-foreground group-hover:text-primary transition-colors h-full">
                          <ChevronRight className="w-6 h-6" />
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            ) : (
              <Card className="mission-panel border-dashed">
                <CardContent className="p-12 text-center text-muted-foreground flex flex-col items-center justify-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-muted/20 flex items-center justify-center border border-border">
                    <Box className="w-8 h-8 opacity-50" />
                  </div>
                  <div>
                    <p className="mb-2 font-mono text-sm uppercase tracking-wider">No Projects Found</p>
                    <p className="text-sm opacity-70">Initialize a new project to deploy AI agents.</p>
                  </div>
                  <Link href="/new">
                    <Button variant="outline" className="mt-4 border-primary/30 text-primary hover:bg-primary/10">
                      Tạo Dự Án Mới
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Job Queue Panel — 1/3 width */}
          <div className="lg:col-span-1">
            <h2 className="text-lg font-mono text-white flex items-center gap-2 border-b border-border/50 pb-2 mb-4">
              <Cpu className="w-5 h-5 text-primary" />
              BACKGROUND.JOBS
            </h2>
            <JobQueuePanel />
          </div>
        </div>
      </div>
    </Layout>
  );
}
