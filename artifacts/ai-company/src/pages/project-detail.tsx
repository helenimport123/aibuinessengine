import React, { useState } from "react";
import { useRoute, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useGetProject, 
  getGetProjectQueryKey,
  useDeleteProject,
  getListProjectsQueryKey 
} from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Play, Activity, CheckCircle2, XCircle, Clock, Trash2, ArrowLeft, Loader2 } from "lucide-react";
import { AGENT_CONFIG, AgentType } from "@/lib/constants";

export default function ProjectDetail() {
  const [, params] = useRoute("/projects/:id");
  const projectId = parseInt(params?.id || "0");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useRoute("/");
  
  const { data: project, isLoading } = useGetProject(projectId, {
    query: {
      enabled: !!projectId,
      queryKey: getGetProjectQueryKey(projectId)
    }
  });

  const deleteProject = useDeleteProject();
  const [isRunningAll, setIsRunningAll] = useState(false);

  const handleRunAll = async () => {
    if (!project) return;
    setIsRunningAll(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/run-all`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to start run all");
      
      toast({
        title: "System Engaged",
        description: "All AI agents have been dispatched.",
      });
      
      // Ideally we would poll or subscribe to events here
      // For now, let's just invalidate query to see 'running' status
      queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
      
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Execution Error",
        description: "Failed to run agents.",
      });
    } finally {
      setIsRunningAll(false);
    }
  };

  const handleDelete = () => {
    if (confirm("Are you sure you want to terminate this project?")) {
      deleteProject.mutate({ id: projectId }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          toast({ title: "Project Terminated" });
          setLocation("/");
        }
      });
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="space-y-6">
          <Skeleton className="h-12 w-1/3 bg-muted/20" />
          <Skeleton className="h-32 w-full bg-muted/20" />
          <div className="agent-grid">
            {[1,2,3,4,5,6,7].map(i => <Skeleton key={i} className="h-40 bg-muted/20" />)}
          </div>
        </div>
      </Layout>
    );
  }

  if (!project) return <Layout>Project not found.</Layout>;

  return (
    <Layout>
      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <Link href="/">
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-white -ml-3 mb-2">
            <ArrowLeft className="w-4 h-4 mr-2" />
            RETURN TO COMMAND
          </Button>
        </Link>
        
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold tracking-tight text-white">{project.name}</h1>
              <Badge variant="outline" className={`
                font-mono text-xs uppercase
                ${project.status === 'completed' ? 'border-green-500/50 text-green-400 bg-green-500/10' : 
                  project.status === 'running' ? 'border-amber-500/50 text-amber-400 bg-amber-500/10' : 
                  'border-primary/50 text-primary bg-primary/10'}
              `}>
                {project.status}
              </Badge>
            </div>
            <p className="text-muted-foreground max-w-2xl">{project.businessIdea}</p>
            
            <div className="flex gap-4 mt-4 font-mono text-xs text-muted-foreground">
              {project.industry && <span>IND: {project.industry}</span>}
              {project.targetMarket && <span>MKT: {project.targetMarket}</span>}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/10" onClick={handleDelete}>
              <Trash2 className="w-4 h-4 mr-2" />
              TERMINATE
            </Button>
            <Button 
              className="bg-primary hover:bg-primary/80 text-primary-foreground font-bold shadow-[0_0_15px_rgba(34,211,238,0.4)]"
              onClick={handleRunAll}
              disabled={isRunningAll || project.status === 'completed'}
            >
              {isRunningAll ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
              {project.status === 'completed' ? "RE-RUN ALL" : "RUN ALL AGENTS"}
            </Button>
          </div>
        </div>

        {/* Global Progress */}
        <div className="mission-panel p-6 rounded-xl border border-primary/20">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-mono text-sm text-primary uppercase">System Overall Completion</h3>
            <span className="font-mono text-xl font-bold text-white">{project.completionPercent}%</span>
          </div>
          <Progress value={project.completionPercent} className="h-2" />
        </div>

        {/* Agents Grid */}
        <div className="agent-grid">
          {project.tasks.map((task) => {
            const config = AGENT_CONFIG[task.agentType as AgentType] || AGENT_CONFIG.ceo;
            const Icon = config.icon;
            const isCompleted = task.status === 'completed';
            const isRunning = task.status === 'running';
            const isFailed = task.status === 'failed';
            
            return (
              <Link key={task.id} href={`/projects/${project.id}/agents/${task.agentType}`}>
                <div className={`mission-panel p-6 rounded-xl border transition-all duration-300 cursor-pointer group hover:scale-[1.02]
                  ${config.border} ${isCompleted ? 'bg-muted/10' : ''} ${isRunning ? config.glow : ''}
                `}>
                  <div className="flex items-start justify-between mb-4">
                    <div className={`p-3 rounded-lg ${config.bg} ${config.color}`}>
                      <Icon className={`w-6 h-6 ${isRunning ? 'animate-pulse' : ''}`} />
                    </div>
                    <Badge variant="outline" className={`font-mono text-[10px] uppercase
                      ${isCompleted ? 'border-green-500/30 text-green-400' : 
                        isRunning ? 'border-amber-500/30 text-amber-400 animate-pulse' : 
                        isFailed ? 'border-destructive/30 text-destructive' :
                        'border-muted-foreground/30 text-muted-foreground'}
                    `}>
                      {isCompleted && <CheckCircle2 className="w-3 h-3 mr-1 inline" />}
                      {isRunning && <Activity className="w-3 h-3 mr-1 inline" />}
                      {isFailed && <XCircle className="w-3 h-3 mr-1 inline" />}
                      {(!isCompleted && !isRunning && !isFailed) && <Clock className="w-3 h-3 mr-1 inline" />}
                      {task.status}
                    </Badge>
                  </div>
                  
                  <h3 className="text-lg font-bold text-white mb-2 group-hover:text-primary transition-colors">
                    {config.name}
                  </h3>
                  
                  <p className="text-xs text-muted-foreground line-clamp-2 min-h-[2rem]">
                    {isCompleted ? "Task completed. Click to view full report." : 
                     isRunning ? "Agent is currently synthesizing data..." :
                     isFailed ? "Agent encountered an error." :
                     "Awaiting execution command."}
                  </p>
                  
                  {isCompleted && task.output && (
                    <div className="mt-4 p-3 bg-black/30 rounded border border-white/5 font-mono text-xs text-muted-foreground overflow-hidden h-16 relative">
                      <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/80 z-10" />
                      {task.output.substring(0, 100)}...
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </Layout>
  );
}
