import React from "react";
import { Link } from "wouter";
import { useListProjects } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { PlusCircle, Activity, Box, CheckCircle2, ChevronRight, Hexagon, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

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

        {/* Project List */}
        <div className="space-y-4">
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
      </div>
    </Layout>
  );
}
