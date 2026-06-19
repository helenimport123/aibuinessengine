import React, { useState, useEffect, useRef, useCallback } from "react";
import { useListProjects } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";
import {
  Send,
  Bot,
  User,
  ChevronDown,
  Loader2,
  Brain,
  CheckCircle2,
  Circle,
  MessageSquare,
  Sparkles,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Project = { id: number; name: string; status: string; businessIdea: string };

type MemoryStatus = {
  projectId: number;
  projectName: string;
  loaded: {
    ceo_report: boolean;
    marketing_plan: boolean;
    sales_playbook: boolean;
    hr_plan: boolean;
    cskh_plan: boolean;
    accountant_plan: boolean;
    legal_plan: boolean;
    chat_history: number;
  };
};

type HistoryEntry = { id: number; content: string; createdAt: string };

type ChatMessage = {
  id: number;
  role: "user" | "advisor";
  content: string;
};

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}/api${path}`, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

const SUGGESTED_QUESTIONS = [
  { label: "Khách hàng mục tiêu là ai?", icon: "👥" },
  { label: "CEO đã đề xuất gì?", icon: "🎯" },
  { label: "Kế hoạch marketing là gì?", icon: "📣" },
  { label: "Sales playbook của dự án?", icon: "💼" },
  { label: "Ngân sách marketing bao nhiêu?", icon: "💰" },
  { label: "Đối thủ cạnh tranh chính là ai?", icon: "⚔️" },
  { label: "KPI nào cần theo dõi?", icon: "📊" },
  { label: "Chiến lược định vị thương hiệu?", icon: "🏆" },
  { label: "Kế hoạch tuyển dụng như thế nào?", icon: "🧑‍💼" },
  { label: "Quy trình CSKH ra sao?", icon: "🎧" },
  { label: "Chi phí khởi nghiệp dự kiến bao nhiêu?", icon: "📈" },
  { label: "Cần giấy phép gì để thành lập?", icon: "⚖️" },
];

const MEMORY_LABELS: Record<string, string> = {
  ceo_report: "Báo cáo CEO",
  marketing_plan: "Marketing Plan",
  sales_playbook: "Sales Playbook",
  hr_plan: "HR Plan",
  cskh_plan: "CSKH Plan",
  accountant_plan: "Tài Chính",
  legal_plan: "Pháp Lý",
};

const MEMORY_ICONS: Record<string, string> = {
  ceo_report: "🎯",
  marketing_plan: "📣",
  sales_playbook: "💼",
  hr_plan: "🧑‍💼",
  cskh_plan: "🎧",
  accountant_plan: "📈",
  legal_plan: "⚖️",
};

export default function CompanyChatPage() {
  const { data: projectsData } = useListProjects();
  const projects: Project[] = Array.isArray(projectsData) ? projectsData : [];
  const { toast } = useToast();

  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [showProjectDrop, setShowProjectDrop] = useState(false);
  const [memoryStatus, setMemoryStatus] = useState<MemoryStatus | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  // Auto-select first project
  useEffect(() => {
    if (projects.length > 0 && !selectedProjectId) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  // Load memory status + history when project changes
  useEffect(() => {
    if (!selectedProjectId) return;

    setMemoryStatus(null);
    setMessages([]);

    apiFetch(`/advisor/${selectedProjectId}/status`)
      .then((r) => r.json())
      .then(setMemoryStatus)
      .catch(() => {});

    setLoadingHistory(true);
    apiFetch(`/advisor/${selectedProjectId}/history`)
      .then((r) => r.json())
      .then((entries: HistoryEntry[]) => {
        const parsed: ChatMessage[] = [];
        entries.reverse().forEach((e, i) => {
          const lines = e.content.split("\n");
          const qLine = lines.find((l) => l.startsWith("[Câu hỏi]:"));
          const aLines = lines.filter((l) => l.startsWith("[Advisor]:") || (!l.startsWith("[Câu hỏi]:") && lines.indexOf(l) > 0));
          const aLine = lines.find((l) => l.startsWith("[Advisor]:"));

          if (qLine) {
            parsed.push({ id: i * 2, role: "user", content: qLine.replace("[Câu hỏi]: ", "") });
          }
          if (aLine) {
            parsed.push({ id: i * 2 + 1, role: "advisor", content: aLine.replace("[Advisor]: ", "") });
          }
        });
        setMessages(parsed);
      })
      .catch(() => {})
      .finally(() => setLoadingHistory(false));
  }, [selectedProjectId]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText]);

  const ask = useCallback(async (question: string) => {
    if (!question.trim() || !selectedProjectId || streaming) return;

    setInput("");
    setStreaming(true);
    setStreamText("");

    const userMsg: ChatMessage = { id: Date.now(), role: "user", content: question };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch(`${BASE}/api/advisor/${selectedProjectId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullResponse = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6).trim());
            if (evt.content) {
              fullResponse += evt.content;
              setStreamText(fullResponse);
            }
            if (evt.done || evt.error) break;
          } catch {}
        }
      }

      const advisorMsg: ChatMessage = { id: Date.now() + 1, role: "advisor", content: fullResponse };
      setMessages((prev) => [...prev, advisorMsg]);
      setStreamText("");

      // Refresh memory status (chat_history count increases)
      apiFetch(`/advisor/${selectedProjectId}/status`)
        .then((r) => r.json())
        .then(setMemoryStatus)
        .catch(() => {});
    } catch {
      toast({ variant: "destructive", title: "Lỗi kết nối", description: "Không thể gửi câu hỏi. Thử lại." });
    } finally {
      setStreaming(false);
    }
  }, [selectedProjectId, streaming, toast]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask(input);
    }
  };

  const clearChat = () => setMessages([]);

  const hasAnyMemory = memoryStatus && (
    memoryStatus.loaded.ceo_report ||
    memoryStatus.loaded.marketing_plan ||
    memoryStatus.loaded.sales_playbook ||
    memoryStatus.loaded.hr_plan ||
    memoryStatus.loaded.cskh_plan ||
    memoryStatus.loaded.accountant_plan ||
    memoryStatus.loaded.legal_plan
  );

  return (
    <Layout>
      <div className="flex flex-col h-[calc(100vh-4rem)] -m-6 md:-m-8 animate-in fade-in duration-300">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-border/50 bg-card/30 backdrop-blur shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 border border-primary/30 shadow-[0_0_10px_rgba(34,211,238,0.15)]">
              <Brain className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-white uppercase tracking-wider">Company Chat</h1>
              <p className="text-[10px] text-muted-foreground font-mono">Advisor Agent · Đọc toàn bộ project memory</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                onClick={clearChat}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono text-muted-foreground hover:text-white transition-colors"
                title="Xóa lịch sử chat hiện tại"
              >
                <RotateCcw className="w-3 h-3" />
                Xóa chat
              </button>
            )}

            {/* Project Selector */}
            <div className="relative">
              <button
                onClick={() => setShowProjectDrop((v) => !v)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/50 bg-muted/20 hover:bg-muted/40 transition-colors"
              >
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span className="text-white text-xs font-mono max-w-[160px] truncate">
                  {selectedProject ? selectedProject.name : "Chọn dự án..."}
                </span>
                <ChevronDown className="w-3 h-3 text-muted-foreground" />
              </button>

              {showProjectDrop && (
                <div className="absolute right-0 top-full mt-1 w-72 rounded-lg border border-border/50 bg-card shadow-xl z-50 overflow-hidden">
                  <div className="p-2 border-b border-border/30">
                    <p className="text-[10px] font-mono text-muted-foreground px-2 uppercase tracking-wider">Chọn Dự Án</p>
                  </div>
                  <div className="max-h-52 overflow-y-auto">
                    {projects.length === 0 ? (
                      <p className="px-3 py-4 text-xs text-muted-foreground text-center">Chưa có dự án</p>
                    ) : (
                      projects.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => { setSelectedProjectId(p.id); setShowProjectDrop(false); }}
                          className={cn(
                            "w-full text-left px-3 py-2.5 text-xs hover:bg-muted/30 transition-colors border-b border-border/10 last:border-0",
                            selectedProjectId === p.id ? "text-primary bg-primary/10" : "text-white"
                          )}
                        >
                          <div className="font-medium truncate">{p.name}</div>
                          <div className="text-muted-foreground text-[10px] truncate mt-0.5">{p.businessIdea}</div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Memory Status Bar ── */}
        {memoryStatus && (
          <div className="flex items-center gap-3 px-6 py-2 border-b border-border/30 bg-card/10 shrink-0 overflow-x-auto">
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider shrink-0">Memory:</span>
            {Object.entries(MEMORY_LABELS).map(([key, label]) => {
              const loaded = memoryStatus.loaded[key as keyof typeof memoryStatus.loaded] as boolean;
              return (
                <div
                  key={key}
                  className={cn(
                    "flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono border shrink-0 transition-colors",
                    loaded
                      ? "border-green-500/40 bg-green-500/10 text-green-400"
                      : "border-border/30 bg-muted/10 text-muted-foreground/50"
                  )}
                >
                  {loaded
                    ? <CheckCircle2 className="w-2.5 h-2.5" />
                    : <Circle className="w-2.5 h-2.5" />}
                  {label}
                </div>
              );
            })}
            {memoryStatus.loaded.chat_history > 0 && (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono border border-primary/30 bg-primary/5 text-primary/70 shrink-0">
                <MessageSquare className="w-2.5 h-2.5" />
                {memoryStatus.loaded.chat_history} lịch sử
              </div>
            )}
          </div>
        )}

        {/* ── Chat Body ── */}
        <div
          className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-5"
          onClick={() => setShowProjectDrop(false)}
        >
          {!selectedProjectId ? (
            <EmptyState type="no-project" />
          ) : loadingHistory ? (
            <div className="space-y-4 max-w-3xl mx-auto">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full bg-muted/20 rounded-2xl" />)}
            </div>
          ) : messages.length === 0 && !streaming ? (
            <WelcomeState
              project={selectedProject}
              memoryStatus={memoryStatus}
              onAsk={ask}
            />
          ) : (
            <div className="max-w-3xl mx-auto space-y-5">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}

              {/* Streaming response */}
              {streaming && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0 mt-0.5">
                    <Brain className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 bg-card/40 border border-border/40 rounded-2xl rounded-tl-none px-5 py-4">
                    {streamText ? (
                      <>
                        <div className="prose prose-sm prose-invert max-w-none text-[13px] leading-relaxed">
                          <ReactMarkdown>{streamText}</ReactMarkdown>
                        </div>
                        <span className="inline-block w-0.5 h-4 bg-primary animate-pulse ml-0.5 align-middle" />
                      </>
                    ) : (
                      <div className="flex items-center gap-1.5 py-1">
                        <span className="text-[11px] font-mono text-muted-foreground mr-1">Advisor đang đọc memory</span>
                        {[0, 150, 300].map((delay) => (
                          <div
                            key={delay}
                            className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce"
                            style={{ animationDelay: `${delay}ms` }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* ── Input ── */}
        {selectedProjectId && (
          <div className="border-t border-border/50 px-4 md:px-8 py-4 bg-card/20 shrink-0">
            {!hasAnyMemory && memoryStatus && (
              <div className="flex items-center gap-2 mb-2 px-1">
                <Sparkles className="w-3 h-3 text-amber-400/70" />
                <span className="text-[10px] font-mono text-amber-400/70">
                  Chưa có dữ liệu — hãy chạy Auto Orchestrate trên dự án trước
                </span>
              </div>
            )}
            <div className="flex gap-3 items-end max-w-3xl mx-auto">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={selectedProject ? `Hỏi về "${selectedProject.name}"...` : "Nhập câu hỏi..."}
                rows={1}
                className="flex-1 resize-none bg-muted/20 border border-border/50 rounded-xl px-4 py-3 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:bg-muted/30 transition-all font-mono min-h-[46px] max-h-36"
                style={{ height: "auto" }}
                onInput={(e) => {
                  const t = e.currentTarget;
                  t.style.height = "auto";
                  t.style.height = Math.min(t.scrollHeight, 144) + "px";
                }}
                disabled={streaming}
              />
              <Button
                onClick={() => ask(input)}
                disabled={!input.trim() || streaming}
                className="bg-primary hover:bg-primary/80 text-primary-foreground shadow-[0_0_15px_rgba(34,211,238,0.3)] shrink-0 h-[46px] w-[46px] p-0 rounded-xl"
              >
                {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5 font-mono text-center max-w-3xl mx-auto">
              Enter để gửi · Shift+Enter xuống dòng · Advisor Agent tổng hợp toàn bộ dữ liệu
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
      <div className={cn(
        "w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5",
        isUser
          ? "bg-muted/30 border border-border/50"
          : "bg-primary/10 border border-primary/30"
      )}>
        {isUser
          ? <User className="w-4 h-4 text-muted-foreground" />
          : <Brain className="w-4 h-4 text-primary" />}
      </div>

      <div className={cn(
        "max-w-[80%] px-5 py-3.5 rounded-2xl text-[13px] leading-relaxed",
        isUser
          ? "bg-primary/10 border border-primary/20 text-white rounded-tr-none ml-auto"
          : "bg-card/40 border border-border/40 text-white rounded-tl-none"
      )}>
        {isUser ? (
          <p className="font-mono text-xs text-primary/90">{message.content}</p>
        ) : (
          <div className="prose prose-sm prose-invert max-w-none">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

function WelcomeState({
  project,
  memoryStatus,
  onAsk,
}: {
  project?: Project;
  memoryStatus: MemoryStatus | null;
  onAsk: (q: string) => void;
}) {
  return (
    <div className="max-w-3xl mx-auto space-y-8 pt-4">
      {/* Welcome card */}
      <div className="text-center space-y-3">
        <div className="inline-flex p-4 rounded-2xl bg-primary/5 border border-primary/20">
          <Brain className="w-10 h-10 text-primary/70" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-white">
            Advisor Agent{project ? ` · ${project.name}` : ""}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Hỏi bất cứ điều gì về dự án. AI sẽ tổng hợp từ toàn bộ dữ liệu.
          </p>
        </div>
      </div>

      {/* Memory loaded summary */}
      {memoryStatus && (
        <div className="grid grid-cols-4 md:grid-cols-7 gap-2">
          {Object.entries(MEMORY_LABELS).map(([key, label]) => {
            const loaded = memoryStatus.loaded[key as keyof typeof memoryStatus.loaded] as boolean;
            return (
              <div
                key={key}
                className={cn(
                  "p-2.5 rounded-xl border text-center transition-all",
                  loaded
                    ? "border-green-500/30 bg-green-500/5"
                    : "border-border/20 bg-muted/5 opacity-40"
                )}
              >
                <div className={cn("text-base mb-1", loaded ? "text-green-400" : "text-muted-foreground")}>
                  {MEMORY_ICONS[key] ?? "📄"}
                </div>
                <div className={cn("text-[9px] font-mono leading-tight", loaded ? "text-green-400" : "text-muted-foreground")}>
                  {loaded ? "✓ Đã tải" : "Chưa có"}
                </div>
                <div className="text-[9px] text-muted-foreground/70 mt-0.5 leading-tight">{label}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Suggested questions */}
      <div>
        <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-3">
          Câu hỏi gợi ý
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {SUGGESTED_QUESTIONS.map((q) => (
            <button
              key={q.label}
              onClick={() => onAsk(q.label)}
              className="flex items-center gap-3 text-left px-4 py-3 rounded-xl border border-border/40 bg-muted/10 hover:bg-muted/25 hover:border-primary/30 transition-all group"
            >
              <span className="text-lg shrink-0">{q.icon}</span>
              <span className="text-xs text-muted-foreground group-hover:text-white transition-colors font-mono">
                {q.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ type }: { type: "no-project" }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center space-y-5">
      <div className="p-6 rounded-2xl bg-primary/5 border border-primary/20">
        <Brain className="w-12 h-12 text-primary/40 mx-auto mb-3" />
        <h2 className="text-base font-bold text-white mb-1">Company Chat</h2>
        <p className="text-xs text-muted-foreground max-w-xs">
          Chọn một dự án để bắt đầu. AI sẽ đọc toàn bộ memory và trả lời mọi câu hỏi.
        </p>
      </div>
    </div>
  );
}
