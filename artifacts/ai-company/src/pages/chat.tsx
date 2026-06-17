import React, { useState, useEffect, useRef, useCallback } from "react";
import { useListProjects } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";
import {
  MessageCircle,
  Send,
  Plus,
  Trash2,
  Bot,
  User,
  ChevronDown,
  Brain,
  Loader2,
  Database,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Project = { id: number; name: string; status: string; businessIdea: string };
type Conversation = { id: number; projectId: number | null; title: string; createdAt: string };
type Message = { id: number; role: string; content: string; createdAt: string };
type ConvDetail = Conversation & { messages: Message[] };
type KbEntry = { id: number; title: string; content: string; updatedAt: string };

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}/api${path}`, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

const SAMPLE_QUESTIONS = [
  "Khách hàng mục tiêu của dự án này là ai?",
  "Chiến lược marketing hiện tại là gì?",
  "Phân tích SWOT của dự án?",
  "Đối thủ cạnh tranh chính là ai?",
  "KPI nào cần theo dõi?",
  "Kế hoạch 90 ngày đầu tiên như thế nào?",
];

export default function ChatPage() {
  const { data: projects, isLoading: projectsLoading } = useListProjects();
  const { toast } = useToast();

  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [convDetail, setConvDetail] = useState<ConvDetail | null>(null);
  const [kbEntries, setKbEntries] = useState<KbEntry[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [showProjectDrop, setShowProjectDrop] = useState(false);
  const [showKb, setShowKb] = useState(false);
  const [loadingConvs, setLoadingConvs] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const selectedProject = projects?.find((p) => p.id === selectedProjectId) as Project | undefined;

  // Fetch conversations when project changes
  useEffect(() => {
    if (!selectedProjectId) {
      setConversations([]);
      setActiveConvId(null);
      setConvDetail(null);
      return;
    }
    setLoadingConvs(true);
    apiFetch(`/chat/projects/${selectedProjectId}/conversations`)
      .then((r) => r.json())
      .then((data: Conversation[]) => {
        setConversations(data);
        if (data.length > 0 && !activeConvId) {
          setActiveConvId(data[0].id);
        }
      })
      .catch(() => setConversations([]))
      .finally(() => setLoadingConvs(false));

    // Fetch knowledge base entries
    apiFetch(`/chat/projects/${selectedProjectId}/knowledge`)
      .then((r) => r.json())
      .then(setKbEntries)
      .catch(() => setKbEntries([]));
  }, [selectedProjectId]);

  // Fetch conversation detail when active conv changes
  useEffect(() => {
    if (!activeConvId) { setConvDetail(null); return; }
    apiFetch(`/chat/conversations/${activeConvId}`)
      .then((r) => r.json())
      .then(setConvDetail)
      .catch(() => setConvDetail(null));
  }, [activeConvId]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [convDetail?.messages, streamText]);

  const createConversation = useCallback(async () => {
    if (!selectedProjectId) return;
    try {
      const res = await apiFetch(`/chat/projects/${selectedProjectId}/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `Hội thoại ${new Date().toLocaleString("vi-VN")}` }),
      });
      const conv: Conversation = await res.json();
      setConversations((prev) => [conv, ...prev]);
      setActiveConvId(conv.id);
      setConvDetail({ ...conv, messages: [] });
    } catch {
      toast({ variant: "destructive", title: "Không thể tạo hội thoại" });
    }
  }, [selectedProjectId, toast]);

  const deleteConversation = useCallback(async (convId: number) => {
    try {
      await apiFetch(`/chat/conversations/${convId}`, { method: "DELETE" });
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (activeConvId === convId) {
        setActiveConvId(null);
        setConvDetail(null);
      }
    } catch {
      toast({ variant: "destructive", title: "Không thể xoá hội thoại" });
    }
  }, [activeConvId, toast]);

  const sendMessage = useCallback(async (content?: string) => {
    const text = content ?? input.trim();
    if (!text || !activeConvId || streaming) return;

    setInput("");
    setStreaming(true);
    setStreamText("");

    // Optimistic user message
    const userMsg: Message = {
      id: Date.now(),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setConvDetail((prev) =>
      prev ? { ...prev, messages: [...prev.messages, userMsg] } : prev
    );

    try {
      const res = await fetch(`${BASE}/api/chat/conversations/${activeConvId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
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

      const assistantMsg: Message = {
        id: Date.now() + 1,
        role: "assistant",
        content: fullResponse,
        createdAt: new Date().toISOString(),
      };
      setConvDetail((prev) =>
        prev ? { ...prev, messages: [...prev.messages, assistantMsg] } : prev
      );
      setStreamText("");
    } catch (err) {
      toast({ variant: "destructive", title: "Lỗi gửi tin nhắn", description: "Vui lòng thử lại." });
    } finally {
      setStreaming(false);
    }
  }, [input, activeConvId, streaming, toast]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const allMessages = convDetail?.messages ?? [];

  return (
    <Layout>
      <div className="flex flex-col h-[calc(100vh-4rem)] -m-6 md:-m-8 animate-in fade-in duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-border/50 bg-card/30 backdrop-blur shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 border border-primary/30">
              <Brain className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-white uppercase tracking-wider">AI Memory Chat</h1>
              <p className="text-[10px] text-muted-foreground font-mono">RAG · Project-aware intelligence</p>
            </div>
          </div>

          {/* Project Selector */}
          <div className="relative">
            <button
              onClick={() => setShowProjectDrop((v) => !v)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/50 bg-muted/20 hover:bg-muted/40 transition-colors text-sm"
            >
              <Database className="w-3.5 h-3.5 text-primary" />
              <span className="text-white text-xs font-mono max-w-[140px] truncate">
                {selectedProject ? selectedProject.name : "Chọn dự án..."}
              </span>
              <ChevronDown className="w-3 h-3 text-muted-foreground" />
            </button>

            {showProjectDrop && (
              <div className="absolute right-0 top-full mt-1 w-64 rounded-lg border border-border/50 bg-card shadow-xl z-50 overflow-hidden">
                <div className="p-1.5 border-b border-border/30">
                  <p className="text-[10px] font-mono text-muted-foreground px-2 py-1 uppercase tracking-wider">Chọn Dự Án</p>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {projectsLoading ? (
                    <div className="p-3 space-y-2">
                      {[1, 2].map((i) => <Skeleton key={i} className="h-8 w-full bg-muted/20" />)}
                    </div>
                  ) : projects && projects.length > 0 ? (
                    projects.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setSelectedProjectId(p.id);
                          setActiveConvId(null);
                          setShowProjectDrop(false);
                        }}
                        className={cn(
                          "w-full text-left px-3 py-2 text-xs hover:bg-muted/30 transition-colors",
                          selectedProjectId === p.id ? "text-primary bg-primary/10" : "text-white"
                        )}
                      >
                        <div className="font-medium truncate">{p.name}</div>
                        <div className="text-muted-foreground text-[10px] truncate">{p.businessIdea}</div>
                      </button>
                    ))
                  ) : (
                    <p className="px-3 py-4 text-xs text-muted-foreground text-center">Chưa có dự án</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar — Conversations */}
          <div className="w-56 border-r border-border/50 bg-card/20 flex flex-col shrink-0 overflow-hidden">
            <div className="p-3 border-b border-border/30 flex items-center justify-between">
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Hội Thoại</span>
              <Button
                size="icon"
                variant="ghost"
                className="w-6 h-6 text-muted-foreground hover:text-primary"
                onClick={createConversation}
                disabled={!selectedProjectId}
                title="Tạo hội thoại mới"
              >
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {!selectedProjectId ? (
                <p className="text-[11px] text-muted-foreground text-center px-2 pt-4 font-mono">
                  Chọn dự án để bắt đầu
                </p>
              ) : loadingConvs ? (
                <div className="space-y-2 p-1">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full bg-muted/20" />)}
                </div>
              ) : conversations.length === 0 ? (
                <div className="text-center pt-6 space-y-2">
                  <MessageCircle className="w-6 h-6 text-muted-foreground/30 mx-auto" />
                  <p className="text-[11px] text-muted-foreground font-mono">Chưa có hội thoại</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-[11px] border-primary/30 text-primary hover:bg-primary/10 h-7"
                    onClick={createConversation}
                  >
                    Tạo mới
                  </Button>
                </div>
              ) : (
                conversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={cn(
                      "group flex items-center gap-1 px-2 py-2 rounded-md cursor-pointer transition-colors",
                      activeConvId === conv.id
                        ? "bg-primary/10 border border-primary/20 text-primary"
                        : "hover:bg-muted/30 text-muted-foreground hover:text-white border border-transparent"
                    )}
                    onClick={() => setActiveConvId(conv.id)}
                  >
                    <MessageCircle className="w-3 h-3 shrink-0" />
                    <span className="text-[11px] font-mono flex-1 truncate">{conv.title}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Knowledge Base indicator */}
            {kbEntries.length > 0 && (
              <div className="border-t border-border/30 p-2">
                <button
                  onClick={() => setShowKb((v) => !v)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[10px] font-mono text-muted-foreground hover:text-primary transition-colors"
                >
                  <Database className="w-3 h-3" />
                  <span className="flex-1 text-left">Knowledge Base</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-primary/20 text-primary text-[9px]">
                    {kbEntries.length}
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* Main Chat Area */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Knowledge Base Panel */}
            {showKb && kbEntries.length > 0 && (
              <div className="border-b border-border/30 bg-card/20 p-3 max-h-40 overflow-y-auto shrink-0">
                <div className="flex items-center gap-2 mb-2">
                  <Database className="w-3 h-3 text-primary" />
                  <span className="text-[10px] font-mono text-primary uppercase tracking-wider">Project Memory</span>
                  <button onClick={() => setShowKb(false)} className="ml-auto text-muted-foreground hover:text-white text-xs">✕</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {kbEntries.map((e) => (
                    <div key={e.id} className="px-2 py-1 rounded border border-primary/20 bg-primary/5 text-[10px] font-mono text-primary/80">
                      {e.title}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4" onClick={() => setShowProjectDrop(false)}>
              {!selectedProjectId ? (
                <div className="flex flex-col items-center justify-center h-full text-center space-y-6">
                  <div className="p-6 rounded-2xl bg-primary/5 border border-primary/20">
                    <Brain className="w-12 h-12 text-primary/60 mx-auto mb-4" />
                    <h2 className="text-lg font-bold text-white mb-2">AI Memory Chat</h2>
                    <p className="text-sm text-muted-foreground max-w-sm">
                      Chọn một dự án để AI có thể đọc toàn bộ dữ liệu và trả lời câu hỏi của bạn.
                    </p>
                  </div>
                </div>
              ) : !activeConvId ? (
                <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
                  <MessageCircle className="w-10 h-10 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">Tạo hội thoại mới hoặc chọn một hội thoại</p>
                  <Button
                    size="sm"
                    className="bg-primary hover:bg-primary/80 text-primary-foreground text-xs"
                    onClick={createConversation}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1.5" />
                    Tạo Hội Thoại Mới
                  </Button>
                </div>
              ) : allMessages.length === 0 && !streaming ? (
                <div className="flex flex-col items-center justify-center h-full space-y-6">
                  <div className="text-center space-y-2">
                    <Bot className="w-10 h-10 text-primary/50 mx-auto" />
                    <p className="text-sm text-white font-medium">AI sẵn sàng trả lời</p>
                    {selectedProject && (
                      <p className="text-xs text-muted-foreground">
                        Hỏi về dự án: <span className="text-primary">{selectedProject.name}</span>
                      </p>
                    )}
                    {kbEntries.length > 0 && (
                      <p className="text-[11px] text-green-400/70 font-mono flex items-center gap-1 justify-center">
                        <Database className="w-3 h-3" />
                        {kbEntries.length} mục trong knowledge base
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 w-full max-w-lg">
                    {SAMPLE_QUESTIONS.map((q) => (
                      <button
                        key={q}
                        onClick={() => sendMessage(q)}
                        className="text-left px-3 py-2.5 rounded-lg border border-border/50 bg-muted/10 hover:bg-muted/30 hover:border-primary/30 transition-all text-xs text-muted-foreground hover:text-white"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {allMessages.map((msg) => (
                    <ChatMessage key={msg.id} message={msg} />
                  ))}
                  {streaming && streamText && (
                    <div className="flex gap-3">
                      <div className="w-7 h-7 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center shrink-0 mt-0.5">
                        <Bot className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <div className="flex-1 bg-card/30 border border-border/40 rounded-2xl rounded-tl-none px-4 py-3 max-w-3xl">
                        <div className="prose prose-sm prose-invert max-w-none text-[13px] leading-relaxed">
                          <ReactMarkdown>{streamText}</ReactMarkdown>
                        </div>
                        <span className="inline-block w-1 h-4 bg-primary animate-pulse ml-0.5 align-middle" />
                      </div>
                    </div>
                  )}
                  {streaming && !streamText && (
                    <div className="flex gap-3">
                      <div className="w-7 h-7 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center shrink-0">
                        <Bot className="w-3.5 h-3.5 text-primary animate-pulse" />
                      </div>
                      <div className="flex items-center gap-1.5 px-4 py-3 bg-card/30 border border-border/40 rounded-2xl rounded-tl-none">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
                        <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
                        <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
                      </div>
                    </div>
                  )}
                  <div ref={bottomRef} />
                </>
              )}
            </div>

            {/* Input */}
            {activeConvId && (
              <div className="border-t border-border/50 p-4 bg-card/20 shrink-0">
                {selectedProject && kbEntries.length > 0 && (
                  <div className="flex items-center gap-1.5 mb-2 text-[10px] font-mono text-green-400/60">
                    <Database className="w-3 h-3" />
                    AI đang nhớ {kbEntries.length} mục từ dự án {selectedProject.name}
                  </div>
                )}
                <div className="flex gap-2 items-end">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={
                      selectedProject
                        ? `Hỏi về dự án "${selectedProject.name}"...`
                        : "Nhập câu hỏi..."
                    }
                    rows={1}
                    className="flex-1 resize-none bg-muted/20 border border-border/50 rounded-xl px-4 py-3 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:bg-muted/30 transition-colors font-mono min-h-[44px] max-h-32"
                    style={{ height: "auto", overflowY: "auto" }}
                    onInput={(e) => {
                      const t = e.currentTarget;
                      t.style.height = "auto";
                      t.style.height = Math.min(t.scrollHeight, 128) + "px";
                    }}
                    disabled={streaming}
                  />
                  <Button
                    onClick={() => sendMessage()}
                    disabled={!input.trim() || streaming}
                    className="bg-primary hover:bg-primary/80 text-primary-foreground shadow-[0_0_12px_rgba(34,211,238,0.3)] shrink-0 h-11 w-11 p-0"
                  >
                    {streaming ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5 font-mono text-center">
                  Enter để gửi · Shift+Enter để xuống dòng
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

function ChatMessage({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5",
          isUser
            ? "bg-muted/30 border border-border/50"
            : "bg-primary/20 border border-primary/40"
        )}
      >
        {isUser ? (
          <User className="w-3.5 h-3.5 text-muted-foreground" />
        ) : (
          <Bot className="w-3.5 h-3.5 text-primary" />
        )}
      </div>
      <div
        className={cn(
          "max-w-3xl px-4 py-3 rounded-2xl text-[13px] leading-relaxed",
          isUser
            ? "bg-primary/10 border border-primary/20 text-white rounded-tr-none"
            : "bg-card/30 border border-border/40 rounded-tl-none"
        )}
      >
        {isUser ? (
          <p className="text-white whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="prose prose-sm prose-invert max-w-none">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
