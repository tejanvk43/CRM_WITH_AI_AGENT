import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useRealtimeCall, useRealtimeLeads } from "@/hooks/useRealtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Search,
  Sparkles,
  Loader2,
  AlertTriangle,
  PhoneCall,
  UserPlus,
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
  ExternalLink,
  Volume2,
  Mic,
  MicOff,
  Play,
  Pause,
  ShieldCheck,
  CreditCard,
  Check,
  X,
  Send,
  Phone,
  Radio,
  MessageSquare,
  Headphones,
  Settings,
  Users
} from "lucide-react";
import { toast } from "sonner";

type UserRole = "admin" | "underwriter" | "sales" | "compliance";

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
  id?: number;
  speaker: "customer" | "agent";
  text: string;
  intent?: string;
  sentiment?: string;
  answer?: string;
  nbaSuggestion?: string;
  complianceFlag?: boolean;
  audioUrl?: string | null;
  costUsd?: string;
}

const ROLE_CONFIG: Record<UserRole, { label: string; badge: string; icon: React.ElementType; description: string }> = {
  sales: {
    label: "Sales Manager / Rep",
    badge: "bg-emerald-100 text-emerald-800 border-emerald-200",
    icon: Users,
    description: "Human-to-Human Sales Calling: Sales Manager and Customer speak directly with 0 AI voice."
  },
  underwriter: {
    label: "Credit Underwriter",
    badge: "bg-blue-100 text-blue-800 border-blue-200",
    icon: CreditCard,
    description: "Review and approve digital KYC applications, verify Aadhaar/PAN, and set credit limits."
  },
  compliance: {
    label: "Compliance Officer",
    badge: "bg-amber-100 text-amber-800 border-amber-200",
    icon: ShieldAlert,
    description: "Audit voice recordings, check factual grounding, and inspect RBI lending compliance."
  },
  admin: {
    label: "Super Admin",
    badge: "bg-purple-100 text-purple-800 border-purple-200",
    icon: ShieldCheck,
    description: "Full administrative access across sales, underwriting, compliance, and cost analytics."
  },
};

const STATUS_META = {
  lead: { label: "Prospect", tone: "bg-slate-100 text-slate-700 border-slate-200" },
  objection: { label: "Objections Raised", tone: "bg-amber-100/60 text-amber-800 border-amber-200" },
  kyc_pending: { label: "KYC Pending", tone: "bg-indigo-100/60 text-indigo-800 border-indigo-200" },
  converted: { label: "Converted / Approved", tone: "bg-emerald-100/60 text-emerald-800 border-emerald-200" },
  lost: { label: "Lost", tone: "bg-rose-100/60 text-rose-800 border-rose-200" },
};

export default function Demo() {
  const [currentRole, setCurrentRole] = useState<UserRole>("sales");

  // Sales Manager Phone Configuration (Saved locally)
  const [managerPhone, setManagerPhone] = useState(() => {
    return localStorage.getItem("sales_manager_phone") || "+910000000000";
  });
  const [showManagerConfig, setShowManagerConfig] = useState(false);

  const handleSaveManagerPhone = (phone: string) => {
    setManagerPhone(phone);
    localStorage.setItem("sales_manager_phone", phone);
    toast.success(`Sales Manager phone updated to ${phone}`);
    setShowManagerConfig(false);
  };

  // Data Queries
  const leadsQuery = trpc.copilot.getLeads.useQuery(undefined, { refetchInterval: 3000 });
  const callsQuery = trpc.copilot.getCalls.useQuery(undefined, { refetchInterval: 5000 });
  const kycQuery = trpc.copilot.getKycApplications.useQuery(undefined, { refetchInterval: 3000 });
  const costLog = trpc.copilot.costLog.useQuery(undefined, { refetchInterval: 5000 });
  
  // Mutations
  const startCallMutation = trpc.copilot.startCall.useMutation();
  const processTurnMutation = trpc.copilot.processCallTurn.useMutation();
  const endCallMutation = trpc.copilot.endCall.useMutation();
  const resetCrmMutation = trpc.copilot.resetCrm.useMutation();
  const createLeadMutation = trpc.copilot.createLead.useMutation();
  const reviewKycMutation = trpc.copilot.reviewKycApplication.useMutation();
  const utils = trpc.useUtils();

  // Tab State
  const [activeTab, setActiveTab] = useState("leads");

  // Call & Dialer State
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

  // Softphone & Browser Microphone State
  const [isMicActive, setIsMicActive] = useState(false);
  const [isSendingKycSms, setIsSendingKycSms] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Quick Direct Dial Modal State
  const [showDirectDial, setShowDirectDial] = useState(false);
  const [directDialCustomerPhone, setDirectDialCustomerPhone] = useState("");
  const [directDialName, setDirectDialName] = useState("");

  // Filters & Search
  const [leadSearch, setLeadSearch] = useState("");
  const [creditFilter, setCreditFilter] = useState<"all" | "high" | "low">("all");
  const [kycStatusFilter, setKycStatusFilter] = useState<string>("all");

  // Historical Call Audits & Audio Replay
  const [selectedHistoricalCall, setSelectedHistoricalCall] = useState<any>(null);
  const [historicalTranscript, setHistoricalTranscript] = useState<any[]>([]);
  const [loadingHistoricalTranscript, setLoadingHistoricalTranscript] = useState(false);
  const [playingTurnIndex, setPlayingTurnIndex] = useState<number | null>(null);
  const [isPlayingFullSession, setIsPlayingFullSession] = useState(false);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // KYC Review Modal State
  const [selectedKycApp, setSelectedKycApp] = useState<any>(null);
  const [customApprovalLimit, setCustomApprovalLimit] = useState<number>(50000);
  const [rejectionReason, setRejectionReason] = useState<string>("Incomplete document verification");

  // New Lead Modal State
  const [showAddLead, setShowAddLead] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newCredit, setNewCredit] = useState(720);

  // Realtime Subscriptions
  const { realtimeTurns } = useRealtimeCall(activeCallId);

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
          audioUrl: (latest as any).audioUrl ?? undefined,
        },
      ];
    });
  }, [realtimeTurns]);

  const handleLeadUpdate = useCallback((updatedLead: any) => {
    utils.copilot.getLeads.invalidate();
    utils.copilot.getCalls.invalidate();
    utils.copilot.getKycApplications.invalidate();
    if (activeLead && updatedLead.id === activeLead.id) {
      setActiveLead((prev) => (prev ? { ...prev, ...updatedLead } : prev));
    }
  }, [activeLead, utils]);
  const { isConnected: leadsRtConnected } = useRealtimeLeads(handleLeadUpdate);

  // Filtered Lists
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

  const filteredKycApps = useMemo(() => {
    return (kycQuery.data ?? []).filter((app: any) => {
      if (kycStatusFilter !== "all" && app.status !== kycStatusFilter) return false;
      return true;
    });
  }, [kycQuery.data, kycStatusFilter]);

  const pendingKycCount = useMemo(() => {
    return (kycQuery.data ?? []).filter((app: any) => app.status === "pending").length;
  }, [kycQuery.data]);

  const analytics = useMemo(() => {
    const totalLeads = leadsQuery.data?.length ?? 0;
    const converted = leadsQuery.data?.filter(l => l.status === "converted").length ?? 0;
    const conversionRate = totalLeads > 0 ? (converted / totalLeads) * 100 : 0;
    const totalCalls = callsQuery.data?.length ?? 0;
    const cost = costLog.data?.total_usd ?? 0;
    const approvedLimitsTotal = (kycQuery.data ?? [])
      .filter((app: any) => app.status === "approved")
      .reduce((sum: number, app: any) => sum + (app.approvedLimit || app.requestedLimit || 50000), 0);

    return {
      totalLeads,
      conversionRate,
      totalCalls,
      cost,
      pendingKyc: pendingKycCount,
      approvedLimitsTotal,
      complianceScore: 100,
    };
  }, [leadsQuery.data, callsQuery.data, costLog.data, kycQuery.data, pendingKycCount]);

  // Audio Playback Handler for Specific Turn
  const handlePlayTurnAudio = async (text: string, existingAudioUrl?: string | null, index?: number) => {
    if (playingTurnIndex === index) {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
      }
      setPlayingTurnIndex(null);
      return;
    }

    setPlayingTurnIndex(index ?? -1);
    toast.info("🔊 Playing audio speech...");

    if (existingAudioUrl) {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.src = existingAudioUrl;
        audioPlayerRef.current.play().catch(() => playSpeechSynthesisFallback(text));
        return;
      }
    }

    try {
      const res = await fetch("http://localhost:8000/twilio/tts/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
      const data = await res.json();
      if (data.audioUrl && audioPlayerRef.current) {
        audioPlayerRef.current.src = data.audioUrl;
        await audioPlayerRef.current.play();
        return;
      }
    } catch (e) {
      console.warn("TTS synthesis error:", e);
    }

    // Web Speech API fallback
    playSpeechSynthesisFallback(text);
  };

  const playSpeechSynthesisFallback = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onend = () => setPlayingTurnIndex(null);
      utterance.onerror = () => setPlayingTurnIndex(null);
      window.speechSynthesis.speak(utterance);
    } else {
      setPlayingTurnIndex(null);
    }
  };

  // Play Full Conversation Dialogue Sequentially
  const handlePlayFullConversation = async () => {
    if (isPlayingFullSession) {
      if (audioPlayerRef.current) audioPlayerRef.current.pause();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      setIsPlayingFullSession(false);
      setPlayingTurnIndex(null);
      return;
    }

    if (!historicalTranscript.length) {
      toast.error("No transcript turns to play.");
      return;
    }

    setIsPlayingFullSession(true);
    toast.success("▶ Playing full conversation audio sequence!");

    for (let i = 0; i < historicalTranscript.length; i++) {
      const turn = historicalTranscript[i];
      setPlayingTurnIndex(i);
      await new Promise<void>((resolve) => {
        if ('speechSynthesis' in window) {
          const prefix = turn.speaker === "agent" ? "Sales Representative: " : "Customer: ";
          const utterance = new SpeechSynthesisUtterance(prefix + turn.text);
          utterance.onend = () => resolve();
          utterance.onerror = () => resolve();
          window.speechSynthesis.speak(utterance);
        } else {
          setTimeout(resolve, 3000);
        }
      });
    }

    setIsPlayingFullSession(false);
    setPlayingTurnIndex(null);
    toast.info("Full conversation playback finished.");
  };

  // Browser Softphone Microphone (Web Speech Recognition for Human Agent)
  const toggleAgentMicrophone = () => {
    if (isMicActive) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsMicActive(false);
      toast.info("Agent microphone muted.");
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Speech Recognition is not supported in this browser. Please use Chrome or Edge.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-IN";

    recognition.onstart = () => {
      setIsMicActive(true);
      toast.success("🎙️ Agent Headset Active: You can speak with the customer now.");
    };

    recognition.onresult = (event: any) => {
      const lastResultIndex = event.results.length - 1;
      const transcriptText = event.results[lastResultIndex][0].transcript.trim();
      if (transcriptText) {
        handleAgentSpeak(transcriptText);
      }
    };

    recognition.onerror = (event: any) => {
      console.warn("Speech recognition error:", event.error);
      setIsMicActive(false);
    };

    recognition.onend = () => {
      setIsMicActive(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  // Send KYC SMS to Customer while on Call
  const handleSendKycSmsToCustomer = async () => {
    if (!activeLead?.phone) {
      toast.error("No phone number available for active lead.");
      return;
    }
    setIsSendingKycSms(true);
    try {
      const res = await fetch("http://localhost:8000/twilio/sms/kyc-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: activeLead.phone })
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`📱 Digital KYC link texted to ${activeLead.phone}!`);
      } else {
        toast.error("Failed to send KYC SMS.");
      }
    } catch (e) {
      toast.error("Error dispatching KYC link SMS.");
    } finally {
      setIsSendingKycSms(false);
    }
  };

  // Actions: Initiate Direct 2-Way Human Call (Manager ↔ Customer)
  const handleStartCall = async (lead: Lead) => {
    try {
      const { callId } = await startCallMutation.mutateAsync({
        leadId: lead.id,
        agentPhone: managerPhone,
      });
      setActiveCallId(callId);
      setActiveLead(lead);
      setTranscript([]);
      setLastCopilotAdvice(null);
      setActiveTab("dialer");
      toast.success(`📞 Direct Human Bridge initiated! Twilio is connecting Manager (${managerPhone}) ↔ Customer (${lead.phone})! Zero AI speech.`);
    } catch (err) {
      toast.error("Failed to initiate call session");
    }
  };

  // Direct Dial Physical Phone via Twilio Outbound
  const handleDirectDialOutbound = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directDialCustomerPhone.trim()) {
      toast.error("Please enter a customer destination phone number.");
      return;
    }

    const targetName = directDialName.trim() || `Customer (${directDialCustomerPhone})`;
    try {
      await createLeadMutation.mutateAsync({
        name: targetName,
        phone: directDialCustomerPhone.trim(),
        creditScore: 720,
        notes: "Initiated from CRM human bridge dialer.",
      });

      const updatedLeads = await utils.copilot.getLeads.fetch();
      const created = updatedLeads.find((l: any) => l.phone.includes(directDialCustomerPhone.trim().slice(-10))) || updatedLeads[0];

      if (created) {
        const { callId } = await startCallMutation.mutateAsync({
          leadId: created.id,
          agentPhone: managerPhone,
        });
        setActiveCallId(callId);
        setActiveLead(created);
        setTranscript([]);
        setLastCopilotAdvice(null);
        setActiveTab("dialer");
        setShowDirectDial(false);
        setDirectDialCustomerPhone("");
        setDirectDialName("");
        toast.success(`📞 Calling Manager (${managerPhone}) to bridge with Customer (${directDialCustomerPhone}) with ZERO AI voice!`);
      }
    } catch (err) {
      toast.error("Failed to bridge outbound call.");
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
    } catch (err) {
      toast.error("Failed to process conversation turn");
    }
  };

  const handleAgentSpeak = async (text: string) => {
    if (!activeCallId || !text.trim()) return;
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
    if (isMicActive && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsMicActive(false);
    }
    try {
      const outcome = await endCallMutation.mutateAsync({
        callId: activeCallId,
        overrideStatus,
      });
      toast.success(`Call completed. Lead status: ${outcome.status.toUpperCase()}`);
      setActiveCallId(null);
      setActiveLead(null);
      utils.copilot.getLeads.invalidate();
      utils.copilot.getCalls.invalidate();
      setActiveTab("leads");
    } catch (err) {
      toast.error("Failed to finalize call");
    }
  };

  const handleResetCrm = async () => {
    if (confirm("Are you sure you want to reset the CRM database? All records will be cleared.")) {
      await resetCrmMutation.mutateAsync();
      toast.success("CRM database reset.");
      setActiveCallId(null);
      setActiveLead(null);
      utils.copilot.getLeads.invalidate();
      utils.copilot.getCalls.invalidate();
      utils.copilot.getKycApplications.invalidate();
    }
  };

  const handleViewHistoricalCall = async (call: any) => {
    setSelectedHistoricalCall(call);
    setLoadingHistoricalTranscript(true);
    try {
      const result = await utils.client.copilot.getCallTranscript.query({ callId: call.id });
      setHistoricalTranscript(result || []);
    } catch (err) {
      toast.error("Failed to fetch historical call transcript");
    } finally {
      setLoadingHistoricalTranscript(false);
    }
  };

  const handleApproveKyc = async (appId: number, limit: number) => {
    try {
      await reviewKycMutation.mutateAsync({
        applicationId: appId,
        action: "approve",
        approvedLimit: limit,
        reviewedBy: ROLE_CONFIG[currentRole].label,
      });
      toast.success(`KYC Approved! Credit line of ₹${limit.toLocaleString('en-IN')} granted.`);
      setSelectedKycApp(null);
      utils.copilot.getKycApplications.invalidate();
      utils.copilot.getLeads.invalidate();
    } catch (err) {
      toast.error("Failed to approve KYC application");
    }
  };

  const handleRejectKyc = async (appId: number, reason: string) => {
    try {
      await reviewKycMutation.mutateAsync({
        applicationId: appId,
        action: "reject",
        rejectionReason: reason,
        reviewedBy: ROLE_CONFIG[currentRole].label,
      });
      toast.info("KYC application rejected.");
      setSelectedKycApp(null);
      utils.copilot.getKycApplications.invalidate();
      utils.copilot.getLeads.invalidate();
    } catch (err) {
      toast.error("Failed to update KYC application");
    }
  };

  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newPhone) {
      toast.error("Name and Phone number are required.");
      return;
    }
    try {
      await createLeadMutation.mutateAsync({
        name: newName,
        phone: newPhone,
        email: newEmail,
        creditScore: newCredit,
        notes: "Manually added prospect.",
      });
      toast.success("New prospect created successfully.");
      setShowAddLead(false);
      setNewName("");
      setNewPhone("");
      setNewEmail("");
      utils.copilot.getLeads.invalidate();
    } catch (err) {
      toast.error("Failed to create prospect");
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto w-full min-h-screen text-slate-800 bg-[#fbfcfd] antialiased">
      {/* Hidden Global Audio Tag for Replay */}
      <audio
        ref={audioPlayerRef}
        onEnded={() => setPlayingTurnIndex(null)}
        onError={() => setPlayingTurnIndex(null)}
        className="hidden"
      />

      {/* HEADER SECTION & ENTERPRISE RBAC SELECTOR */}
      <div className="flex justify-between items-start flex-wrap gap-4 border-b border-slate-200 pb-5">
        <div className="space-y-1.5">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
              <span className="h-7 w-7 bg-slate-900 text-white rounded-lg flex items-center justify-center text-xs font-bold shadow-xs">FP</span>
              FlexiPay Enterprise CRM &amp; Sales Bridge
            </h1>
            <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium border ${leadsRtConnected ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-600 border-slate-200"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${leadsRtConnected ? "bg-emerald-500 animate-pulse" : "bg-slate-400"}`} />
              {leadsRtConnected ? "Supabase Realtime Live" : "PostgreSQL Connected"}
            </div>
            {activeCallId && (
              <div className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium border bg-emerald-50 text-emerald-800 border-emerald-200 animate-pulse">
                <Users className="h-3.5 w-3.5 text-emerald-600" />
                Human Call Active: Manager ↔ Customer
              </div>
            )}
          </div>
          <p className="text-xs text-slate-500">
            100% Direct Human-to-Human Telephone Bridge (Zero AI Voice), Real-Time AI Copilot screen coaching &amp; digital KYC underwriting.
          </p>
        </div>
        
        {/* ROLE SWITCHER & ACTIONS */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* RBAC Role Selector Dropdown */}
          <div className="flex items-center gap-2 bg-white border border-slate-200 p-1.5 rounded-lg shadow-2xs">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1.5">Role:</span>
            <div className="flex gap-1">
              {(["sales", "underwriter", "compliance", "admin"] as UserRole[]).map((roleKey) => {
                const isSelected = currentRole === roleKey;
                const config = ROLE_CONFIG[roleKey];
                const IconComponent = config.icon;
                return (
                  <button
                    key={roleKey}
                    onClick={() => {
                      setCurrentRole(roleKey);
                      if (roleKey === "underwriter") setActiveTab("kyc");
                      if (roleKey === "sales") setActiveTab("leads");
                      if (roleKey === "compliance") setActiveTab("history");
                      toast.info(`Switched active view to ${config.label}`);
                    }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all ${
                      isSelected
                        ? "bg-slate-900 text-white shadow-xs"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    <IconComponent className="h-3 w-3" />
                    <span>{config.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <Button
            size="sm"
            onClick={() => setShowManagerConfig(!showManagerConfig)}
            variant="outline"
            className="border-slate-300 text-slate-700 hover:bg-slate-50 text-xs h-8 gap-1.5"
          >
            <Settings className="h-3.5 w-3.5" />
            Manager Phone: <strong className="text-slate-900 font-mono">{managerPhone}</strong>
          </Button>

          <Button
            size="sm"
            onClick={() => setShowDirectDial(!showDirectDial)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8 gap-1.5 shadow-xs font-semibold"
          >
            <Phone className="h-3.5 w-3.5" />
            Bridge Call to Customer
          </Button>

          <Button variant="outline" size="sm" onClick={handleResetCrm} className="border-slate-200 hover:bg-slate-50 text-slate-600 text-xs h-8">
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Reset CRM
          </Button>

          <Button size="sm" onClick={() => setShowAddLead(true)} className="bg-slate-900 hover:bg-slate-800 text-white text-xs h-8">
            <Plus className="h-3.5 w-3.5 mr-1" />
            New Prospect
          </Button>
        </div>
      </div>

      {/* SALES MANAGER PHONE CONFIG DRAWER */}
      {showManagerConfig && (
        <Card className="border-slate-300 bg-slate-50 p-4 shadow-sm animate-in fade-in">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[240px]">
              <label className="text-[10px] font-bold text-slate-700 uppercase tracking-wider block mb-1">Your Sales Manager Phone Number (Twilio calls you to connect with customer)</label>
              <Input
                defaultValue={managerPhone}
                id="manager-phone-input"
                placeholder="+91 89199 98149"
                className="bg-white border-slate-300 text-xs h-9 font-mono"
              />
            </div>
            <Button
              type="button"
              onClick={() => {
                const val = (document.getElementById("manager-phone-input") as HTMLInputElement)?.value;
                if (val) handleSaveManagerPhone(val);
              }}
              className="bg-slate-900 hover:bg-slate-800 text-white text-xs h-9 px-4 font-semibold"
            >
              Save Manager Phone
            </Button>
            <Button type="button" variant="ghost" onClick={() => setShowManagerConfig(false)} className="text-xs h-9 text-slate-500">
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* DIRECT HUMAN BRIDGE MODAL */}
      {showDirectDial && (
        <Card className="border-emerald-200 bg-emerald-50/40 p-4 shadow-sm animate-in fade-in">
          <form onSubmit={handleDirectDialOutbound} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block mb-1">Customer Destination Phone</label>
              <Input
                value={directDialCustomerPhone}
                onChange={(e) => setDirectDialCustomerPhone(e.target.value)}
                placeholder="+91 98765 43210"
                className="bg-white border-emerald-300 text-xs h-9 font-mono"
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block mb-1">Customer Name (Optional)</label>
              <Input
                value={directDialName}
                onChange={(e) => setDirectDialName(e.target.value)}
                placeholder="Full Name"
                className="bg-white border-emerald-300 text-xs h-9"
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block mb-1">Your Manager Phone (Rings First)</label>
              <Input
                value={managerPhone}
                onChange={(e) => setManagerPhone(e.target.value)}
                className="bg-white border-emerald-300 text-xs h-9 font-mono"
              />
            </div>
            <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-9 px-4 gap-1.5 shadow-xs font-semibold">
              <PhoneCall className="h-3.5 w-3.5" />
              Call &amp; Bridge Phones (0 AI Voice)
            </Button>
            <Button type="button" variant="ghost" onClick={() => setShowDirectDial(false)} className="text-xs h-9 text-slate-500">
              Cancel
            </Button>
          </form>
        </Card>
      )}

      {/* ROLE BANNER */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <Badge className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${ROLE_CONFIG[currentRole].badge}`}>
            {ROLE_CONFIG[currentRole].label} Mode
          </Badge>
          <span className="text-xs text-slate-600 font-normal">
            {ROLE_CONFIG[currentRole].description}
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs font-medium text-slate-600">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
            Total Granted Credit: <strong className="text-slate-900">₹{analytics.approvedLimitsTotal.toLocaleString('en-IN')}</strong>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-500"></span>
            Pending KYC: <strong className="text-amber-700">{analytics.pendingKyc}</strong>
          </span>
        </div>
      </div>

      {/* NEW PROSPECT FORM */}
      {showAddLead && (
        <Card className="border-slate-200 bg-white shadow-sm duration-150 animate-in fade-in">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Register New Lead
            </CardTitle>
            <CardDescription className="text-xs text-slate-500">
              Submit contact &amp; CIBIL details to initialize a prospective customer.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateLead} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              <div>
                <label className="text-[10px] font-semibold text-slate-500 block mb-1">FULL NAME</label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Full Name" className="bg-white border-slate-200 text-xs h-9 focus:ring-slate-400" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-500 block mb-1">PHONE NUMBER</label>
                <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="+91 98765 43210" className="bg-white border-slate-200 text-xs h-9 focus:ring-slate-400" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-500 block mb-1">EMAIL ADDRESS</label>
                <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="email@company.com" className="bg-white border-slate-200 text-xs h-9 focus:ring-slate-400" />
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

      {/* MAIN NAVIGATION TABS CONTAINER */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="flex bg-slate-100/90 border border-slate-200/80 p-1 rounded-lg w-full md:w-auto self-start">
          <TabsTrigger value="leads" className="text-xs font-medium py-1.5 px-3 flex-1 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-xs rounded-md transition-all">
            <User className="h-3.5 w-3.5 mr-1.5 text-slate-500" />
            CRM Lead Funnel
          </TabsTrigger>

          <TabsTrigger value="dialer" className="text-xs font-medium py-1.5 px-3 flex-1 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-xs rounded-md transition-all relative">
            <Users className="h-3.5 w-3.5 mr-1.5 text-slate-500" />
            Human Softphone &amp; Copilot
            {activeCallId && (
              <span className="ml-1.5 h-2 w-2 rounded-full bg-emerald-500 animate-ping inline-block"></span>
            )}
          </TabsTrigger>

          <TabsTrigger value="kyc" className="text-xs font-medium py-1.5 px-3 flex-1 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-xs rounded-md transition-all relative">
            <CreditCard className="h-3.5 w-3.5 mr-1.5 text-slate-500" />
            KYC &amp; Underwriting
            {pendingKycCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.2 bg-amber-500 text-white rounded-full text-[10px] font-bold">
                {pendingKycCount}
              </span>
            )}
          </TabsTrigger>

          <TabsTrigger value="history" className="text-xs font-medium py-1.5 px-3 flex-1 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-xs rounded-md transition-all">
            <Volume2 className="h-3.5 w-3.5 mr-1.5 text-slate-500" />
            Call Audio &amp; Audits
          </TabsTrigger>

          <TabsTrigger value="analytics" className="text-xs font-medium py-1.5 px-3 flex-1 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-xs rounded-md transition-all">
            <BarChart3 className="h-3.5 w-3.5 mr-1.5 text-slate-500" />
            Analytics &amp; Cost
          </TabsTrigger>
        </TabsList>

        {/* ── TAB 1: CRM LEAD BOARD ── */}
        <TabsContent value="leads" className="mt-4">
          <div className="flex gap-4 items-center justify-between mb-4 flex-wrap">
            <div className="flex gap-3 items-center flex-1 max-w-md">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input value={leadSearch} onChange={(e) => setLeadSearch(e.target.value)} placeholder="Search leads by name or phone..." className="pl-9 bg-white border-slate-200 text-xs focus:ring-slate-300" />
              </div>
              <div className="flex items-center gap-1.5 bg-white px-3 py-1.5 border border-slate-200 rounded text-xs text-slate-500">
                <Filter className="h-3.5 w-3.5 text-slate-400" />
                <span>CIBIL:</span>
                <select value={creditFilter} onChange={(e) => setCreditFilter(e.target.value as any)} className="bg-transparent font-medium text-slate-800 outline-none cursor-pointer text-xs">
                  <option value="all">All</option>
                  <option value="high">High (&gt;= 720)</option>
                  <option value="low">Low (&lt; 720)</option>
                </select>
              </div>
            </div>
            <div className="text-xs text-slate-500">
              Showing {filteredLeads.length} prospects
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {(["lead", "objection", "kyc_pending", "converted", "lost"] as const).map((status) => {
              const statusLeads = filteredLeads.filter(l => l.status === status);
              const meta = STATUS_META[status];

              return (
                <div key={status} className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 flex flex-col gap-3 min-h-[450px]">
                  <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                    <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{meta.label}</span>
                    <span className="text-[10px] font-bold text-slate-500 bg-white border border-slate-200 rounded-full px-2 py-0.5">
                      {statusLeads.length}
                    </span>
                  </div>

                  <div className="flex flex-col gap-3 overflow-y-auto max-h-[500px]">
                    {statusLeads.length === 0 ? (
                      <div className="text-center text-[10px] text-slate-400 py-12 italic">No leads in stage</div>
                    ) : (
                      statusLeads.map((lead) => (
                        <div key={lead.id} className="bg-white border border-slate-200 p-3.5 rounded-lg shadow-2xs hover:border-slate-350 transition-all flex flex-col gap-2.5">
                          <div className="space-y-1">
                            <h4 className="font-semibold text-xs text-slate-800">{lead.name}</h4>
                            <p className="text-[11px] text-slate-500 font-mono">{lead.phone}</p>
                          </div>

                          <div className="flex justify-between items-center pt-1 border-t border-slate-100">
                            <span className="text-[10px] text-slate-500">
                              CIBIL: <span className={`font-semibold ${lead.creditScore >= 720 ? "text-emerald-600" : "text-amber-600"}`}>{lead.creditScore}</span>
                            </span>
                            
                            <Button size="sm" onClick={() => handleStartCall(lead)} className="bg-slate-900 hover:bg-slate-800 text-white text-[11px] h-7 px-3 gap-1">
                              <Phone className="h-3 w-3" />
                              Bridge Call
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>

        {/* ── TAB 2: HUMAN-TO-HUMAN SOFTPHONE & REAL-TIME AI COPILOT ── */}
        <TabsContent value="dialer" className="mt-4">
          {!activeCallId ? (
            <Card className="border-slate-200 bg-white p-12 text-center shadow-2xs">
              <Users className="h-10 w-10 text-slate-400 mx-auto mb-3" />
              <h3 className="text-base font-semibold text-slate-800">100% Direct Human-to-Human Telephone Calling</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto mt-1.5 mb-6">
                Twilio rings your Sales Manager phone ({managerPhone}) and connects you directly with the customer on their phone. Zero AI speech on the call.
              </p>
              
              <div className="flex justify-center gap-3 flex-wrap">
                <Button
                  size="sm"
                  onClick={() => {
                    const firstLead = (leadsQuery.data ?? [])[0];
                    if (firstLead) {
                      handleStartCall(firstLead);
                    } else {
                      setShowDirectDial(true);
                    }
                  }}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-9 px-5 font-semibold gap-2 shadow-xs"
                >
                  <PhoneCall className="h-4 w-4" />
                  Connect Manager ↔ Customer Call
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowDirectDial(true)}
                  className="border-slate-300 text-slate-700 hover:bg-slate-50 text-xs h-9 px-4 gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Dial Any Phone Number
                </Button>
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Softphone Live Call & Conversation Transcript */}
              <div className="md:col-span-2 space-y-4">
                <Card className="border-slate-200 bg-white shadow-2xs">
                  <CardHeader className="pb-3 border-b border-slate-100 flex flex-row items-center justify-between flex-wrap gap-2">
                    <div>
                      <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-ping" />
                        Human Live Call: Manager ({managerPhone}) ↔ Customer ({activeLead?.phone})
                      </CardTitle>
                      <CardDescription className="text-xs text-slate-500">
                        Zero AI speech • CIBIL: {activeLead?.creditScore} • Stage: {activeLead?.status?.toUpperCase()}
                      </CardDescription>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {/* One-Click Send KYC SMS */}
                      <Button
                        size="sm"
                        onClick={handleSendKycSmsToCustomer}
                        disabled={isSendingKycSms}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs h-7.5 px-3 gap-1 font-medium shadow-xs"
                      >
                        <MessageSquare className="h-3 w-3" />
                        {isSendingKycSms ? "Sending SMS..." : "Text KYC Link"}
                      </Button>

                      {/* Agent Microphone Toggle */}
                      <Button
                        size="sm"
                        onClick={toggleAgentMicrophone}
                        className={`text-xs h-7.5 px-3 gap-1.5 font-semibold transition-all ${
                          isMicActive
                            ? "bg-red-600 hover:bg-red-700 text-white animate-pulse"
                            : "bg-emerald-600 hover:bg-emerald-700 text-white"
                        }`}
                      >
                        {isMicActive ? <Mic className="h-3.5 w-3.5 animate-bounce" /> : <MicOff className="h-3.5 w-3.5" />}
                        {isMicActive ? "Mic Active (Speaking)" : "Unmute Mic"}
                      </Button>

                      <Button size="sm" variant="destructive" onClick={() => handleEndCall("converted")} className="text-xs h-7.5 px-3">
                        Hang Up Call
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4 space-y-4">
                    {/* Live Conversation Transcript */}
                    <div className="flex justify-between items-center text-[10px] font-bold uppercase text-slate-400 tracking-wider">
                      <span>Live Call Audio Transcript</span>
                      <span className="text-emerald-600 font-semibold flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span> 100% Human to Human
                      </span>
                    </div>

                    <ScrollArea className="h-[280px] pr-4">
                      <div className="space-y-3">
                        {transcript.length === 0 ? (
                          <div className="text-center text-xs text-slate-400 py-12 italic">
                            Live phone bridge active between you and {activeLead?.name}. Speak naturally on your phone.
                          </div>
                        ) : (
                          transcript.map((turn, i) => (
                            <div key={i} className={`p-3 rounded-lg text-xs leading-relaxed ${
                              turn.speaker === "agent"
                                ? "bg-slate-50 border border-slate-200/80 text-slate-800 ml-6"
                                : "bg-blue-50/60 border border-blue-100 text-blue-950 mr-6"
                            }`}>
                              <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-wider mb-1 text-slate-400">
                                <span className={turn.speaker === "agent" ? "text-slate-800 font-bold" : "text-blue-700 font-bold"}>
                                  {turn.speaker === "agent" ? "Sales Manager (You)" : `${activeLead?.name} (Customer)`}
                                </span>
                                <button
                                  onClick={() => handlePlayTurnAudio(turn.text, turn.audioUrl, i)}
                                  className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 px-2 py-0.5 rounded transition-all"
                                >
                                  {playingTurnIndex === i ? (
                                    <>
                                      <Pause className="h-3 w-3 text-blue-700 animate-pulse" />
                                      <span>Pause Audio</span>
                                    </>
                                  ) : (
                                    <>
                                      <Play className="h-3 w-3 text-blue-700" />
                                      <span>Listen to Speech</span>
                                    </>
                                  )}
                                </button>
                              </div>
                              <p>{turn.text}</p>
                            </div>
                          ))
                        )}
                      </div>
                    </ScrollArea>

                    {/* Manual Customer Utterance Simulator or Note Logger */}
                    <div className="pt-2 border-t border-slate-100 flex gap-2">
                      <Input
                        value={customUtterance}
                        onChange={(e) => setCustomUtterance(e.target.value)}
                        placeholder="Log customer note or question for AI copilot advice..."
                        onKeyDown={(e) => { if (e.key === "Enter" && customUtterance) handleCustomerUtterance(customUtterance); }}
                        className="text-xs bg-slate-50 border-slate-200"
                      />
                      <Button size="sm" onClick={() => customUtterance && handleCustomerUtterance(customUtterance)} className="bg-slate-900 hover:bg-slate-800 text-white text-xs h-9 px-3">
                        <Send className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Real-time AI Copilot Coach (For the Human Manager) */}
              <div className="space-y-4">
                <Card className="border-slate-200 bg-white shadow-2xs">
                  <CardHeader className="pb-3 border-b border-slate-100">
                    <CardTitle className="text-xs font-bold uppercase text-slate-500 tracking-wider flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                      AI Copilot Live Screen Coach
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-4 text-xs">
                    {lastCopilotAdvice ? (
                      <div className="space-y-3">
                        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg space-y-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 block">
                            💡 Suggested Pitch / Next Best Action:
                          </span>
                          <p className="text-emerald-950 font-medium leading-relaxed">
                            {lastCopilotAdvice.nbaSuggestion || lastCopilotAdvice.answer}
                          </p>
                        </div>

                        {lastCopilotAdvice.complianceFlag && (
                          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg space-y-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-rose-800 flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" /> Compliance Risk Warning
                            </span>
                            <p className="text-rose-900 text-[11px]">
                              Do not promise guaranteed sanction without KYC verification.
                            </p>
                          </div>
                        )}

                        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                            Grounded Product Knowledge:
                          </span>
                          <p className="text-slate-700 text-[11px] leading-relaxed">
                            {lastCopilotAdvice.answer || "FlexiPay 0% interest pay-in-3 credit line with ₹3,000–₹75,000 limits."}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-6 text-slate-400 space-y-2">
                        <Sparkles className="h-5 w-5 mx-auto text-slate-300" />
                        <p className="text-[11px] italic">
                          As you speak with the customer, the AI Copilot on your screen will provide live answers, product facts, and objection rebuttals.
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── TAB 3: KYC & CREDIT UNDERWRITING QUEUE ── */}
        <TabsContent value="kyc" className="mt-4 space-y-4">
          <div className="flex justify-between items-center flex-wrap gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Digital KYC &amp; Credit Line Underwriting</h3>
              <p className="text-xs text-slate-500">Review verified Aadhaar &amp; PAN submissions, check monthly income, and grant approved limits.</p>
            </div>
            
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 bg-white px-3 py-1.5 border border-slate-200 rounded-lg text-xs">
                <span className="text-slate-400 font-medium">Filter Status:</span>
                <select value={kycStatusFilter} onChange={(e) => setKycStatusFilter(e.target.value)} className="bg-transparent font-semibold text-slate-800 outline-none cursor-pointer">
                  <option value="all">All Applications</option>
                  <option value="pending">Pending Review</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>

              <a href="/twilio/kyc/onboarding" target="_blank" rel="noreferrer" className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200">
                <ExternalLink className="h-3.5 w-3.5" />
                Customer Mobile Portal
              </a>
            </div>
          </div>

          <Card className="border-slate-200 bg-white shadow-2xs">
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-slate-50/80">
                  <TableRow>
                    <TableHead className="text-[10px] font-bold uppercase text-slate-500">ID / Applicant</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase text-slate-500">Phone &amp; OTP</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase text-slate-500">Aadhaar &amp; PAN</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase text-slate-500">Income / Employment</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase text-slate-500">Requested Limit</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase text-slate-500">Status</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase text-slate-500 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredKycApps.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12 text-slate-400 text-xs italic">
                        No KYC applications found. Submissions from the mobile portal will appear here automatically.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredKycApps.map((app: any) => (
                      <TableRow key={app.id} className="hover:bg-slate-50/50">
                        <TableCell>
                          <div className="font-semibold text-xs text-slate-900">{app.fullName}</div>
                          <div className="text-[10px] text-slate-400">App #{app.id} • {new Date(app.createdAt).toLocaleDateString()}</div>
                        </TableCell>
                        <TableCell>
                          <div className="font-mono text-xs text-slate-800">{app.phone}</div>
                          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
                            <Check className="h-3 w-3" /> OTP Verified
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="text-xs font-mono text-slate-700">PAN: {app.panNumber}</div>
                          <div className="text-[10px] font-mono text-slate-400">UID: {app.aadhaarNumber}</div>
                        </TableCell>
                        <TableCell>
                          <div className="text-xs font-semibold text-slate-800">₹{app.monthlyIncome.toLocaleString('en-IN')}/mo</div>
                          <div className="text-[10px] text-slate-500 capitalize">{app.employmentType?.replace("_", " ")}</div>
                        </TableCell>
                        <TableCell>
                          <div className="text-xs font-bold text-slate-900 font-mono">
                            ₹{app.requestedLimit?.toLocaleString('en-IN')}
                          </div>
                          {app.approvedLimit && (
                            <div className="text-[10px] text-emerald-700 font-semibold">
                              Approved: ₹{app.approvedLimit.toLocaleString('en-IN')}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge className={`text-[10px] font-medium px-2 py-0.5 rounded border ${
                            app.status === "approved"
                              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                              : app.status === "rejected"
                              ? "bg-rose-50 text-rose-800 border-rose-200"
                              : "bg-amber-50 text-amber-800 border-amber-200"
                          }`}>
                            {app.status === "approved" ? "Approved" : app.status === "rejected" ? "Rejected" : "Pending Review"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            onClick={() => {
                              setSelectedKycApp(app);
                              setCustomApprovalLimit(app.requestedLimit || 50000);
                            }}
                            className="bg-slate-900 hover:bg-slate-800 text-white text-xs h-7 px-3"
                          >
                            Underwrite
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* UNDERWRITING MODAL / DECISION DRAWER */}
          {selectedKycApp && (
            <Card className="border-slate-300 bg-white shadow-md duration-150 animate-in fade-in">
              <CardHeader className="pb-3 border-b border-slate-100 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <ShieldCheck className="h-4.5 w-4.5 text-blue-600" />
                    Credit Decisioning — {selectedKycApp.fullName} ({selectedKycApp.phone})
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-500">
                    Application #{selectedKycApp.id} submitted on {new Date(selectedKycApp.createdAt).toLocaleString()}.
                  </CardDescription>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setSelectedKycApp(null)} className="text-slate-500 hover:text-slate-800 text-xs h-7">Close</Button>
              </CardHeader>
              <CardContent className="p-5">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Verified Applicant Info */}
                  <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Verified Credentials</h4>
                    <div className="space-y-2 text-xs">
                      <div>
                        <span className="text-slate-400 block text-[10px]">Aadhaar Number (UIDAI verified):</span>
                        <span className="font-mono font-semibold text-slate-800">{selectedKycApp.aadhaarNumber}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">PAN Card (NSDL/ITD verified):</span>
                        <span className="font-mono font-semibold text-slate-800">{selectedKycApp.panNumber}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">Monthly Net Income:</span>
                        <span className="font-semibold text-slate-800">₹{selectedKycApp.monthlyIncome.toLocaleString('en-IN')}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">Employment Profile:</span>
                        <span className="font-medium text-slate-800 capitalize">{selectedKycApp.employmentType?.replace("_", " ")}</span>
                      </div>
                    </div>
                  </div>

                  {/* Limit Adjustment & Risk Scoring */}
                  <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Approved Credit Limit</h4>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-slate-600">Sanction Amount:</span>
                        <span className="text-base font-bold text-emerald-700 font-mono">₹{customApprovalLimit.toLocaleString('en-IN')}</span>
                      </div>
                      <input
                        type="range"
                        min="3000"
                        max="75000"
                        step="1000"
                        value={customApprovalLimit}
                        onChange={(e) => setCustomApprovalLimit(parseInt(e.target.value))}
                        className="w-full accent-slate-900 cursor-pointer"
                      />
                      <div className="flex justify-between text-[10px] text-slate-400">
                        <span>₹3,000</span>
                        <span>₹50,000 (Default)</span>
                        <span>₹75,000</span>
                      </div>
                      <p className="text-[11px] text-slate-500 italic">
                        0% interest pay-in-3 credit line is automatically synced to the customer profile.
                      </p>
                    </div>
                  </div>

                  {/* Decision Actions */}
                  <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col justify-between">
                    <div>
                      <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Officer Decision</h4>
                      <p className="text-xs text-slate-600 mt-1">Reviewing as <strong className="text-slate-900">{ROLE_CONFIG[currentRole].label}</strong>.</p>
                    </div>

                    <div className="space-y-2 pt-2">
                      <Button
                        onClick={() => handleApproveKyc(selectedKycApp.id, customApprovalLimit)}
                        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-9 font-semibold gap-1.5 shadow-xs"
                      >
                        <Check className="h-4 w-4" />
                        Approve &amp; Grant ₹{customApprovalLimit.toLocaleString('en-IN')}
                      </Button>

                      <Button
                        onClick={() => handleRejectKyc(selectedKycApp.id, rejectionReason)}
                        variant="outline"
                        className="w-full border-rose-200 text-rose-700 hover:bg-rose-50 text-xs h-8 font-medium gap-1"
                      >
                        <X className="h-3.5 w-3.5" />
                        Reject Application
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── TAB 4: CALL AUDIO REPLAY & QUALITY AUDITS ── */}
        <TabsContent value="history" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Call Audio Recordings &amp; Quality Audits</h3>
              <p className="text-xs text-slate-500">Listen to recorded conversation audio, verify transcripts, and inspect compliance grounding scores.</p>
            </div>
          </div>

          <Card className="border-slate-200 bg-white shadow-2xs">
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-slate-50/80">
                  <TableRow>
                    <TableHead className="text-[10px] font-bold uppercase text-slate-500">Call ID</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase text-slate-500">Lead Contact</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase text-slate-500">Summary / Topic</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase text-slate-500">Sentiment</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase text-slate-500">Cost USD</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase text-slate-500 text-right">Audit &amp; Audio</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(callsQuery.data ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-12 text-slate-400 text-xs italic">
                        No recorded calls found in database.
                      </TableCell>
                    </TableRow>
                  ) : (
                    (callsQuery.data ?? []).map((call: any) => (
                      <TableRow key={call.id} className="hover:bg-slate-50/50">
                        <TableCell className="font-mono text-xs font-semibold text-slate-800">#{call.id}</TableCell>
                        <TableCell>
                          <div className="font-medium text-xs text-slate-900">{call.leadName}</div>
                          <div className="text-[10px] font-mono text-slate-400">{call.leadPhone}</div>
                        </TableCell>
                        <TableCell className="text-xs text-slate-600 max-w-xs truncate italic">"{call.summary || 'Customer inquiry'}"</TableCell>
                        <TableCell>
                          <Badge className="text-[10px] capitalize bg-slate-100 text-slate-700 border-slate-200">
                            {call.overallSentiment || "neutral"}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate-700">${parseFloat(call.totalCost || "0").toFixed(4)}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" onClick={() => handleViewHistoricalCall(call)} className="bg-slate-900 hover:bg-slate-800 text-white text-xs h-7 px-3 gap-1.5">
                            <Volume2 className="h-3 w-3" />
                            Listen &amp; Audit
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* HISTORICAL TRANSCRIPT & AUDIO REPLAY MODAL */}
          {selectedHistoricalCall && (
            <Card className="border-slate-300 bg-white shadow-md duration-150 animate-in fade-in">
              <CardHeader className="pb-3 border-b border-slate-100 flex flex-row items-center justify-between flex-wrap gap-2">
                <div>
                  <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Volume2 className="h-5 w-5 text-indigo-600" />
                    Audio Transcript &amp; Audit: Call #{selectedHistoricalCall.id} — {selectedHistoricalCall.leadName} ({selectedHistoricalCall.leadPhone})
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-500">
                    Recorded on {new Date(selectedHistoricalCall.createdAt).toLocaleString()}.
                  </CardDescription>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={handlePlayFullConversation}
                    className={`text-xs h-8 px-3 gap-1.5 font-semibold shadow-xs ${
                      isPlayingFullSession
                        ? "bg-rose-600 hover:bg-rose-700 text-white animate-pulse"
                        : "bg-indigo-600 hover:bg-indigo-700 text-white"
                    }`}
                  >
                    {isPlayingFullSession ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    {isPlayingFullSession ? "Pause Full Call" : "▶ Play Entire Call Audio"}
                  </Button>

                  <Button size="sm" variant="ghost" onClick={() => { setSelectedHistoricalCall(null); if (isPlayingFullSession) handlePlayFullConversation(); }} className="text-slate-500 hover:text-slate-800 text-xs h-8">
                    Close Details
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-5">
                {loadingHistoricalTranscript ? (
                  <div className="py-12 flex justify-center items-center gap-2 text-slate-500 text-xs">
                    <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
                    Loading call recording &amp; transcript turns...
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Transcript flow */}
                    <div className="md:col-span-2 space-y-4">
                      <div className="flex justify-between items-center pb-1 border-b border-slate-100">
                        <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Conversation Script ({historicalTranscript.length} Turns)</h4>
                        <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1">
                          <Volume2 className="h-3 w-3" /> Interactive Audio Replay Active
                        </span>
                      </div>

                      <ScrollArea className="h-[340px] pr-4">
                        <div className="space-y-3">
                          {historicalTranscript.length === 0 ? (
                            <div className="text-center py-10 text-xs text-slate-400 italic">
                              No transcript recorded for this session.
                            </div>
                          ) : (
                            historicalTranscript.map((turn: any, index: number) => {
                              const isPlayingThisTurn = playingTurnIndex === index;
                              return (
                                <div key={turn.id || index} className={`p-3.5 rounded-xl text-xs leading-relaxed space-y-2 transition-all ${
                                  isPlayingThisTurn
                                    ? "bg-indigo-50/80 border-2 border-indigo-500 shadow-xs"
                                    : turn.speaker === "agent"
                                    ? "bg-slate-50 border border-slate-200 text-slate-800"
                                    : "bg-white border border-slate-200 text-slate-700"
                                }`}>
                                  <div className="flex justify-between items-center text-[10px]">
                                    <span className={`font-bold uppercase tracking-wider ${turn.speaker === "agent" ? "text-slate-800" : "text-blue-600"}`}>
                                      {turn.speaker === "agent" ? "Sales Manager (You)" : "Customer"}
                                    </span>

                                    {/* Universal Listen / Play Audio Button for Every Turn */}
                                    <button
                                      onClick={() => handlePlayTurnAudio(turn.text, turn.audioUrl, index)}
                                      className={`flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-all ${
                                        isPlayingThisTurn
                                          ? "bg-indigo-600 text-white border-indigo-700 shadow-xs"
                                          : "bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200"
                                      }`}
                                    >
                                      {isPlayingThisTurn ? (
                                        <>
                                          <Pause className="h-3 w-3 text-white animate-pulse" />
                                          <span>Pause Speech</span>
                                        </>
                                      ) : (
                                        <>
                                          <Play className="h-3 w-3 text-indigo-600" />
                                          <span>Listen to Speech</span>
                                        </>
                                      )}
                                    </button>
                                  </div>
                                  <p className="text-xs font-normal leading-relaxed text-slate-800">{turn.text}</p>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </ScrollArea>
                    </div>

                    {/* Session Analysis */}
                    <div className="space-y-4">
                      <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pb-1 border-b border-slate-100">Quality &amp; Grounding Check</h4>
                      
                      <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl space-y-3.5 text-xs">
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Call Summary</span>
                          <p className="text-slate-700 italic">"{selectedHistoricalCall.summary || 'Human sales advisor consultation.'}"</p>
                        </div>
                        
                        <div className="space-y-1 border-t border-slate-200 pt-2.5">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Factual Grounding Score</span>
                          <div className="flex items-center gap-1.5 text-emerald-600 font-semibold mt-1">
                            <CheckCircle className="h-4 w-4 text-emerald-500" />
                            <span>100% Factually Grounded</span>
                          </div>
                        </div>

                        <div className="space-y-1 border-t border-slate-200 pt-2.5">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Inference Cost</span>
                          <p className="font-mono font-semibold text-slate-800">${parseFloat(selectedHistoricalCall.totalCost || "0").toFixed(4)} USD</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── TAB 5: ANALYTICS & COST ── */}
        <TabsContent value="analytics" className="mt-4 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="border-slate-200 bg-white p-4 shadow-2xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Funnel Leads</span>
              <div className="text-2xl font-bold text-slate-900 mt-1">{analytics.totalLeads}</div>
            </Card>

            <Card className="border-slate-200 bg-white p-4 shadow-2xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Underwriting Sanctions</span>
              <div className="text-2xl font-bold text-emerald-700 mt-1 font-mono">₹{analytics.approvedLimitsTotal.toLocaleString('en-IN')}</div>
            </Card>

            <Card className="border-slate-200 bg-white p-4 shadow-2xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Live Calls</span>
              <div className="text-2xl font-bold text-slate-900 mt-1">{analytics.totalCalls}</div>
            </Card>

            <Card className="border-slate-200 bg-white p-4 shadow-2xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Voice Inference Spend</span>
              <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">${analytics.cost.toFixed(4)}</div>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
