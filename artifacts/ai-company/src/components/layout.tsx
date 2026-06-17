import React from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, PlusCircle, Terminal, MessageCircle, Brain } from "lucide-react";
import { cn } from "@/lib/utils";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/new", label: "Tạo Dự Án", icon: PlusCircle },
    { href: "/company-chat", label: "Company Chat", icon: Brain },
    { href: "/chat", label: "AI Memory Chat", icon: MessageCircle },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row dark">
      {/* Sidebar */}
      <aside className="w-full md:w-60 border-r border-border bg-card/50 backdrop-blur-xl flex flex-col z-20 shrink-0">
        <div className="p-5 flex items-center gap-3 border-b border-border/50">
          <div className="w-8 h-8 rounded bg-primary/20 flex items-center justify-center border border-primary/50 shadow-[0_0_10px_rgba(34,211,238,0.2)]">
            <Terminal className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h1 className="font-bold text-sm tracking-widest text-primary uppercase">AI COMPANY</h1>
            <p className="text-[10px] text-muted-foreground font-mono uppercase">in-a-box · v1</p>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-3 px-2">Menu</p>
          {navItems.map((item) => {
            const active = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href}>
                <div className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200 cursor-pointer",
                  active
                    ? "bg-primary/10 text-primary border border-primary/20 shadow-[inset_0_0_10px_rgba(34,211,238,0.1)]"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent"
                )}>
                  <item.icon className={cn("w-4 h-4", active ? "text-primary" : "text-muted-foreground")} />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border/50">
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/50 border border-border/50">
            <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)] animate-pulse" />
            <span className="text-xs font-mono text-muted-foreground">SYSTEM ONLINE</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative overflow-hidden min-w-0">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
            maskImage: "radial-gradient(ellipse at top, black, transparent 80%)",
          }}
        />
        <div className="flex-1 overflow-auto relative z-10 p-6 md:p-8">
          <div className="max-w-5xl mx-auto w-full">{children}</div>
        </div>
      </main>
    </div>
  );
}
