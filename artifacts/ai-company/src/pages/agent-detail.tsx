import React, { useState, useEffect, useRef } from "react";
import { useRoute, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useGetProject, 
  getGetProjectQueryKey
} from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Play, ArrowLeft, Terminal, AlertTriangle, CheckCircle2 } from "lucide-react";
import { AGENT_CONFIG, AgentType } from "@/lib/constants";
import ReactMarkdown from "react-markdown";

export default function AgentDetail() {
  const [, params] = useRoute("/projects/:id/agents/:agentType");
  const projectId = parseInt(params?.id || "0");
  const agentType = params?.agentType as AgentType;
  
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: project, isLoading } = useGetProject(projectId, {
    query: {
      enabled: !!projectId,
      queryKey: getGetProjectQueryKey(projectId)
    }
  });

  const task = project?.tasks.find(t => t.agentType === agentType);
  const config = AGENT_CONFIG[agentType] || AGENT_CONFIG.ceo;

  const [isStreaming, setIsStreaming] = useState(false);
  const [streamedOutput, setStreamedOutput] = useState("");
  const outputEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll when streaming
  useEffect(() => {
    if (isStreaming && outputEndRef.current) {
      outputEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [streamedOutput, isStreaming]);

  const handleRunAgent = async () => {
    if (!projectId || !agentType) return;
    
    setIsStreaming(true);
    setStreamedOutput("");
    
    // Set task to running optimistically
    queryClient.setQueryData(getGetProjectQueryKey(projectId), (old: any) => {
      if (!old) return old;
      return {
        ...old,
        tasks: old.tasks.map((t: any) => t.agentType === agentType ? { ...t, status: 'running' } : t)
      };
    });

    try {
      const res = await fetch(`/api/projects/${projectId}/agents/${agentType}/run`, { 
        method: "POST" 
      });
      
      if (!res.body) throw new Error("No response body");
      
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const text = decoder.decode(value);
        const lines = text.split("\n").filter(l => l.trim().startsWith("data: "));
        
        for (const line of lines) {
          try {
            const data = JSON.parse(line.substring(6));
            if (data.done) {
              break;
            }
            if (data.content) {
              setStreamedOutput(prev => prev + data.content);
            }
            if (data.error) {
              throw new Error(data.error);
            }
          } catch (e) {
            // ignore parse errors for partial chunks
          }
        }
      }
      
      // Refetch to get final state
      queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
      toast({ title: "Agent Execution Complete" });
      
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Execution Failed",
        description: err instanceof Error ? err.message : "Unknown error",
      });
      queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
    } finally {
      setIsStreaming(false);
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="space-y-6">
          <Skeleton className="h-12 w-1/3 bg-muted/20" />
          <Skeleton className="h-64 w-full bg-muted/20" />
        </div>
      </Layout>
    );
  }

  if (!project || !task) {
    return <Layout>Agent details not found.</Layout>;
  }

  const Icon = config.icon;
  const isRunning = task.status === 'running' || isStreaming;
  const displayOutput = isStreaming ? streamedOutput : task.output;

  return (
    <Layout>
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col">
        <Link href={`/projects/${projectId}`}>
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-white -ml-3 mb-2">
            <ArrowLeft className="w-4 h-4 mr-2" />
            BACK TO {project.name}
          </Button>
        </Link>

        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-6 mission-panel rounded-xl border-border/50">
          <div className="flex items-center gap-4">
            <div className={`p-4 rounded-xl ${config.bg} ${config.color} ${config.border} border ${isRunning ? 'animate-pulse shadow-[0_0_20px_rgba(var(--primary),0.3)]' : ''}`}>
              <Icon className="w-8 h-8" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight text-white">{config.name}</h1>
                <Badge variant="outline" className={`font-mono text-xs uppercase
                  ${task.status === 'completed' ? 'border-green-500/30 text-green-400 bg-green-500/10' : 
                    task.status === 'running' ? 'border-amber-500/30 text-amber-400 bg-amber-500/10' : 
                    task.status === 'failed' ? 'border-destructive/30 text-destructive bg-destructive/10' :
                    'border-muted-foreground/30 text-muted-foreground bg-muted/10'}
                `}>
                  {task.status}
                </Badge>
              </div>
              <p className="text-muted-foreground text-sm font-mono mt-1 flex items-center gap-2">
                <Terminal className="w-4 h-4" /> 
                Task ID: {task.id} | Project: {project.name}
              </p>
            </div>
          </div>

          <Button 
            className={`min-w-[150px] font-bold ${isRunning ? 'bg-amber-500/20 text-amber-500 hover:bg-amber-500/30 border border-amber-500/50' : 'bg-primary hover:bg-primary/80 text-primary-foreground shadow-[0_0_15px_rgba(34,211,238,0.4)]'}`}
            onClick={handleRunAgent}
            disabled={isRunning}
          >
            {isRunning ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
                PROCESSING
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Play className="w-4 h-4" />
                {task.status === 'completed' ? 'RE-RUN AGENT' : 'EXECUTE AGENT'}
              </span>
            )}
          </Button>
        </div>

        {task.errorMessage && (
          <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-lg flex items-start gap-3 text-destructive">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-bold text-sm uppercase mb-1">Execution Error</h4>
              <p className="text-sm opacity-90">{task.errorMessage}</p>
            </div>
          </div>
        )}

        <div className="flex-1 mission-panel rounded-xl border border-border/50 flex flex-col overflow-hidden min-h-[400px]">
          <div className="p-3 border-b border-border/50 bg-black/40 flex items-center gap-3 font-mono text-xs text-muted-foreground uppercase">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/50" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
              <div className="w-3 h-3 rounded-full bg-green-500/50" />
            </div>
            Output Terminal // {agentType}.log
          </div>
          
          <div className="p-6 flex-1 overflow-auto bg-[#0a0a0a] text-gray-300 font-sans">
            {!displayOutput && !isRunning ? (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50 font-mono">
                <Terminal className="w-12 h-12 mb-4" />
                <p>Awaiting execution command.</p>
              </div>
            ) : (
              <div className="prose prose-invert max-w-none prose-pre:bg-white/5 prose-pre:border prose-pre:border-white/10 prose-headings:text-white prose-a:text-primary">
                <ReactMarkdown>{displayOutput || ""}</ReactMarkdown>
                {isRunning && (
                  <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1 align-middle" />
                )}
                <div ref={outputEndRef} />
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
