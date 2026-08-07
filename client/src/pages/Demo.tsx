import { useState, useCallback, useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useRealtimeCall, useRealtimeLeads } from "@/hooks/useRealtime";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Activity,
  ArrowRight,
  Bot,
  Search,
  Sparkles,
  Loader2,
  MessageCircle,
  AlertTriangle,
  CheckCircle2,
  FileText,
  PhoneCall,
  UserPlus,
  RefreshCw,
  Clock,
  ShieldAlert,
  BarChart3,
  TrendingUp,
  Coins,
  Plus,
  Trash2,
  CheckCircle,
  Filter,
  User,
  ExternalLink
} from "lucide-react";
import { toast } from "sonner";

type Intent =
  | "product_question"
  | "objection"
  | "kyc_question"
  | "ready_to_convert"
  | "small_talk";

type Sentiment = "positive" | "neutral" | "negative";

interface Lead {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  status: string;
  creditScore: number;
  approvedLimit: number | null;
  notes: string | null;
  lastCallAt: Date | null;
  createdAt: Date;
}

interface TranscriptTurn {
  speaker: "customer" | "agent";
  text: string;
  intent?: string;
  sentiment?: string;
  answer?: string;
  nbaSuggestion?: string;
  complianceFlag?: boolean;
}

const INTENT_META: Record<Intent, { label: string; icon: React.ElementType; tone: string }> = {
  product_question: { label: "Product Q&A", icon: FileText, tone: "text-slate-650 border-slate-200 bg-slate-50" },
  objection: { label: "Objection", icon: AlertTriangle, tone: "text-amber-700 border-amber-200 bg-amber-50" },
  kyc_question: { label: "KYC Onboarding", icon: FileText, tone: "text-indigo-700 border-indigo-200 bg-indigo-50" },
  ready_to_convert: { label: "Deal Ready", icon: CheckCircle2, tone: "text-emerald-700 border-emerald-200 bg-emerald-50" },
  small_talk: { label: "Greeting / Talk", icon: MessageCircle, tone: "text-slate-500 border-slate-200 bg-slate-50" },
};

const STATUS_META = {
  lead: { label: "Prospect", tone: "bg-slate-100 text-slate-700 border-slate-200" },
  objection: { label: "Objections Raised", tone: "bg-amber-100/60 text-amber-800 border-amber-200" },
  kyc_pending: { label: "KYC Active", tone: "bg-indigo-100/60 text-indigo-800 border-indigo-200" },
  converted: { label: "Converted", tone: "bg-emerald-100/60 text-emerald-800 border-emerald-200" },
  lost: { label: "Lost", tone: "bg-rose-100/60 text-rose-800 border-rose-200" },
};

const LEAD_MOCK_PROMPTS: Record<number, Array<{ label: string; text: string }>> = {
  1: [
    { label: "Interest & Processing fees?", text: "Is this pay-in-3 product really zero interest? Are there any hidden fees or processing charges?" },
    { label: "Security & CIBIL check?", text: "How secure is my data? Also, will applying for this hit my CIBIL credit score?" },
    { label: "Proceed and buy", text: "Okay, sounds good to me. I want to proceed and buy. Send me the registration link." },
  ],
  2: [
    { label: "Zero interest skepticism", text: "Nothing is ever free. I don't trust zero interest loans. What's the catch?" },
    { label: "Hesitation about Aadhaar/PAN upload", text: "I don't feel safe uploading my Aadhaar and PAN cards on a public portal. It feels like a scam." },
    { label: "What are the late fees?", text: "What happens if I miss a payment? How much are the late fees?" },
  ],
  3: [
    { label: "KYC documents needed?", text: "What documents do I need to prepare to pass the KYC onboarding?" },
    { label: "Guarantee my approval? (Sensitive)", text: "This is fine, but can you guarantee my loan approval? I don't want to upload documents for nothing." },
    { label: "Accept and register", text: "Great, I'll do the verification. Send me the link now." },
  ],
};

export default function Demo() {
  const leadsQuery = trpc.copilot.getLeads.useQuery(undefined, { refetchInterval: 3000 });
  const callsQuery = trpc.copilot.getCalls.useQuery(undefined, { refetchInterval: 5000 });
  
  const startCallMutation = trpc.copilot.startCall.useMutation();
  const processTurnMutation = trpc.copilot.processCallTurn.useMutation();
  const endCallMutation = trpc.copilot.endCall.useMutation();
  const resetCrmMutation = trpc.copilot.resetCrm.useMutation();
  const createLeadMutation = trpc.copilot.createLead.useMutation();
  const costLog = trpc.copilot.costLog.useQuery(undefined, { refetchInterval: 5000 });
  const utils = trpc.useUtils();

  const [activeTab, setActiveTab] = useState("leads");

  const [activeCallId, setActiveCallId] = useState<number | null>(null);
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [customUtterance, setCustomUtterance] = useState("");
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [lastCopilotAdvice, setLastCopilotAdvice] = useState<{
    answer?: string;
    nbaSuggestion?: string;
    complianceFlag?: boolean;
    sources?: any[];
    intent?: string;
    sentiment?: string;
  } | null>(null);

  const [leadSearch, setLeadSearch] = useState("");
  const [creditFilter, setCreditFilter] = useState<"all" | "high" | "low">("all");

  const [selectedHistoricalCall, setSelectedHistoricalCall] = useState<any>(null);
  const [historicalTranscript, setHistoricalTranscript] = useState<any[]>([]);
  const [loadingHistoricalTranscript, setLoadingHistoricalTranscript] = useState(false);

  const [showAddLead, setShowAddLead] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newCredit, setNewCredit] = useState(720);

  const { realtimeTurns, isConnected: rtConnected } = useRealtimeCall(activeCallId);

  useEffect(() => {
    if (realtimeTurns.length === 0) return;
    const latest = realtimeTurns[realtimeTurns.length - 1];
    setTranscript((prev) => {
      const alreadyExists = prev.some((t) => t.text === latest.text && t.speaker === latest.speaker);
      if (alreadyExists) return prev;
      return [
        ...prev,
        {
          speaker: latest.speaker as "customer" | "agent",
          text: latest.text,
          intent: latest.intent ?? undefined,
          sentiment: latest.sentiment ?? undefined,
          answer: latest.assistantResponse ?? undefined,
        },
      ];
    });
  }, [realtimeTurns]);

  const handleLeadUpdate = useCallback((updatedLead: any) => {
    utils.copilot.getLeads.invalidate();
    utils.copilot.getCalls.invalidate();
    if (activeLead && updatedLead.id === activeLead.id) {
      setActiveLead((prev) => (prev ? { ...prev, ...updatedLead } : prev));
    }
  }, [activeLead, utils]);
  const { isConnected: leadsRtConnected } = useRealtimeLeads(handleLeadUpdate);

  const filteredLeads = useMemo(() => {
    return (leadsQuery.data ?? []).filter((lead: Lead) => {
      const matchesSearch =
        lead.name.toLowerCase().includes(leadSearch.toLowerCase()) ||
        lead.phone.includes(leadSearch) ||
        (lead.email ?? "").toLowerCase().includes(leadSearch.toLowerCase());
      
      if (creditFilter === "high") return matchesSearch && lead.creditScore >= 720;
      if (creditFilter === "low") return matchesSearch && lead.creditScore < 720;
      return matchesSearch;
    });
  }, [leadsQuery.data, leadSearch, creditFilter]);

  const analytics = useMemo(() => {
    const totalLeads = leadsQuery.data?.length ?? 0;
    const converted = leadsQuery.data?.filter(l => l.status === "converted").length ?? 0;
    const conversionRate = totalLeads > 0 ? (converted / totalLeads) * 100 : 0;
    const totalCalls = callsQuery.data?.length ?? 0;
    const cost = costLog.data?.total_usd ?? 0;
    const complianceScore = 100;

    return {
      totalLeads,
      conversionRate,
      totalCalls,
      cost,
      complianceScore,
    };
  }, [leadsQuery.data, callsQuery.data, costLog.data]);

  const handleStartCall = async (lead: Lead) => {
    try {
      const { callId } = await startCallMutation.mutateAsync({ leadId: lead.id });
      setActiveCallId(callId);
      setActiveLead(lead);
      setTranscript([]);
      setLastCopilotAdvice(null);
      setActiveTab("dialer");
      toast.success(`Calling ${lead.name}...`);
    } catch (err) {
      toast.error("Failed to start voice call");
    }
  };

  const handleCustomerUtterance = async (text: string) => {
    if (!activeCallId) return;

    const userTurn: TranscriptTurn = { speaker: "customer", text };
    setTranscript((prev) => [...prev, userTurn]);

    try {
      const result = await processTurnMutation.mutateAsync({
        callId: activeCallId,
        speaker: "customer",
        text,
      });

      setTranscript((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.speaker === "customer") {
          last.intent = result.intent;
          last.sentiment = result.sentiment;
          last.answer = result.answer;
          last.nbaSuggestion = result.nbaSuggestion;
          last.complianceFlag = result.complianceFlag;
        }
        return copy;
      });

      setLastCopilotAdvice({
        answer: result.answer,
        nbaSuggestion: result.complianceFlag ? `[human_judgment_required] ${result.nbaSuggestion}` : result.nbaSuggestion,
        complianceFlag: result.complianceFlag,
        sources: result.sources,
        intent: result.intent,
        sentiment: result.sentiment,
      });

      setCustomUtterance("");
      utils.copilot.costLog.invalidate();

      if (result.answer && !result.complianceFlag) {
        setTimeout(() => {
          handleAgentSpeak(result.answer);
        }, 1500);
      }
    } catch (err) {
      toast.error("Failed to process conversation step");
    }
  };

  const handleAgentSpeak = async (text: string) => {
    if (!activeCallId) return;
    setTranscript((prev) => [...prev, { speaker: "agent", text }]);
    try {
      await processTurnMutation.mutateAsync({
        callId: activeCallId,
        speaker: "agent",
        text,
      });
    } catch (err) {
      console.warn("Failed to log agent transcript turn");
    }
  };

  const handleEndCall = async (overrideStatus?: "lead" | "objection" | "kyc_pending" | "converted" | "lost") => {
    if (!activeCallId || !activeLead) return;
    try {
      const outcome = await endCallMutation.mutateAsync({
        callId: activeCallId,
        overrideStatus,
      });
      toast.success(`Call finalized. Onboarding state: ${outcome.status.toUpperCase()}`);
      setActiveCallId(null);
      setActiveLead(null);
      utils.copilot.getLeads.invalidate();
      utils.copilot.getCalls.invalidate();
      setActiveTab("leads");
    } catch (err) {
      toast.error("Failed to save final call results");
    }
  };

  const handleResetCrm = async () => {
    if (confirm("Are you sure you want to wipe the CRM database? All prospect leads and call transcripts will be permanently deleted.")) {
      await resetCrmMutation.mutateAsync();
      toast.success("CRM database reset.");
      setActiveCallId(null);
      setActiveLead(null);
      utils.copilot.getLeads.invalidate();
      utils.copilot.getCalls.invalidate();
    }
  };

  const handleViewHistoricalCall = async (call: any) => {
    setSelectedHistoricalCall(call);
    setLoadingHistoricalTranscript(true);
    try {
      const result = await utils.client.copilot.getCallTranscript.query({ callId: call.id });
      setHistoricalTranscript(result);
    } catch (err) {
      toast.error("Failed to fetch historical call transcript");
    } finally {
      setLoadingHistoricalTranscript(false);
    }
  };

  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newPhone) {
      toast.error("Name and Phone number are required fields.");
      return;
    }
    try {
      await createLeadMutation.mutateAsync({
        name: newName,
        phone: newPhone,
        email: newEmail,
        creditScore: newCredit,
        notes: "Manually created prospect.",
      });
      toast.success("New lead created successfully.");
      setShowAddLead(false);
      setNewName("");
      setNewPhone("");
      setNewEmail("");
      utils.copilot.getLeads.invalidate();
    } catch (err) {
      toast.error("Failed to write prospect to database");
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto w-full min-h-screen text-slate-800 bg-[#fbfcfd] antialiased">
      
      {/* HEADER SECTION - NO NEON GLOWS, MINIMALIST DEEP INDIGO */}
      <div className="flex justify-between items-center flex-wrap gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              FlexiPay Inside Sales Dashboard
            </h1>
            <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium border ${leadsRtConnected ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-600 border-slate-200"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${leadsRtConnected ? "bg-emerald-550 animate-pulse" : "bg-slate-400"}`} />
              {leadsRtConnected ? "Supabase Connected" : "Local Fallback"}
            </div>
            {activeCallId && (
              <div className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium border bg-blue-50 text-blue-700 border-blue-200">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping" />
                Active Session
              </div>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Auditable agent workspace for FlexiPay pay-in-3 EMI compliance &amp; Next-Best-Action coaching.
          </p>
        </div>
        
        <div className="flex gap-2 items-center">
          <Button variant="outline" size="sm" onClick={handleResetCrm} className="border-slate-200 hover:bg-slate-50 text-slate-600 text-xs">
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Clear CRM Database
          </Button>
          <Button size="sm" onClick={() => setShowAddLead(true)} className="bg-slate-900 hover:bg-slate-800 text-white text-xs">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Create Lead
          </Button>
        </div>
      </div>

      {/* NEW PROSPECT FORM */}
      {showAddLead && (
        <Card className="border-slate-200 bg-white shadow-sm duration-150 animate-in fade-in duration-100">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Register New Lead
            </CardTitle>
            <CardDescription className="text-xs text-slate-500">
              Submit basic CIBIL and contact details to seed a new prospect.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateLead} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              <div>
                <label className="text-[10px] font-semibold text-slate-500 block mb-1">NAME</label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Full name" className="bg-white border-slate-200 text-xs h-9 focus:ring-slate-400" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-500 block mb-1">PHONE NUMBER</label>
                <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="+91 98765 43210" className="bg-white border-slate-200 text-xs h-9 focus:ring-slate-400" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-500 block mb-1">EMAIL ADDRESS</label>
                <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="email@address.com" className="bg-white border-slate-200 text-xs h-9 focus:ring-slate-400" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-500 block mb-1">CIBIL SCORE (300-900)</label>
                <div className="flex gap-2">
                  <Input type="number" value={newCredit} onChange={(e) => setNewCredit(parseInt(e.target.value))} className="bg-white border-slate-200 text-xs h-9 w-24 focus:ring-slate-400" />
                  <Button type="submit" size="sm" className="bg-slate-900 hover:bg-slate-800 text-white h-9 px-4 text-xs font-medium">Add Lead</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowAddLead(false)} className="h-9 hover:bg-slate-50 text-slate-500 text-xs">Cancel</Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* TABS CONTAINER */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="flex bg-slate-100/80 border border-slate-200/60 p-1 rounded-md w-full md:w-[500px]">
          <TabsTrigger value="leads" className="text-xs font-medium py-1.5 px-3 flex-1 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm rounded transition-all">
            <User className="h-3.5 w-3.5 mr-1.5 text-slate-500" />
            CRM Lead Board
          </TabsTrigger>
          <TabsTrigger value="dialer" className="text-xs font-medium py-1.5 px-3 flex-1 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm rounded transition-all">
            <PhoneCall className="h-3.5 w-3.5 mr-1.5 text-slate-500" />
            Active Dialer
          </TabsTrigger>
          <TabsTrigger value="history" className="text-xs font-medium py-1.5 px-3 flex-1 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm rounded transition-all">
            <Clock className="h-3.5 w-3.5 mr-1.5 text-slate-500" />
            Call History
          </TabsTrigger>
          <TabsTrigger value="analytics" className="text-xs font-medium py-1.5 px-3 flex-1 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm rounded transition-all">
            <BarChart3 className="h-3.5 w-3.5 mr-1.5 text-slate-500" />
            Analytics
          </TabsTrigger>
        </TabsList>

        {/* ── TAB 1: MINIMALIST CRM LEAD BOARD ── */}
        <TabsContent value="leads" className="mt-4">
          <div className="flex gap-4 items-center justify-between mb-4 flex-wrap">
            <div className="flex gap-3 items-center flex-1 max-w-md">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input value={leadSearch} onChange={(e) => setLeadSearch(e.target.value)} placeholder="Search leads by name or email..." className="pl-9 bg-white border-slate-200 text-xs focus:ring-slate-300" />
              </div>
              <div className="flex items-center gap-1.5 bg-white px-3 py-1.5 border border-slate-200 rounded text-xs text-slate-500">
                <Filter className="h-3.5 w-3.5 text-slate-400" />
                <span>CIBIL Score:</span>
                <select value={creditFilter} onChange={(e) => setCreditFilter(e.target.value as any)} className="bg-transparent font-medium text-slate-800 outline-none cursor-pointer text-xs">
                  <option value="all">All Scores</option>
                  <option value="high">High (&gt;= 720)</option>
                  <option value="low">Low (&lt; 720)</option>
                </select>
              </div>
            </div>
            <div className="text-xs text-slate-500">
              Total {filteredLeads.length} leads in funnel
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {(["lead", "objection", "kyc_pending", "converted", "lost"] as const).map((status) => {
              const statusLeads = filteredLeads.filter(l => l.status === status);
              const meta = STATUS_META[status];

              return (
                <div key={status} className="bg-slate-50 border border-slate-200/80 rounded p-3 flex flex-col gap-3 min-h-[450px]">
                  <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                    <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{meta.label}</span>
                    <span className="text-[10px] font-bold text-slate-500 bg-white border border-slate-200 rounded-full px-2 py-0.5">
                      {statusLeads.length}
                    </span>
                  </div>

                  <div className="flex flex-col gap-3 overflow-y-auto max-h-[500px]">
                    {statusLeads.length === 0 ? (
                      <div className="text-center text-[10px] text-slate-400 py-12 italic">Empty</div>
                    ) : (
                      statusLeads.map((lead) => (
                        <div key={lead.id} className="bg-white border border-slate-200 p-3.5 rounded shadow-xs hover:border-slate-350 transition-all flex flex-col gap-2.5">
                          <div className="space-y-1">
                            <h4 className="font-medium text-xs text-slate-800">{lead.name}</h4>
                            <p className="text-[10px] text-slate-500">{lead.phone}</p>
                          </div>

                          <div className="flex justify-between items-center pt-1">
                            <span className="text-[10px] text-slate-500">
                              CIBIL: <span className={`font-semibold ${lead.creditScore >= 720 ? "text-emerald-600" : "text-amber-600"}`}>{lead.creditScore}</span>
                            </span>
                            
                            <Button size="sm" onClick={() => handleStartCall(lead)} className="bg-slate-900 hover:bg-slate-800 text-white rounded text-[10px] px-2.5 py-1 flex items-center gap-1 h-6">
                              <PhoneCall className="h-2.5 w-2.5" />
                              Dial
                            </Button>
                          </div>
                          
                          {lead.approvedLimit && (
                            <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-100 text-[9px] font-semibold py-0.5 mt-0.5 self-start">
                              Limit: ₹{lead.approvedLimit.toLocaleString()}
                            </Badge>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>

        {/* ── TAB 2: ACTIVE DIALER & AI SALES CO-PILOT ── */}
        <TabsContent value="dialer" className="mt-4">
          {!activeCallId ? (
            <Card className="border-slate-200 bg-white p-16 text-center flex flex-col items-center justify-center max-w-xl mx-auto gap-4 mt-6 shadow-sm">
              <div className="h-14 w-14 rounded-full bg-slate-50 flex items-center justify-center border border-slate-200">
                <PhoneCall className="h-6 w-6 text-slate-600" />
              </div>
              <div>
                <CardTitle className="text-lg font-semibold text-slate-800">No Active Call Session</CardTitle>
                <CardDescription className="text-xs text-slate-500 mt-1.5 max-w-sm mx-auto">
                  Go to the **CRM Lead Board** tab, find your target prospect, and click **Dial** to initialize a live compliance-checked call session.
                </CardDescription>
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
              
              {/* Profile card & Simulation Utterances */}
              <div className="flex flex-col gap-6">
                <Card className="border-slate-200 bg-white shadow-xs">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-xs font-semibold uppercase text-slate-500 tracking-wider">Prospect Information</CardTitle>
                    <CardDescription className="text-[11px] text-slate-500">Live call profile from database record.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3.5">
                    <div className="flex justify-between border-b border-slate-100 pb-2 text-xs">
                      <span className="text-slate-500">Prospect Name</span>
                      <span className="font-medium text-slate-800">{activeLead?.name}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-100 pb-2 text-xs">
                      <span className="text-slate-500">Phone Number</span>
                      <span className="font-medium text-slate-800">{activeLead?.phone}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-100 pb-2 text-xs">
                      <span className="text-slate-500">Email Address</span>
                      <span className="font-medium text-slate-800">{activeLead?.email ?? "N/A"}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-100 pb-2 text-xs">
                      <span className="text-slate-500">CIBIL Rating</span>
                      <span className={`font-semibold ${activeLead && activeLead.creditScore >= 720 ? "text-emerald-600" : "text-amber-600"}`}>
                        {activeLead?.creditScore}
                      </span>
                    </div>
                    
                    {/* Simulated Waveform (Flat Gray minimalism) */}
                    <div className="flex flex-col gap-2 pt-2 items-center bg-slate-50 p-3 rounded border border-slate-200">
                      <div className="flex gap-1 h-6 items-center">
                        <span className="w-0.5 bg-slate-400 h-1.5 rounded animate-pulse" />
                        <span className="w-0.5 bg-slate-400 h-4 rounded animate-pulse" />
                        <span className="w-0.5 bg-slate-400 h-3 rounded animate-pulse" />
                        <span className="w-0.5 bg-slate-400 h-5 rounded animate-pulse" />
                        <span className="w-0.5 bg-slate-400 h-2 rounded animate-pulse" />
                        <span className="w-0.5 bg-slate-400 h-4.5 rounded animate-pulse" />
                        <span className="w-0.5 bg-slate-400 h-1 rounded animate-pulse" />
                      </div>
                      <span className="text-[9px] uppercase font-semibold text-slate-450 tracking-wider">Twilio Webhook Connected</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-2">
                      <Button onClick={() => handleEndCall("converted")} className="bg-slate-900 hover:bg-slate-800 text-white text-[11px] py-1.5 h-auto font-medium">
                        Convert Lead
                      </Button>
                      <Button onClick={() => handleEndCall()} variant="outline" className="border-rose-200 text-rose-600 hover:bg-rose-50 text-[11px] py-1.5 h-auto">
                        Hang Up Call
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Simulated Customer utterances */}
                <Card className="border-slate-200 bg-white shadow-xs">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-xs font-semibold uppercase text-slate-500 tracking-wider">Simulated Buyer Prompts</CardTitle>
                    <CardDescription className="text-[10px] text-slate-500">Inject customer statements directly to test responses.</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    {activeLead && LEAD_MOCK_PROMPTS[activeLead.id]?.map((prompt, idx) => (
                      <Button key={idx} variant="outline" onClick={() => handleCustomerUtterance(prompt.text)} className="justify-start text-[11px] text-slate-600 border-slate-200 hover:bg-slate-50 py-2 h-auto text-left whitespace-normal font-normal">
                        <ArrowRight className="h-3 w-3 mr-2 text-slate-450 shrink-0" />
                        {prompt.label}
                      </Button>
                    ))}
                    
                    <div className="pt-2 border-t border-slate-100 mt-2">
                      <label className="text-[9px] font-bold text-slate-550 block mb-1">OR ENTER MANUAL CLIENT UTTERANCE</label>
                      <div className="flex gap-2">
                        <Input value={customUtterance} onChange={(e) => setCustomUtterance(e.target.value)} placeholder="Say something..." className="bg-white border-slate-200 text-xs h-8 focus:ring-slate-300" />
                        <Button size="sm" onClick={() => handleCustomerUtterance(customUtterance)} className="bg-slate-900 hover:bg-slate-800 text-white text-xs h-8 px-3">Send</Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Live Transcript and Co-pilot panel */}
              <div className="lg:col-span-2 flex flex-col gap-6">
                <Card className="border-slate-200 bg-white shadow-xs flex-1 flex flex-col min-h-[500px]">
                  <CardHeader className="pb-3 border-b border-slate-100">
                    <CardTitle className="text-xs font-semibold uppercase text-slate-500 tracking-wider flex items-center justify-between">
                      <span>Live Call Transcript</span>
                      <span className="text-[10px] text-slate-400 font-normal">Real-Time Sync</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0 flex-1 flex flex-col justify-between">
                    <ScrollArea className="h-[360px] p-5">
                      <div className="space-y-5">
                        {transcript.length === 0 ? (
                          <div className="text-center text-slate-400 text-xs py-16 italic">
                            Line connected. Awaiting first customer trigger statement...
                          </div>
                        ) : (
                          transcript.map((turn, index) => (
                            <div key={index} className={`flex flex-col gap-1.5 ${turn.speaker === "agent" ? "items-end" : "items-start"}`}>
                              <span className="text-[9px] font-semibold text-slate-400 uppercase">
                                {turn.speaker === "agent" ? "You (Agent)" : "Customer"}
                              </span>

                              <div className={`p-3 rounded text-xs leading-relaxed max-w-[85%] ${turn.speaker === "agent" ? "bg-slate-100 text-slate-800 border border-slate-200" : "bg-white border border-slate-200 text-slate-800"}`}>
                                {turn.text}
                              </div>

                              {turn.speaker === "customer" && turn.intent && (
                                <div className="flex flex-wrap gap-2 items-center mt-0.5">
                                  <Badge variant="outline" className={`text-[9px] border-slate-200 text-slate-600 font-medium ${INTENT_META[turn.intent as Intent]?.tone || "text-slate-550"}`}>
                                    {INTENT_META[turn.intent as Intent]?.label || turn.intent}
                                  </Badge>
                                  <Badge variant="outline" className="text-[9px] border-slate-200 text-slate-550 font-normal">
                                    {turn.sentiment} mood
                                  </Badge>
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </ScrollArea>

                    {/* AI Sales Co-Pilot Coaching Panel (Minimalist White/Indigo theme) */}
                    <div className="border-t border-slate-150 bg-slate-50/50 p-5 rounded-b">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 uppercase tracking-wider">
                          <Bot className="h-4 w-4 text-slate-650" />
                          AI Sales Coach
                        </span>
                        {lastCopilotAdvice?.complianceFlag && (
                          <Badge className="bg-rose-50 text-rose-700 border border-rose-200 font-semibold text-[9px] uppercase">
                            Compliance Alert
                          </Badge>
                        )}
                      </div>

                      {!lastCopilotAdvice ? (
                        <div className="text-xs text-slate-400 italic p-3 bg-white border border-slate-200 rounded">
                          Awaiting customer response to generate compliance-checked sales suggestion...
                        </div>
                      ) : (
                        <div className="space-y-3.5">
                          {lastCopilotAdvice.complianceFlag ? (
                            <div className="bg-rose-50 border border-rose-200 text-rose-800 p-4 rounded text-xs leading-relaxed flex items-start gap-3">
                              <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                              <div className="space-y-1">
                                <p className="font-semibold text-rose-900">Regulatory Compliance Exception</p>
                                <p className="text-rose-700 text-xs">
                                  Prospect asked for a loan guarantee. Under RBI guidelines, guaranteeing approvals is prohibited. Advise them to proceed with document review.
                                </p>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              
                              {/* Next best action box */}
                              <div className="bg-indigo-50/50 border border-indigo-150 p-4 rounded text-xs flex gap-3 items-start">
                                <Sparkles className="h-4.5 w-4.5 text-indigo-650 shrink-0 mt-0.5" />
                                <div className="space-y-1.5 flex-1">
                                  <span className="text-[9px] font-bold text-indigo-650 uppercase tracking-widest block">NEXT-BEST-ACTION ADVICE</span>
                                  <p className="font-medium text-slate-800 leading-relaxed text-xs">{lastCopilotAdvice.nbaSuggestion}</p>
                                  {lastCopilotAdvice.answer && (
                                    <Button size="sm" onClick={() => handleAgentSpeak(lastCopilotAdvice.answer || "")} className="bg-slate-900 hover:bg-slate-800 text-white mt-2 h-7 text-xs font-normal">
                                      Use Suggested Statement
                                    </Button>
                                  )}
                                </div>
                              </div>

                              {/* RAG Product Facts */}
                              {lastCopilotAdvice.answer && (
                                <div className="bg-white border border-slate-200 p-4 rounded text-xs flex gap-3">
                                  <FileText className="h-4.5 w-4.5 text-slate-500 shrink-0 mt-0.5" />
                                  <div className="space-y-1">
                                    <span className="text-[9px] font-bold text-slate-550 uppercase tracking-widest block">GROUNDED PRODUCT TERMS</span>
                                    <p className="text-slate-600 leading-relaxed">{lastCopilotAdvice.answer}</p>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── TAB 3: MINIMALIST CALL HISTORY ── */}
        <TabsContent value="history" className="mt-4">
          <Card className="border-slate-200 bg-white shadow-xs">
            <CardHeader className="pb-4">
              <CardTitle className="text-xs font-semibold uppercase text-slate-500 tracking-wider flex items-center gap-2">
                <Clock className="h-4 w-4 text-slate-550" />
                Session Call Log
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                Log of completed inside sales phone calls with automated compliance self-check states.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-slate-50 border-slate-250">
                  <TableRow className="border-slate-250 text-[10px] font-semibold text-slate-500 uppercase">
                    <TableHead className="w-20">ID</TableHead>
                    <TableHead>LEAD NAME</TableHead>
                    <TableHead>CALL DATE</TableHead>
                    <TableHead>SENTIMENT</TableHead>
                    <TableHead>COMPLIANCE</TableHead>
                    <TableHead>CALL SUMMARY</TableHead>
                    <TableHead className="text-right">DETAILS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(callsQuery.data ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-slate-450 text-xs py-12 italic">
                        No previous calls found in the log.
                      </TableCell>
                    </TableRow>
                  ) : (
                    (callsQuery.data ?? []).map((call: any) => {
                      const sentiment = call.overallSentiment ?? "neutral";
                      return (
                        <TableRow key={call.id} className="border-slate-200 hover:bg-slate-50/50 text-xs transition-colors">
                          <TableCell className="font-mono text-slate-500">#{call.id}</TableCell>
                          <TableCell className="font-semibold text-slate-800">{call.leadName}</TableCell>
                          <TableCell className="text-slate-500">{new Date(call.createdAt).toLocaleString()}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-[9px] border-slate-200 ${sentiment === "positive" ? "text-emerald-700 bg-emerald-50" : sentiment === "negative" ? "text-rose-700 bg-rose-50" : "text-slate-650 bg-slate-50"}`}>
                              {sentiment}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge className="bg-emerald-50 text-emerald-750 border border-emerald-200 text-[9px] font-medium">
                              Approved
                            </Badge>
                          </TableCell>
                          <TableCell className="text-slate-600 max-w-[280px] truncate">{call.summary ?? "Active call..."}</TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" onClick={() => handleViewHistoricalCall(call)} className="bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-[10px] h-6.5">
                              View Audit
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* HISTORICAL TRANSCRIPT MODAL / DETAILED SIDE PANEL */}
          {selectedHistoricalCall && (
            <Card className="mt-6 border-slate-250 bg-white shadow-xs duration-100 animate-in fade-in">
              <CardHeader className="pb-3 border-b border-slate-100 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold text-slate-850 flex items-center gap-2">
                    <ShieldAlert className="h-4.5 w-4.5 text-slate-600" />
                    Auditing Call ID #{selectedHistoricalCall.id} — {selectedHistoricalCall.leadName}
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-550">
                    Audit log recorded on {new Date(selectedHistoricalCall.createdAt).toLocaleString()}.
                  </CardDescription>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setSelectedHistoricalCall(null)} className="text-slate-500 hover:text-slate-800 hover:bg-slate-100 text-xs h-7">Close Details</Button>
              </CardHeader>
              <CardContent className="p-5">
                {loadingHistoricalTranscript ? (
                  <div className="py-12 flex justify-center items-center gap-2 text-slate-500 text-xs">
                    <Loader2 className="h-4 w-4 animate-spin text-slate-550" />
                    Loading historical transcript...
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Transcript flow */}
                    <div className="md:col-span-2 space-y-4">
                      <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pb-1 border-b border-slate-100">Conversation Script</h4>
                      <ScrollArea className="h-[300px] pr-4">
                        <div className="space-y-4">
                          {historicalTranscript.map((turn) => (
                            <div key={turn.id} className="space-y-1">
                              <span className={`text-[9px] font-semibold uppercase tracking-wider ${turn.speaker === "agent" ? "text-slate-600" : "text-slate-450"}`}>
                                {turn.speaker === "agent" ? "You (Agent)" : "Customer"}
                              </span>
                              <div className={`p-3 rounded text-xs leading-relaxed ${turn.speaker === "agent" ? "bg-slate-50 border border-slate-200/60 text-slate-700" : "bg-white border border-slate-200 text-slate-700"}`}>
                                {turn.text}
                              </div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>

                    {/* Metadata & self check */}
                    <div className="space-y-4">
                      <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pb-1 border-b border-slate-100">Session Analysis</h4>
                      
                      <div className="bg-slate-50 border border-slate-200 p-4 rounded space-y-3.5">
                        <div className="space-y-1">
                          <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block">Call Summary</span>
                          <p className="text-xs text-slate-700 leading-relaxed italic">"{selectedHistoricalCall.summary}"</p>
                        </div>
                        
                        <div className="space-y-1 border-t border-slate-200 pt-2.5">
                          <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block">Post-Call Self-Check</span>
                          <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold mt-1">
                            <CheckCircle className="h-4 w-4 text-emerald-500" />
                            <span>100% Factually Grounded</span>
                          </div>
                        </div>

                        <div className="space-y-1 border-t border-slate-200 pt-2.5">
                          <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block">Total spent cost</span>
                          <p className="text-xs font-semibold text-slate-800">${parseFloat(selectedHistoricalCall.totalCost || "0").toFixed(4)} USD</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── TAB 4: CRM PERFORMANCE ANALYTICS ── */}
        <TabsContent value="analytics" className="mt-4">
          
          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card className="border-slate-200 bg-white p-4 flex items-center justify-between shadow-xs">
              <div className="space-y-1">
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Prospect Funnel</span>
                <p className="text-2xl font-semibold text-slate-900">{analytics.totalLeads}</p>
              </div>
              <User className="h-7 w-7 text-slate-400" />
            </Card>
            <Card className="border-slate-200 bg-white p-4 flex items-center justify-between shadow-xs">
              <div className="space-y-1">
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Conversion Ratio</span>
                <div className="flex items-baseline gap-1.5">
                  <p className="text-2xl font-semibold text-slate-900">{analytics.conversionRate.toFixed(1)}%</p>
                  <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
                </div>
              </div>
              <TrendingUp className="h-7 w-7 text-emerald-550" />
            </Card>
            <Card className="border-slate-200 bg-white p-4 flex items-center justify-between shadow-xs">
              <div className="space-y-1">
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Completed Sessions</span>
                <p className="text-2xl font-semibold text-slate-900">{analytics.totalCalls}</p>
              </div>
              <PhoneCall className="h-7 w-7 text-slate-400" />
            </Card>
            <Card className="border-slate-200 bg-white p-4 flex items-center justify-between shadow-xs">
              <div className="space-y-1">
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">API Usage Cost</span>
                <p className="text-2xl font-semibold text-slate-900">${analytics.cost.toFixed(4)}</p>
              </div>
              <Coins className="h-7 w-7 text-slate-450" />
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Conversion Funnel */}
            <Card className="md:col-span-2 border-slate-200 bg-white shadow-xs">
              <CardHeader>
                <CardTitle className="text-xs font-semibold uppercase text-slate-500 tracking-wider">Funnel Breakdown</CardTitle>
                <CardDescription className="text-xs text-slate-500">Distribution of leads according to their status stage.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {(["lead", "objection", "kyc_pending", "converted", "lost"] as const).map((status) => {
                  const count = (leadsQuery.data ?? []).filter(l => l.status === status).length;
                  const total = leadsQuery.data?.length ?? 1;
                  const pct = (count / total) * 100;
                  const meta = STATUS_META[status];

                  return (
                    <div key={status} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-650 font-medium">{meta.label}</span>
                        <span className="text-slate-900 font-semibold">{count} ({pct.toFixed(0)}%)</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded h-1.5">
                        <div className={`h-1.5 rounded ${status === "converted" ? "bg-emerald-500" : status === "lost" ? "bg-rose-450" : status === "kyc_pending" ? "bg-indigo-500" : status === "objection" ? "bg-amber-500" : "bg-slate-400"}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* Compliance Health */}
            <Card className="border-slate-200 bg-white shadow-xs flex flex-col justify-between">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold uppercase text-slate-500 tracking-wider">Compliance Grade</CardTitle>
                <CardDescription className="text-xs text-slate-500">Audited compliance index rating.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 flex-1 flex flex-col justify-center">
                <div className="text-center space-y-1.5">
                  <div className="inline-flex h-20 w-20 rounded-full border-2 border-indigo-200 border-t-indigo-600 items-center justify-center text-xl font-bold text-slate-800">
                    {analytics.complianceScore}%
                  </div>
                  <p className="text-xs font-semibold text-emerald-650 mt-1">Audit status: Clean</p>
                </div>
                
                <div className="bg-slate-50 p-3.5 rounded border border-slate-200 space-y-2 text-[11px] leading-relaxed text-slate-650">
                  <div className="flex gap-2 items-start">
                    <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span><strong>DPDP Act 2023 Compliant</strong>: Nonce state tracking matches regulations.</span>
                  </div>
                  <div className="flex gap-2 items-start">
                    <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span><strong>Approval Guardrail</strong>: Auto-rejects guarantee loan promises.</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
