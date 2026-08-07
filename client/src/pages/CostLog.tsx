import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Wallet, DollarSign, PhoneCall, Timer } from "lucide-react";

function timeAgo(ts: number) {
  const diff = Math.max(0, Date.now() - ts) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  return `${Math.round(diff / 3600)}h ago`;
}

export default function CostLog() {
  const costLog = trpc.copilot.costLog.useQuery(undefined, {
    refetchInterval: 3000,
  });

  const entries = costLog.data?.entries ?? [];
  const total = costLog.data?.total_usd ?? 0;
  const calls = costLog.data?.call_count ?? 0;

  const intentCalls = entries.filter((e) => e.agent_name === "intent");
  const ragCalls = entries.filter((e) => e.agent_name === "rag");
  const intentTotal = intentCalls.reduce((s, e) => s + e.cost_usd, 0);
  const ragTotal = ragCalls.reduce((s, e) => s + e.cost_usd, 0);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto w-full">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cost Log</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Running session log of every agent call. Cheap/fast models handle routine
          decisions; the expensive tier is reserved for high-stakes answer generation.
        </p>
      </div>

      {/* Totals */}
      <div className="grid sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <DollarSign className="h-3 w-3" /> Session total
            </p>
            <p className="text-2xl font-bold mt-1">${total.toFixed(4)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <PhoneCall className="h-3 w-3" /> Agent calls
            </p>
            <p className="text-2xl font-bold mt-1">{calls}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">Intent node (cheap)</p>
            <p className="text-2xl font-bold mt-1">${intentTotal.toFixed(4)}</p>
            <p className="text-xs text-muted-foreground mt-1">{intentCalls.length} calls</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">RAG node</p>
            <p className="text-2xl font-bold mt-1">${ragTotal.toFixed(4)}</p>
            <p className="text-xs text-muted-foreground mt-1">{ragCalls.length} calls</p>
          </CardContent>
        </Card>
      </div>

      {/* Per-call log */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" />
            Per-call entries
          </CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              <Timer className="h-6 w-6 mx-auto mb-2 opacity-50" />
              No agent calls yet. Run a turn in the Demo to populate the log.
            </div>
          ) : (
            <ScrollArea className="max-h-[480px]">
              <div className="space-y-1">
                {[...entries].reverse().map((e, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-secondary/40 transition-colors">
                    <Badge
                      variant={e.agent_name === "intent" ? "secondary" : "outline"}
                      className="text-xs w-24 justify-center"
                    >
                      {e.agent_name}
                    </Badge>
                    <span className="text-xs text-muted-foreground w-16">{e.model_tier}</span>
                    <span className="text-sm font-medium ml-auto">
                      ${e.cost_usd.toFixed(4)}
                    </span>
                    <span className="text-xs text-muted-foreground w-20 text-right">
                      {timeAgo(e.ts)}
                    </span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <Separator />
      <p className="text-xs text-muted-foreground">
        Cost-per-turn estimate: ≈ $0.0052 (intent $0.0002 + RAG $0.005). At 100,000
        calls/month the pipeline costs roughly $520 — a fraction of a single contact-center seat.
        These figures use stub pricing; swap call_cheap_llm() to a real endpoint to get actuals.
      </p>
    </div>
  );
}
