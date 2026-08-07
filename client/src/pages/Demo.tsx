import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
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
  GraduationCap,
  ArrowLeft,
  XCircle,
  CheckCircle,
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
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
  status: "lead" | "objection" | "kyc_pending" | "converted" | "lost";
  creditScore: number;
  approvedLimit: number | null;
  notes: string;
  lastCallAt: string | null;
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
  product_question: { label: "Product Question", icon: FileText, tone: "text-blue-400 border-blue-400/30" },
  objection: { label: "Objection Raised", icon: AlertTriangle, tone: "text-amber-500 border-amber-500/30" },
  kyc_question: { label: "KYC Inquiry", icon: FileText, tone: "text-purple-400 border-purple-400/30" },
  ready_to_convert: { label: "Ready to Convert", icon: CheckCircle2, tone: "text-emerald-500 border-emerald-500/30" },
  small_talk: { label: "Small Talk", icon: MessageCircle, tone: "text-gray-400 border-gray-400/30" },
};

const STATUS_META = {
  lead: { label: "New Lead", tone: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  objection: { label: "Skeptical / Objection", tone: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  kyc_pending: { label: "KYC In-Progress", tone: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
  converted: { label: "Converted / Limit Approved", tone: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  lost: { label: "Lost / Rejected", tone: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
};

// Lead-specific simulated customer utterances
const LEAD_MOCK_PROMPTS: Record<number, Array<{ label: string; text: string }>> = {
  1: [
    { label: "Check EMI & interest", text: "Hi, I saw your ad — is this EMI really zero interest? What are the fees?" },
    { label: "Accept and proceed", text: "Okay, that sounds good to me. Let's do it — send me the signup link." },
  ],
  2: [
    { label: "Raise fee skepticism", text: "Nothing is ever free. There must be some hidden charges. I don't trust these schemes." },
    { label: "Object to uploading documents", text: "I really don't want to share my Aadhaar and PAN documents, it feels like too much paperwork." },
    { label: "Say: sounds good", text: "Okay, I understand. Send me the registration link, I'll review it." },
  ],
  3: [
    { label: "Ask about KYC requirements", text: "What documents do I need for KYC, and how long does it take?" },
    { label: "Demand approval guarantee (Sensitive)", text: "This is fine, but can you guarantee my loan approval? I don't want a credit score hit for nothing." },
    { label: "Agree to proceed", text: "Great, I'll proceed with Aadhaar e-verification now. Send me the link." },
  ],
};

export default function Demo() {
  const { user } = useAuth();
  
  // CRM leads query
  const leadsQuery = trpc.copilot.getLeads.useQuery(undefined, {
    refetchInterval: 3000,
  });
  
  // Mutations
  const startCallMutation = trpc.copilot.startCall.useMutation();
  const processTurnMutation = trpc.copilot.processCallTurn.useMutation();
  const endCallMutation = trpc.copilot.endCall.useMutation();
  const resetCrmMutation = trpc.copilot.resetCrm.useMutation();
  const createLeadMutation = trpc.copilot.createLead.useMutation();
  const costLog = trpc.copilot.costLog.useQuery(undefined, { refetchInterval: 5000 });
  const utils = trpc.useUtils();

  // Dialer session state
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

  // New Lead Dialog State
  const [showAddLead, setShowAddLead] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newCredit, setNewCredit] = useState(700);

  // Start call simulation
  const handleStartCall = async (lead: Lead) => {
    try {
      const { callId } = await startCallMutation.mutateAsync({ leadId: lead.id });
      setActiveCallId(callId);
      setActiveLead(lead);
      setTranscript([]);
      setLastCopilotAdvice(null);
      toast.success(`Connected call with ${lead.name}`);
    } catch (err) {
      toast.error("Failed to connect call");
    }
  };

  // Run a turn in the dialer
  const handleCustomerUtterance = async (text: string) => {
    if (!activeCallId) return;
    
    // Add customer speech to local transcript
    const userTurn: TranscriptTurn = { speaker: "customer", text };
    setTranscript((prev) => [...prev, userTurn]);
    
    try {
      // Send turn to backend
      const result = await processTurnMutation.mutateAsync({
        callId: activeCallId,
        speaker: "customer",
        text,
      });

      // Update copilot panel and append intent/sentiment/rag responses
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
        nbaSuggestion: result.nbaSuggestion,
        complianceFlag: result.complianceFlag,
        sources: result.sources,
        intent: result.intent,
        sentiment: result.sentiment,
      });
      
      setCustomUtterance("");
      utils.copilot.costLog.invalidate();
      
      // Auto-simulate agent reading response if RAG answer is available
      if (result.answer && !result.complianceFlag) {
        setTimeout(() => {
          handleAgentSpeak(result.answer);
        }, 1500);
      }
    } catch (err) {
      toast.error("Failed to evaluate turn");
    }
  };

  const handleAgentSpeak = async (text: string) => {
    if (!activeCallId) return;
    
    // Add agent turn to local transcript
    setTranscript((prev) => [...prev, { speaker: "agent", text }]);
    
    try {
      await processTurnMutation.mutateAsync({
        callId: activeCallId,
        speaker: "agent",
        text,
      });
    } catch (err) {
      console.warn("Failed to log agent turn in backend");
    }
  };

  // End active call
  const handleEndCall = async (overrideStatus?: "lead" | "objection" | "kyc_pending" | "converted" | "lost") => {
    if (!activeCallId || !activeLead) return;
    
    try {
      const outcome = await endCallMutation.mutateAsync({
        callId: activeCallId,
        overrideStatus,
      });
      
      toast.success(
        `Call ended. CRM status: ${outcome.status.toUpperCase()} ${
          outcome.approvedLimit ? `(Approved ₹${outcome.approvedLimit.toLocaleString()})` : ""
        }`
      );
      
      setActiveCallId(null);
      setActiveLead(null);
      setTranscript([]);
      setLastCopilotAdvice(null);
      leadsQuery.refetch();
    } catch (err) {
      toast.error("Failed to end call session");
    }
  };

  // Reset CRM
  const handleResetCrm = async () => {
    if (confirm("Reset CRM leads back to initial state?")) {
      await resetCrmMutation.mutateAsync();
      toast.success("CRM Leads reset completed.");
      leadsQuery.refetch();
      utils.copilot.costLog.invalidate();
    }
  };

  // Create Lead
  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newPhone) {
      toast.error("Name and Phone are required.");
      return;
    }
    
    await createLeadMutation.mutateAsync({
      name: newName,
      phone: newPhone,
      email: newEmail,
      creditScore: newCredit,
    });
    
    toast.success("New prospect lead created.");
    setShowAddLead(false);
    setNewName("");
    setNewPhone("");
    setNewEmail("");
    setNewCredit(700);
    leadsQuery.refetch();
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto w-full">
      {/* HEADER SECTION */}
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sales Co-Pilot & CRM Portal</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Real-time Voice co-pilot executing LangGraph agents: Intent, RAG grounding, Next-Best-Action (NBA), and Compliance.
          </p>
        </div>
        
        {/* Cost stats */}
        <div className="flex gap-2 flex-wrap items-center">
          <div className="rounded-lg border bg-card px-4 py-2 text-xs">
            <span className="text-muted-foreground">Session Audit Cost:</span>{" "}
            <span className="font-semibold text-primary">
              ${costLog.data?.total_usd.toFixed(4) ?? "0.0000"}
            </span>
          </div>
          {!activeCallId && (
            <>
              <Button variant="outline" size="sm" onClick={handleResetCrm} disabled={resetCrmMutation.isPending}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
                Reset CRM Data
              </Button>
              <Button size="sm" onClick={() => setShowAddLead(!showAddLead)}>
                <UserPlus className="h-3.5 w-3.5 mr-1" />
                Create Lead
              </Button>
            </>
          )}
        </div>
      </div>

      {/* CREATE LEAD PANEL */}
      {showAddLead && !activeCallId && (
        <Card className="border-primary/20 bg-secondary/10">
          <CardHeader className="py-4">
            <CardTitle className="text-sm">Create New Sales Lead</CardTitle>
            <CardDescription className="text-xs">Add a customer prospect to run call simulations.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateLead} className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Full Name</label>
                <input
                  type="text"
                  placeholder="e.g. Rahul Verma"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-background border rounded px-3 py-1.5 text-sm"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Phone Number</label>
                <input
                  type="text"
                  placeholder="e.g. +91 95000 12345"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="w-full bg-background border rounded px-3 py-1.5 text-sm"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Email</label>
                <input
                  type="email"
                  placeholder="e.g. rahul@outlook.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full bg-background border rounded px-3 py-1.5 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">CIBIL Score (300-900)</label>
                <input
                  type="number"
                  min="300"
                  max="900"
                  value={newCredit}
                  onChange={(e) => setNewCredit(parseInt(e.target.value))}
                  className="w-full bg-background border rounded px-3 py-1.5 text-sm"
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" className="w-full">Save</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowAddLead(false)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* VIEW DIALER ACTIVE OR LEADS LIST */}
      {!activeCallId ? (
        /* CRM LEADS LIST VIEW */
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <PhoneCall className="h-4.5 w-4.5 text-primary" />
              Inside Sales CRM Lead Board
            </CardTitle>
            <CardDescription className="text-xs">
              List of active customer leads, their credit score, onboarding status, and quick call options.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[450px]">
              {leadsQuery.isLoading ? (
                <div className="p-6 text-center text-muted-foreground text-sm flex justify-center items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  Loading CRM data...
                </div>
              ) : (
                <div className="divide-y">
                  {(leadsQuery.data ?? []).map((lead: any) => {
                    const statusConfig = STATUS_META[lead.status as keyof typeof STATUS_META] || { label: lead.status, tone: "bg-gray-500/15" };
                    return (
                      <div key={lead.id} className="p-4 flex flex-wrap items-center justify-between gap-4 hover:bg-secondary/20 transition-all">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">{lead.name}</span>
                            <Badge variant="outline" className={`text-xs ${statusConfig.tone}`}>
                              {statusConfig.label}
                            </Badge>
                            {lead.approvedLimit && (
                              <Badge className="bg-emerald-500 text-black text-xs font-bold">
                                Limit: ₹{lead.approvedLimit.toLocaleString()}
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground flex gap-4 flex-wrap">
                            <span>Phone: {lead.phone}</span>
                            {lead.email && <span>Email: {lead.email}</span>}
                            <span className="flex items-center gap-1">
                              CIBIL:{" "}
                              <span className={`font-semibold ${lead.creditScore >= 700 ? "text-emerald-400" : "text-amber-400"}`}>
                                {lead.creditScore}
                              </span>
                            </span>
                          </div>
                          {lead.notes && (
                            <p className="text-xs text-muted-foreground italic leading-relaxed pt-1 max-w-3xl">
                              Notes: "{lead.notes}"
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {lead.lastCallAt ? `Called ${new Date(lead.lastCallAt).toLocaleTimeString()}` : "Never called"}
                          </span>
                          <Button size="sm" onClick={() => handleStartCall(lead)}>
                            <PhoneCall className="h-3 w-3 mr-1" />
                            Call Lead
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      ) : (
        /* ACTIVE CALL VOICE DIALER SIMULATOR */
        <div className="grid lg:grid-cols-3 gap-6 animate-in fade-in zoom-in-95 duration-200">
          
          {/* LEFT 2 COLUMNS: ACTIVE DIALER & TRANSCRIPT */}
          <div className="lg:col-span-2 space-y-4">
            
            {/* Dialer Call Status Header */}
            <Card className="border-red-500/20 bg-red-950/10">
              <CardContent className="py-4 flex justify-between items-center flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-4 w-4 bg-red-500 animate-pulse rounded-full" />
                  <div>
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      Active Call: {activeLead?.name}
                    </h3>
                    <p className="text-xs text-muted-foreground">{activeLead?.phone} · Line Connected</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleEndCall("lost")} className="text-xs border-rose-500/30 text-rose-400 hover:bg-rose-500/10">
                    <XCircle className="h-3.5 w-3.5 mr-1" />
                    Not Interested
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleEndCall("converted")} className="text-xs border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10">
                    <CheckCircle className="h-3.5 w-3.5 mr-1" />
                    Convert Lead
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => handleEndCall()}>
                    End Call
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Simulated transcript stream */}
            <Card className="h-[380px] flex flex-col">
              <CardHeader className="py-3 border-b flex flex-row justify-between items-center">
                <CardTitle className="text-sm">Live Audio Transcript Stream</CardTitle>
                <Badge variant="outline" className="text-xs">
                  Consent Verified: Recorded & AI-Assisted
                </Badge>
              </CardHeader>
              <CardContent className="flex-1 p-0 overflow-hidden flex flex-col justify-between">
                <ScrollArea className="flex-1 p-4">
                  <div className="space-y-4 pr-3">
                    {transcript.length === 0 && (
                      <div className="py-12 text-center text-muted-foreground text-xs italic">
                        Call connected. Start speech simulation below to begin the conversation.
                      </div>
                    )}
                    
                    {transcript.map((turn, i) => (
                      <div
                        key={i}
                        className={`flex flex-col max-w-[85%] rounded-lg p-3 text-sm ${
                          turn.speaker === "customer"
                            ? "bg-secondary/40 mr-auto"
                            : "bg-primary/10 text-primary-foreground ml-auto border border-primary/20"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                          <span className="font-bold text-xs uppercase tracking-wide opacity-80">
                            {turn.speaker === "customer" ? activeLead?.name : "Human Sales Agent (You)"}
                          </span>
                          
                          {turn.intent && (
                            <Badge variant="outline" className={`text-[10px] scale-90 ${INTENT_META[turn.intent as Intent]?.tone}`}>
                              {INTENT_META[turn.intent as Intent]?.label}
                            </Badge>
                          )}
                          
                          {turn.sentiment && (
                            <span className="text-[10px] text-muted-foreground">({turn.sentiment})</span>
                          )}

                          {turn.complianceFlag && (
                            <Badge variant="destructive" className="text-[9px] font-bold px-1 py-0 py-0.5">
                              Compliance Hold
                            </Badge>
                          )}
                        </div>

                        <p className="leading-relaxed">{turn.text}</p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>

                {/* SIMULATED SPEECH ACTIONS */}
                <div className="border-t p-3 bg-secondary/15 space-y-3 shrink-0">
                  {/* Click to simulate buttons */}
                  {activeLead && LEAD_MOCK_PROMPTS[activeLead.id] && (
                    <div className="flex gap-2 flex-wrap items-center">
                      <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
                        <Sparkles className="h-3 w-3 text-primary" /> Simulate Customer:
                      </span>
                      {LEAD_MOCK_PROMPTS[activeLead.id].map((prompt, pIdx) => (
                        <Button
                          key={pIdx}
                          variant="outline"
                          size="sm"
                          onClick={() => handleCustomerUtterance(prompt.text)}
                          disabled={processTurnMutation.isPending}
                          className="text-xs px-2.5 py-1 h-7 border-primary/30 text-foreground hover:bg-primary/10"
                        >
                          {prompt.label}
                        </Button>
                      ))}
                    </div>
                  )}

                  {/* Manual Type box */}
                  <div className="flex gap-2 items-center">
                    <Textarea
                      placeholder="Or type what the customer says manually..."
                      value={customUtterance}
                      onChange={(e) => setCustomUtterance(e.target.value)}
                      className="min-h-10 max-h-12 resize-none text-xs flex-1"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleCustomerUtterance(customUtterance);
                        }
                      }}
                    />
                    <Button
                      onClick={() => handleCustomerUtterance(customUtterance)}
                      disabled={!customUtterance.trim() || processTurnMutation.isPending}
                      className="h-10"
                    >
                      {processTurnMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ArrowRight className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* RIGHT COLUMN: AI CO-PILOT ASSISTANT (NBA & RAG) */}
          <div className="space-y-4">
            
            {/* NBA NEXT BEST ACTION SCREEN */}
            <Card className={`border-l-4 transition-all duration-300 ${
              lastCopilotAdvice?.complianceFlag
                ? "border-l-destructive border-destructive/30 bg-destructive/5"
                : "border-l-primary"
            }`}>
              <CardHeader className="py-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Bot className="h-4.5 w-4.5 text-primary" />
                  Co-Pilot Action Suggestions (NBA)
                </CardTitle>
                <CardDescription className="text-xs">
                  Sales suggestion built by the reasoning node (cheap/expensive split).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {lastCopilotAdvice ? (
                  <>
                    {/* Compliance Alert Flag */}
                    {lastCopilotAdvice.complianceFlag && (
                      <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 p-3 flex gap-2.5">
                        <ShieldAlert className="h-5 w-5 text-rose-500 shrink-0 mt-0.5 animate-bounce" />
                        <div>
                          <p className="text-xs font-bold text-rose-400">COMPLIANCE RISK DETECTED</p>
                          <p className="text-[11px] text-rose-300 mt-1 leading-relaxed">
                            This turn involves sensitive financial guarantees or limit modifications. 
                            <strong> Human judgment required</strong>. Do NOT read scripts automatically.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Recommendation Suggestion Panel */}
                    <div className={`p-3 rounded-lg border bg-secondary/35 ${
                      lastCopilotAdvice.complianceFlag ? "border-rose-500/30" : "border-primary/20"
                    }`}>
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold mb-1 flex items-center gap-1">
                        <GraduationCap className="h-3 w-3" /> Coached sales recommendation
                      </p>
                      <p className="text-sm leading-relaxed">{lastCopilotAdvice.nbaSuggestion}</p>
                    </div>

                    <div className="flex gap-2 flex-wrap pt-1">
                      <Button
                        size="sm"
                        variant={lastCopilotAdvice.complianceFlag ? "destructive" : "secondary"}
                        className="text-xs w-full"
                        onClick={() => {
                          if (lastCopilotAdvice.nbaSuggestion) {
                            handleAgentSpeak(lastCopilotAdvice.nbaSuggestion.replace("[human_judgment_required] ", ""));
                          }
                        }}
                      >
                        {lastCopilotAdvice.complianceFlag ? "Use Coached Script Anyway (Force)" : "Insert Suggestion Into Agent Chat"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs w-full text-muted-foreground"
                        onClick={() => {
                          toast.info("SMS Onboarding invite link sent to customer!");
                          handleAgentSpeak("I have just triggered the SMS link to your registered mobile number.");
                        }}
                      >
                        SMS Onboarding Link
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="py-12 text-center text-xs text-muted-foreground italic">
                    Waiting for customer transcript turns to initiate AI sales assistance...
                  </div>
                )}
              </CardContent>
            </Card>

            {/* RAG GROUNDED FACT RETRIEVAL */}
            <Card>
              <CardHeader className="py-3 border-b">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Search className="h-4.5 w-4.5 text-primary" />
                  Grounded Knowledge Base Facts
                </CardTitle>
              </CardHeader>
              <CardContent className="py-4 space-y-4">
                {lastCopilotAdvice?.answer ? (
                  <>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Verified Truth Statement</p>
                      <p className="text-xs leading-relaxed bg-secondary/15 p-2 rounded border">
                        {lastCopilotAdvice.answer}
                      </p>
                    </div>

                    {lastCopilotAdvice.sources && lastCopilotAdvice.sources.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wide">
                          Retrieved Source Documents (Zero Hallucination Guard)
                        </p>
                        <div className="flex flex-col gap-1.5">
                          {lastCopilotAdvice.sources.map((s: any, idx: number) => (
                            <div key={idx} className="flex items-center justify-between text-[11px] bg-secondary/20 p-2 rounded border border-border">
                              <span className="font-semibold text-foreground truncate max-w-[140px]">
                                {s.source_file} (v{s.version})
                              </span>
                              <span className="text-muted-foreground text-[10px]">
                                Sec: {s.section.slice(0, 16)}...
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="py-12 text-center text-xs text-muted-foreground italic">
                    Grounded vector documents will appear here when questions are asked.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

        </div>
      )}
    </div>
  );
}
