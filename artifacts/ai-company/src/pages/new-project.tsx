import React from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateProject } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { TerminalSquare, Cpu, Rocket } from "lucide-react";

const formSchema = z.object({
  name: z.string().min(2, "Tên dự án phải có ít nhất 2 ký tự"),
  businessIdea: z.string().min(10, "Vui lòng mô tả ý tưởng chi tiết hơn (ít nhất 10 ký tự)"),
  industry: z.string().optional(),
  targetMarket: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function NewProject() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createProject = useCreateProject();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      businessIdea: "",
      industry: "",
      targetMarket: "",
    },
  });

  const onSubmit = (data: FormValues) => {
    createProject.mutate(
      { data },
      {
        onSuccess: (project) => {
          toast({
            title: "Khởi tạo thành công",
            description: "Dự án đã được tạo. Các AI Agent đang chờ lệnh.",
          });
          setLocation(`/projects/${project.id}`);
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: "Lỗi hệ thống",
            description: "Không thể tạo dự án lúc này.",
          });
        },
      }
    );
  };

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2 flex items-center gap-3">
            <TerminalSquare className="w-8 h-8 text-primary" />
            INIT.PROJECT
          </h1>
          <p className="text-muted-foreground font-mono text-sm">Provide parameters for AI agents execution.</p>
        </div>

        <div className="mission-panel rounded-xl border border-primary/20 p-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
            <Cpu className="w-48 h-48" />
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 relative z-10">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-primary uppercase text-xs">Tên Dự Án (Project Name)</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="VD: FutureTech VN" 
                        className="bg-background/50 border-border/50 focus-visible:ring-primary/50 text-lg"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="businessIdea"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-primary uppercase text-xs">Ý Tưởng Kinh Doanh (Business Idea)</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Mô tả chi tiết ý tưởng kinh doanh của bạn. Các AI sẽ dựa vào đây để lập kế hoạch..."
                        className="min-h-[150px] bg-background/50 border-border/50 focus-visible:ring-primary/50 resize-y text-base"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="industry"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono text-primary uppercase text-xs">Ngành Nghề (Industry) - Tùy chọn</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="VD: EdTech, E-commerce..." 
                          className="bg-background/50 border-border/50 focus-visible:ring-primary/50"
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="targetMarket"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono text-primary uppercase text-xs">Thị Trường (Target Market) - Tùy chọn</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="VD: Giới trẻ Việt Nam 18-25..." 
                          className="bg-background/50 border-border/50 focus-visible:ring-primary/50"
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="pt-6 border-t border-border/50 flex justify-end">
                <Button 
                  type="submit" 
                  disabled={createProject.isPending}
                  className="w-full md:w-auto min-w-[200px] h-12 bg-primary hover:bg-primary/80 text-primary-foreground font-bold tracking-wide shadow-[0_0_20px_rgba(34,211,238,0.4)] group"
                >
                  {createProject.isPending ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
                      ĐANG KHỞI TẠO...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Rocket className="w-5 h-5 group-hover:-translate-y-1 group-hover:translate-x-1 transition-transform" />
                      DEPLOY AI AGENTS
                    </span>
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </div>
    </Layout>
  );
}
