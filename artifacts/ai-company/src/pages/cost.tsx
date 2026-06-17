import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";

type DayRow = {
  date: string;
  tokens: number;
  cost: number;
  requests: number;
  agentRuns: number;
  chatMessages: number;
};

type CostSummary = {
  today: { tokens: number; cost: number; requests: number; agentRuns: number; chatMessages: number };
  thisMonth: { tokens: number; cost: number; requests: number };
  history: DayRow[];
  budget: { limit: number; spent: number; remaining: number; percent: number };
  dailyQuota: { limit: number; used: number; remaining: number; percent: number };
  config: {
    dailyTokenLimit: number;
    monthlyTokenLimit: number;
    monthlyBudgetUsd: number;
    rateLimitRpm: number;
    isAdminOverride: boolean;
    isAdmin: boolean;
  };
};

function ProgressBar({ percent }: { percent: number }) {
  const p = Math.min(100, Math.max(0, percent));
  const color = p >= 90 ? "bg-red-500" : p >= 70 ? "bg-yellow-500" : "bg-blue-600";
  return (
    <div className="w-full bg-gray-800 rounded-full h-2">
      <div className={`${color} h-2 rounded-full transition-all duration-500`} style={{ width: `${p}%` }} />
    </div>
  );
}

function StatCard({
  title,
  value,
  sub,
  warn = false,
}: {
  title: string;
  value: string;
  sub: string;
  warn?: boolean;
}) {
  return (
    <div
      className={`bg-gray-900 border rounded-xl p-5 ${warn ? "border-red-500/60" : "border-gray-800"}`}
    >
      <div className="text-gray-400 text-xs uppercase tracking-wide mb-1">{title}</div>
      <div className={`text-2xl font-bold ${warn ? "text-red-400" : "text-white"}`}>{value}</div>
      <div className="text-gray-500 text-xs mt-1">{sub}</div>
    </div>
  );
}

export default function CostDashboard() {
  useAuth();
  const queryClient = useQueryClient();
  const [showAdmin, setShowAdmin] = useState(false);
  const [form, setForm] = useState<Record<string, number | boolean>>({});
  const [saveMsg, setSaveMsg] = useState("");

  const { data: summary, isLoading } = useQuery<CostSummary>({
    queryKey: ["/api/cost/summary"],
    queryFn: async () => {
      const res = await fetch("/api/cost/summary");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const configMutation = useMutation({
    mutationFn: async (values: object) => {
      const res = await fetch("/api/cost/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cost/summary"] });
      setSaveMsg("✓ Đã lưu");
      setTimeout(() => setSaveMsg(""), 2000);
    },
    onError: () => setSaveMsg("✗ Lỗi khi lưu"),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-gray-400 text-sm animate-pulse">Đang tải dữ liệu chi phí...</div>
      </div>
    );
  }

  if (!summary) return null;

  const { today: td, thisMonth, history, budget, dailyQuota, config } = summary;

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
          <div>
            <h1 className="text-2xl font-bold">Quản lý Chi Phí & Hạn Mức</h1>
            <p className="text-gray-400 text-sm mt-1">
              Theo dõi sử dụng AI và kiểm soát ngân sách
            </p>
          </div>
          <div className="flex gap-2">
            <a
              href="/api/cost/export"
              className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white text-sm px-4 py-2 rounded-lg transition-colors border border-gray-700"
            >
              ↓ Xuất CSV
            </a>
            <a
              href="/"
              className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm px-4 py-2 rounded-lg transition-colors border border-gray-700"
            >
              ← Dashboard
            </a>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard
            title="Hôm nay"
            value={`$${td.cost.toFixed(4)}`}
            sub={`${td.tokens.toLocaleString()} tokens`}
          />
          <StatCard
            title="Tháng này"
            value={`$${thisMonth.cost.toFixed(4)}`}
            sub={`${thisMonth.requests} yêu cầu`}
          />
          <StatCard
            title="Ngân sách còn lại"
            value={`$${budget.remaining.toFixed(2)}`}
            sub={`/ $${budget.limit.toFixed(2)} tháng`}
            warn={budget.percent >= 90}
          />
          <StatCard
            title="Quota token hôm nay"
            value={`${Math.floor(dailyQuota.remaining / 1000)}K`}
            sub={`/ ${Math.floor(dailyQuota.limit / 1000)}K tokens còn lại`}
            warn={dailyQuota.percent >= 90}
          />
        </div>

        {/* Progress Bars */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6 space-y-5">
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-300 font-medium">Ngân sách tháng</span>
              <span className={budget.percent >= 90 ? "text-red-400 font-medium" : "text-gray-400"}>
                ${budget.spent.toFixed(4)} / ${budget.limit.toFixed(2)} ({budget.percent.toFixed(1)}%)
              </span>
            </div>
            <ProgressBar percent={budget.percent} />
          </div>
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-300 font-medium">Quota token hàng ngày</span>
              <span className={dailyQuota.percent >= 90 ? "text-red-400 font-medium" : "text-gray-400"}>
                {dailyQuota.used.toLocaleString()} / {dailyQuota.limit.toLocaleString()} (
                {dailyQuota.percent.toFixed(1)}%)
              </span>
            </div>
            <ProgressBar percent={dailyQuota.percent} />
          </div>
        </div>

        {/* Today Breakdown */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
          <h2 className="font-semibold text-gray-200 mb-4">
            Hôm nay ({new Date().toLocaleDateString("vi-VN")})
          </h2>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="bg-gray-800/60 rounded-lg py-3">
              <div className="text-2xl font-bold text-white">{td.agentRuns}</div>
              <div className="text-gray-400 text-xs mt-1">Agent Runs</div>
            </div>
            <div className="bg-gray-800/60 rounded-lg py-3">
              <div className="text-2xl font-bold text-white">{td.chatMessages}</div>
              <div className="text-gray-400 text-xs mt-1">Chat Messages</div>
            </div>
            <div className="bg-gray-800/60 rounded-lg py-3">
              <div className="text-2xl font-bold text-white">{td.requests}</div>
              <div className="text-gray-400 text-xs mt-1">Tổng yêu cầu</div>
            </div>
          </div>
        </div>

        {/* 30-day History Table */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
            <h2 className="font-semibold text-gray-200">Lịch sử 30 ngày</h2>
            <span className="text-gray-500 text-xs">{history.length} ngày có dữ liệu</span>
          </div>
          {history.length === 0 ? (
            <div className="px-6 py-14 text-center text-gray-600">
              <div className="text-4xl mb-2">📊</div>
              <div>Chưa có dữ liệu sử dụng</div>
              <div className="text-xs mt-1">Dữ liệu sẽ xuất hiện sau khi bạn sử dụng AI agents hoặc chat</div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left px-6 py-3 text-gray-400 font-medium">Ngày</th>
                    <th className="text-right px-4 py-3 text-gray-400 font-medium">Tokens</th>
                    <th className="text-right px-4 py-3 text-gray-400 font-medium">Chi phí</th>
                    <th className="text-right px-4 py-3 text-gray-400 font-medium">Agent</th>
                    <th className="text-right px-4 py-3 text-gray-400 font-medium">Chat</th>
                    <th className="text-right px-6 py-3 text-gray-400 font-medium">Tổng</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row, i) => (
                    <tr
                      key={row.date}
                      className={i % 2 === 0 ? "bg-gray-900" : "bg-gray-800/40"}
                    >
                      <td className="px-6 py-3 text-gray-300 font-mono text-xs">{row.date}</td>
                      <td className="px-4 py-3 text-right text-gray-300">
                        {row.tokens.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right text-green-400 font-mono text-xs">
                        ${row.cost.toFixed(4)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-400">{row.agentRuns}</td>
                      <td className="px-4 py-3 text-right text-gray-400">{row.chatMessages}</td>
                      <td className="px-6 py-3 text-right text-gray-300">{row.requests}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-gray-700">
                  <tr className="bg-gray-800/60">
                    <td className="px-6 py-3 text-white font-semibold text-xs">Tổng tháng này</td>
                    <td className="px-4 py-3 text-right text-white font-semibold">
                      {thisMonth.tokens.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-green-400 font-semibold font-mono text-xs">
                      ${thisMonth.cost.toFixed(4)}
                    </td>
                    <td colSpan={2} />
                    <td className="px-6 py-3 text-right text-white font-semibold">
                      {thisMonth.requests}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* Admin Config */}
        {config.isAdmin && (
          <div className="bg-gray-900 border border-blue-500/30 rounded-xl overflow-hidden">
            <button
              onClick={() => setShowAdmin(!showAdmin)}
              className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-gray-800/40 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded font-semibold">
                  ADMIN
                </span>
                <span className="font-semibold text-gray-200">Cấu hình hạn mức</span>
              </div>
              <span className="text-gray-400 text-xs">{showAdmin ? "▲ Thu gọn" : "▼ Mở rộng"}</span>
            </button>

            {showAdmin && (
              <div className="px-6 pb-6 border-t border-gray-800">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <div>
                    <label className="block text-gray-400 text-xs mb-1">
                      Token quota ngày (tokens)
                    </label>
                    <input
                      type="number"
                      defaultValue={config.dailyTokenLimit}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, dailyTokenLimit: parseInt(e.target.value, 10) }))
                      }
                      className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-400 text-xs mb-1">Token quota tháng (tokens)</label>
                    <input
                      type="number"
                      defaultValue={config.monthlyTokenLimit}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, monthlyTokenLimit: parseInt(e.target.value, 10) }))
                      }
                      className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-400 text-xs mb-1">Ngân sách tháng (USD)</label>
                    <input
                      type="number"
                      step="0.01"
                      defaultValue={config.monthlyBudgetUsd}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, monthlyBudgetUsd: parseFloat(e.target.value) }))
                      }
                      className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-400 text-xs mb-1">Rate limit (req/phút)</label>
                    <input
                      type="number"
                      defaultValue={config.rateLimitRpm}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, rateLimitRpm: parseInt(e.target.value, 10) }))
                      }
                      className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="flex items-center col-span-full">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        defaultChecked={config.isAdminOverride}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, isAdminOverride: e.target.checked }))
                        }
                        className="w-4 h-4 rounded"
                      />
                      <span className="text-gray-300 text-sm">
                        Admin override — bỏ qua toàn bộ giới hạn budget & quota
                      </span>
                    </label>
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-5">
                  <button
                    onClick={() => configMutation.mutate(form)}
                    disabled={configMutation.isPending || Object.keys(form).length === 0}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
                  >
                    {configMutation.isPending ? "Đang lưu..." : "Lưu cấu hình"}
                  </button>
                  {saveMsg && (
                    <span
                      className={`text-sm ${saveMsg.startsWith("✓") ? "text-green-400" : "text-red-400"}`}
                    >
                      {saveMsg}
                    </span>
                  )}
                </div>
                <p className="text-gray-600 text-xs mt-3">
                  Để đặt ADMIN_USER_IDS, thêm User ID của bạn vào biến môi trường ADMIN_USER_IDS
                  (comma-separated). User ID là Replit sub claim của bạn.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
