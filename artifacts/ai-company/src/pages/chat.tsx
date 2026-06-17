import React, { useState, useEffect, useRef } from "react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { 
  useListOpenaiConversations,
  useCreateOpenaiConversation,
  useGetOpenaiConversation,
  getGetOpenaiConversationQueryKey,
  getListOpenaiConversationsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Send, Bot, User, PlusCircle, Loader2 } from "lucide-react";

export default function Chat() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamedResponse, setStreamedResponse] = useState("");
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: conversations, isLoading: isLoadingList } = useListOpenaiConversations();
  
  const { data: conversationDetail, isLoading: isLoadingConv } = useGetOpenaiConversation(activeId!, {
    query: {
      enabled: !!activeId,
      queryKey: getGetOpenaiConversationQueryKey(activeId!)
    }
  });

  const createConv = useCreateOpenaiConversation();

  // Auto-select first conversation or create new
  useEffect(() => {
    if (conversations && conversations.length > 0 && !activeId) {
      setActiveId(conversations[0].id);
    }
  }, [conversations, activeId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversationDetail?.messages, streamedResponse]);

  const handleNewChat = () => {
    createConv.mutate({ data: { title: "Cố vấn kinh doanh mới" } }, {
      onSuccess: (newConv) => {
        queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
        setActiveId(newConv.id);
      }
    });
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !activeId || isStreaming) return;

    const messageText = input;
    setInput("");
    setIsStreaming(true);
    setStreamedResponse("");

    // Optimistically add user message
    queryClient.setQueryData(getGetOpenaiConversationQueryKey(activeId), (old: any) => {
      if (!old) return old;
      return {
        ...old,
        messages: [
          ...old.messages,
          { id: Date.now(), role: 'user', content: messageText, createdAt: new Date().toISOString() }
        ]
      };
    });

    try {
      const res = await fetch(`/api/openai/conversations/${activeId}/messages/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: messageText })
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
            if (data.done) break;
            if (data.content) {
              setStreamedResponse(prev => prev + data.content);
            }
            if (data.error) throw new Error(data.error);
          } catch (e) {
            // ignore parse errors
          }
        }
      }

      // Refetch to get final state
      queryClient.invalidateQueries({ queryKey: getGetOpenaiConversationQueryKey(activeId) });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Lỗi kết nối",
        description: "Không thể gửi tin nhắn.",
      });
      queryClient.invalidateQueries({ queryKey: getGetOpenaiConversationQueryKey(activeId) });
    } finally {
      setIsStreaming(false);
      setStreamedResponse("");
    }
  };

  return (
    <Layout>
      <div className="flex h-[calc(100vh-6rem)] gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        
        {/* Sidebar History */}
        <div className="w-64 mission-panel rounded-xl border border-border/50 hidden md:flex flex-col overflow-hidden">
          <div className="p-4 border-b border-border/50 bg-black/20 flex justify-between items-center">
            <span className="font-mono text-xs text-primary uppercase font-bold">Lịch Sử Trò Chuyện</span>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-primary hover:bg-primary/20" onClick={handleNewChat} disabled={createConv.isPending}>
              {createConv.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlusCircle className="w-4 h-4" />}
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {isLoadingList ? (
              [1,2,3].map(i => <Skeleton key={i} className="h-10 w-full bg-muted/20" />)
            ) : conversations?.map(conv => (
              <div 
                key={conv.id}
                onClick={() => setActiveId(conv.id)}
                className={`px-3 py-2 text-sm rounded-lg cursor-pointer transition-colors line-clamp-1
                  ${activeId === conv.id ? 'bg-primary/20 text-primary border border-primary/30' : 'text-muted-foreground hover:bg-muted/30 hover:text-white'}
                `}
              >
                <MessageSquare className="w-3.5 h-3.5 inline mr-2 opacity-70" />
                {conv.title}
              </div>
            ))}
            {conversations?.length === 0 && (
              <div className="text-xs text-center text-muted-foreground p-4">Chưa có cuộc trò chuyện nào</div>
            )}
          </div>
        </div>

        {/* Chat Area */}
        <div className="flex-1 mission-panel rounded-xl border border-primary/20 flex flex-col overflow-hidden relative">
          <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
            <Bot className="w-64 h-64" />
          </div>
          
          <div className="p-4 border-b border-border/50 bg-black/40 flex items-center gap-3 backdrop-blur-md relative z-10">
            <div className="w-10 h-10 rounded-lg bg-primary/20 border border-primary/50 flex items-center justify-center text-primary shadow-[0_0_15px_rgba(34,211,238,0.3)]">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <h2 className="font-bold text-white tracking-wide">Cố Vấn Kinh Doanh AI</h2>
              <p className="text-[10px] font-mono text-primary uppercase flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                Trực tuyến
              </p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6 relative z-10">
            {isLoadingConv && activeId ? (
              <div className="flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : !activeId ? (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-70">
                <MessageSquare className="w-12 h-12 mb-4" />
                <p>Chọn hoặc tạo cuộc trò chuyện mới để bắt đầu</p>
                <Button className="mt-4 bg-primary text-primary-foreground" onClick={handleNewChat}>
                  Tạo cuộc trò chuyện
                </Button>
              </div>
            ) : (
              <>
                {conversationDetail?.messages.map((msg, idx) => (
                  <div key={idx} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div className={`w-8 h-8 rounded-md flex shrink-0 items-center justify-center border
                      ${msg.role === 'user' 
                        ? 'bg-muted border-border/50 text-muted-foreground' 
                        : 'bg-primary/10 border-primary/30 text-primary shadow-[0_0_10px_rgba(34,211,238,0.2)]'}
                    `}>
                      {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                    </div>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm
                      ${msg.role === 'user' 
                        ? 'bg-white/10 text-white rounded-tr-none' 
                        : 'bg-primary/5 border border-primary/10 text-gray-200 rounded-tl-none'}
                    `}>
                      {msg.content}
                    </div>
                  </div>
                ))}

                {isStreaming && streamedResponse && (
                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-md shrink-0 flex items-center justify-center border bg-primary/10 border-primary/30 text-primary shadow-[0_0_10px_rgba(34,211,238,0.2)]">
                      <Bot className="w-4 h-4 animate-pulse" />
                    </div>
                    <div className="max-w-[80%] rounded-2xl px-4 py-3 text-sm bg-primary/5 border border-primary/10 text-gray-200 rounded-tl-none">
                      {streamedResponse}
                      <span className="inline-block w-1.5 h-3.5 bg-primary animate-pulse ml-1 align-middle" />
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          <div className="p-4 border-t border-border/50 bg-black/40 backdrop-blur-md relative z-10">
            <form onSubmit={handleSend} className="flex gap-3">
              <Input 
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Hỏi AI về chiến lược, tài chính, pháp lý..."
                className="flex-1 bg-black/50 border-primary/30 focus-visible:ring-primary h-12 text-base rounded-xl px-4"
                disabled={!activeId || isStreaming}
              />
              <Button 
                type="submit" 
                disabled={!activeId || !input.trim() || isStreaming}
                className="h-12 px-6 bg-primary hover:bg-primary/80 text-primary-foreground shadow-[0_0_15px_rgba(34,211,238,0.4)] rounded-xl"
              >
                <Send className="w-5 h-5" />
              </Button>
            </form>
          </div>
        </div>

      </div>
    </Layout>
  );
}
