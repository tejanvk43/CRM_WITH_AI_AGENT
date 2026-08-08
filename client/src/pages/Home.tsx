import React, { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  PhoneCall,
  MessageSquare,
  Sparkles,
  ShieldCheck,
  CreditCard,
  CheckCircle2,
  Clock,
  ArrowRight,
  Send,
  Bot,
  User,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  X,
  Phone,
  Zap,
  HelpCircle,
  Lock,
  Percent,
  Check
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

export default function Home() {
  // Callback Modal State
  const [showCallbackModal, setShowCallbackModal] = useState(false);
  const [callbackName, setCallbackName] = useState("");
  const [callbackPhone, setCallbackPhone] = useState("+918919998149");
  const [callbackAmount, setCallbackAmount] = useState(50000);
  const [isCalling, setIsCalling] = useState(false);
  const [callSuccess, setCallSuccess] = useState(false);

  // EMI Calculator State
  const [creditAmount, setCreditAmount] = useState(45000);

  // Floating AI Chatbot State
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ sender: "user" | "bot"; text: string; time: string }>>([
    {
      sender: "bot",
      text: "👋 Hi there! I'm your FlexiPay Assistant. Ask me anything about our 0% interest credit line, digital KYC, or loan limits. How can I help you today?",
      time: "Just now"
    }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatLanguage, setChatLanguage] = useState<"en-IN" | "te-IN">("en-IN");
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Mutations
  const createLeadMutation = trpc.copilot.createLead.useMutation();
  const startCallMutation = trpc.copilot.startCall.useMutation();
  const utils = trpc.useUtils();

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, isChatOpen]);

  // Handle Instant Phone Callback Request
  const handleRequestCallback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!callbackPhone.trim()) {
      toast.error("Please enter your mobile phone number.");
      return;
    }

    setIsCalling(true);
    try {
      // 1. Create lead record in Supabase CRM
      const leadName = callbackName.trim() || `Customer (${callbackPhone})`;
      await createLeadMutation.mutateAsync({
        name: leadName,
        phone: callbackPhone.trim(),
        creditScore: 750,
        notes: `Requested instant callback from website homepage for ₹${callbackAmount.toLocaleString('en-IN')}.`,
      });

      const updatedLeads = await utils.copilot.getLeads.fetch();
      const lead = updatedLeads.find((l: any) => l.phone.includes(callbackPhone.trim().slice(-10))) || updatedLeads[0];

      // 2. Dispatch Live Twilio Call to user's phone
      const res = await fetch("http://localhost:8000/twilio/call/outbound", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: callbackPhone.trim(),
          lead_id: lead ? lead.id : 1,
        })
      });

      const data = await res.json();
      if (data.success || data.call_sid) {
        setCallSuccess(true);
        toast.success(`📞 Calling your phone (${callbackPhone}) right now! Please pick up.`);
      } else {
        toast.success(`📞 Callback registered for ${callbackPhone}! Our representative will call you.`);
        setCallSuccess(true);
      }
    } catch (err) {
      toast.error("Failed to initiate callback call. Please try again.");
    } finally {
      setIsCalling(false);
    }
  };

  // Handle AI Chat Message
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || isChatLoading) return;

    const userText = chatInput.trim();
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    setChatMessages((prev) => [...prev, { sender: "user", text: userText, time: timeStr }]);
    setChatInput("");
    setIsChatLoading(true);

    try {
      const response = await fetch("http://localhost:8000/call/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          call_id: 1,
          transcript_text: chatLanguage === "te-IN"
            ? `[Customer speaking in Telugu] ${userText}`
            : userText,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const botReply = data.suggestion || data.retrieved_facts?.[0] || (
          chatLanguage === "te-IN"
            ? "FlexiPay 3 నెలల్లో 0% వడ్డీతో ₹75,000 వరకు క్రెడిట్ లైన్ అందిస్తుంది!"
            : "FlexiPay offers 0% interest credit lines up to ₹75,000 with 3 easy monthly installments."
        );
        setChatMessages((prev) => [...prev, { sender: "bot", text: botReply, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
      } else {
        throw new Error("FastAPI returned error");
      }
    } catch (err) {
      // Local Grounded Knowledge Fallback — bilingual
      const lower = userText.toLowerCase();
      let fallback: string;
      if (chatLanguage === "te-IN") {
        if (lower.includes("kyc") || lower.includes("document") || lower.includes("aadhaar") || lower.includes("ఆధార్")) {
          fallback = "మా KYC పూర్తిగా డిజిటల్! మీ ఆధార్ నంబర్ మరియు PAN కార్డ్ మాత్రమే అవసరం. 2 నిమిషాల్లో అప్రూవల్ పొందండి.";
        } else if (lower.includes("interest") || lower.includes("వడ్డీ") || lower.includes("fee") || lower.includes("రుసుము")) {
          fallback = "FlexiPay 3 నెలల్లో సమాన వాయిదాల్లో చెల్లించినప్పుడు 0% వడ్డీ మాత్రమే! దాచిన చార్జీలు లేవు.";
        } else if (lower.includes("limit") || lower.includes("మొత్తం") || lower.includes("amount")) {
          fallback = "మీ CIBIL స్కోర్ మరియు ఆదాయం ఆధారంగా ₹3,000 నుండి ₹75,000 వరకు క్రెడిట్ లైన్ అందుబాటులో ఉంటుంది.";
        } else if (lower.includes("call") || lower.includes("ఫోన్") || lower.includes("speak")) {
          fallback = "ఇప్పుడే ఫోన్ కాల్ అభ్యర్థించండి! పైన 'Request Instant Callback' బటన్ నొక్కండి.";
        } else {
          fallback = "FlexiPay ₹3,000 నుండి ₹75,000 వరకు 0% వడ్డీతో క్రెడిట్ లైన్ అందిస్తుంది. దాచిన చార్జీలు లేవు!";
        }
      } else {
        if (lower.includes("kyc") || lower.includes("document") || lower.includes("aadhaar") || lower.includes("pan")) {
          fallback = "Our KYC is 100% paperless! You only need your Aadhaar number for instant OTP verification and your PAN card. Approvals happen in under 2 minutes.";
        } else if (lower.includes("interest") || lower.includes("rate") || lower.includes("fee") || lower.includes("cost")) {
          fallback = "FlexiPay has 0% interest when repaid over 3 equal monthly installments. There are zero foreclosure fees and zero hidden charges!";
        } else if (lower.includes("limit") || lower.includes("amount") || lower.includes("max")) {
          fallback = "Approved credit lines range from ₹3,000 up to ₹75,000 depending on your CIBIL score (650+) and monthly income.";
        } else if (lower.includes("call") || lower.includes("speak") || lower.includes("human") || lower.includes("representative")) {
          fallback = "You can request an instant phone call right now! Click the 'Request Instant Callback' button above or leave your number here.";
        } else {
          fallback = "FlexiPay offers ₹3,000 to ₹75,000 credit lines with 0% interest for 3 months. No hidden charges!";
        }
      }
      setChatMessages((prev) => [...prev, { sender: "bot", text: fallback, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const monthlyInstallment = Math.round(creditAmount / 3);

  return (
    <div className="min-h-screen bg-[#fcfdfd] text-slate-900 font-sans antialiased selection:bg-indigo-500 selection:text-white">
      {/* ── HEADER NAVIGATION ── */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-slate-200/80">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 bg-slate-950 text-white rounded-xl flex items-center justify-center font-bold text-sm shadow-sm">
              FP
            </div>
            <div>
              <span className="font-extrabold text-lg tracking-tight text-slate-950">FlexiPay</span>
              <span className="text-[10px] uppercase font-bold text-emerald-700 bg-emerald-100/70 border border-emerald-300/80 px-2 py-0.5 rounded-full ml-2">
                0% Interest
              </span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-7 text-xs font-medium text-slate-600">
            <a href="#features" className="hover:text-slate-900 transition-colors">Features</a>
            <a href="#calculator" className="hover:text-slate-900 transition-colors">EMI Calculator</a>
            <a href="#how-it-works" className="hover:text-slate-900 transition-colors">How It Works</a>
            <a href="/twilio/kyc/onboarding" target="_blank" rel="noreferrer" className="hover:text-slate-900 transition-colors flex items-center gap-1">
              KYC Portal <ExternalLink className="h-3 w-3 text-slate-400" />
            </a>
            <Link href="/crm" className="hover:text-slate-900 transition-colors font-semibold text-indigo-700">
              Enterprise CRM &rarr;
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <Button
              size="sm"
              onClick={() => { setShowCallbackModal(true); setCallSuccess(false); }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-9 px-4 font-semibold gap-1.5 shadow-sm rounded-lg"
            >
              <PhoneCall className="h-3.5 w-3.5" />
              Request Callback
            </Button>
          </div>
        </div>
      </header>

      {/* ── HERO SECTION ── */}
      <section className="relative overflow-hidden pt-16 pb-20 md:pt-24 md:pb-28 border-b border-slate-200/80 bg-gradient-to-b from-white via-slate-50/50 to-slate-100/30">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            {/* Left Content */}
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-xs font-medium text-slate-700 shadow-2xs">
                <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                <span>Instant Digital Sanction up to <strong>₹75,000</strong></span>
              </div>

              <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-slate-950 tracking-tight leading-[1.12]">
                Buy Now, Pay in 3. <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-700 to-indigo-700">
                  Zero Interest. Zero Fees.
                </span>
              </h1>

              <p className="text-base text-slate-600 max-w-xl leading-relaxed">
                Empower your purchases with FlexiPay's flexible pay-in-3 credit line. Complete your 100% paperless Aadhaar &amp; PAN KYC in under 2 minutes, with live sales human assistance.
              </p>

              <div className="flex flex-wrap gap-3 pt-2">
                <Button
                  size="lg"
                  onClick={() => { setShowCallbackModal(true); setCallSuccess(false); }}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold h-11 px-6 text-sm gap-2 shadow-sm rounded-xl"
                >
                  <PhoneCall className="h-4 w-4" />
                  Call Me Now (Instant Phone Call)
                </Button>

                <a
                  href="/twilio/kyc/onboarding"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center bg-slate-900 hover:bg-slate-800 text-white font-semibold h-11 px-6 text-sm gap-2 rounded-xl transition-all shadow-sm"
                >
                  <CreditCard className="h-4 w-4" />
                  Apply Digital KYC
                </a>

                <Link
                  href="/crm"
                  className="inline-flex items-center justify-center bg-white hover:bg-slate-50 text-slate-800 font-semibold h-11 px-5 text-sm gap-1.5 border border-slate-300 rounded-xl transition-all"
                >
                  Enterprise CRM
                  <ArrowRight className="h-4 w-4 text-slate-500" />
                </Link>
              </div>

              {/* Trust Badges */}
              <div className="flex items-center gap-6 pt-4 text-xs font-medium text-slate-500 flex-wrap">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" /> 0% APR (No Hidden Charges)
                </span>
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-indigo-600" /> RBI Regulated NBFC Partner
                </span>
                <span className="flex items-center gap-1.5">
                  <Zap className="h-4 w-4 text-amber-500" /> 2-Min Instant Sanction
                </span>
              </div>
            </div>

            {/* Right Card / Interactive Preview */}
            <div className="lg:col-span-5">
              <Card className="border-slate-300 bg-white shadow-xl rounded-2xl overflow-hidden">
                <div className="bg-slate-950 p-5 text-white flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Digital Credit Line</span>
                    <h3 className="text-xl font-bold text-white mt-0.5">FlexiPay Cardless Credit</h3>
                  </div>
                  <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-xs px-2.5 py-0.5">
                    Pre-Approved
                  </Badge>
                </div>
                <CardContent className="p-6 space-y-5">
                  <div className="flex justify-between items-center pb-4 border-b border-slate-100">
                    <span className="text-xs text-slate-500">Available Limit</span>
                    <span className="text-2xl font-bold font-mono text-slate-900">₹75,000.00</span>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between text-slate-600">
                      <span>Repayment Tenure</span>
                      <span className="font-semibold text-slate-900">3 Equal Installments</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Interest Rate</span>
                      <span className="font-semibold text-emerald-700">0% Per Annum</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Documentation</span>
                      <span className="font-semibold text-slate-900">100% Paperless OTP KYC</span>
                    </div>
                  </div>

                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                      <Phone className="h-3.5 w-3.5 text-emerald-600" />
                      Live Human Phone Support
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Need clarification? Our sales representatives and AI Copilots are available 24/7 to connect directly with your phone.
                    </p>
                  </div>

                  <Button
                    onClick={() => { setShowCallbackModal(true); setCallSuccess(false); }}
                    className="w-full bg-slate-950 hover:bg-slate-900 text-white font-semibold text-xs h-10 rounded-xl"
                  >
                    Request Instant Human Phone Call
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* ── EMI CALCULATOR SECTION ── */}
      <section id="calculator" className="py-20 max-w-7xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto space-y-3 mb-12">
          <Badge className="bg-indigo-50 text-indigo-700 border-indigo-200 text-xs px-3 py-0.5">
            Transparent Pricing
          </Badge>
          <h2 className="text-3xl font-extrabold text-slate-950 tracking-tight">
            Calculate Your 0% Pay-in-3 Installments
          </h2>
          <p className="text-xs text-slate-500">
            See your exact 3-month payment schedule. No hidden processing charges, zero interest.
          </p>
        </div>

        <div className="max-w-3xl mx-auto bg-white border border-slate-200/90 rounded-2xl p-8 shadow-sm">
          <div className="space-y-6">
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-600">Purchase / Credit Amount</label>
                <span className="text-2xl font-bold font-mono text-indigo-600">₹{creditAmount.toLocaleString('en-IN')}</span>
              </div>
              <input
                type="range"
                min="3000"
                max="75000"
                step="1000"
                value={creditAmount}
                onChange={(e) => setCreditAmount(parseInt(e.target.value))}
                className="w-full accent-indigo-600 cursor-pointer h-2 bg-slate-100 rounded-lg"
              />
              <div className="flex justify-between text-[11px] text-slate-400 mt-1">
                <span>₹3,000 (Min)</span>
                <span>₹45,000</span>
                <span>₹75,000 (Max)</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-slate-100">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-center">
                <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Today (Month 1)</span>
                <span className="text-xl font-bold font-mono text-slate-900">₹{monthlyInstallment.toLocaleString('en-IN')}</span>
                <span className="text-[10px] text-emerald-600 font-medium block mt-1">0% Interest</span>
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-center">
                <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">In 30 Days (Month 2)</span>
                <span className="text-xl font-bold font-mono text-slate-900">₹{monthlyInstallment.toLocaleString('en-IN')}</span>
                <span className="text-[10px] text-emerald-600 font-medium block mt-1">0% Interest</span>
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-center">
                <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">In 60 Days (Month 3)</span>
                <span className="text-xl font-bold font-mono text-slate-900">₹{monthlyInstallment.toLocaleString('en-IN')}</span>
                <span className="text-[10px] text-emerald-600 font-medium block mt-1">0% Interest</span>
              </div>
            </div>

            <div className="flex justify-between items-center pt-4 border-t border-slate-100 flex-wrap gap-3">
              <div className="text-xs text-slate-600">
                Total Repayment: <strong className="text-slate-900 font-mono">₹{creditAmount.toLocaleString('en-IN')}</strong> (Extra Cost: <strong className="text-emerald-600">₹0</strong>)
              </div>
              <Button
                onClick={() => { setShowCallbackModal(true); setCallbackAmount(creditAmount); setCallSuccess(false); }}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-9 px-5 font-semibold rounded-lg shadow-sm"
              >
                Apply for ₹{creditAmount.toLocaleString('en-IN')} Now
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURES GRID ── */}
      <section id="features" className="py-20 bg-slate-50/70 border-y border-slate-200/80">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto space-y-3 mb-14">
            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs px-3 py-0.5">
              Why FlexiPay?
            </Badge>
            <h2 className="text-3xl font-extrabold text-slate-950 tracking-tight">
              Fintech Intelligence Built for Consumers
            </h2>
            <p className="text-xs text-slate-500">
              Zero paperwork, instant Aadhaar verification, and personalized credit underwriting.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="border-slate-200 bg-white shadow-2xs hover:shadow-md transition-all p-6 rounded-2xl space-y-3">
              <div className="h-10 w-10 bg-emerald-100 text-emerald-700 rounded-xl flex items-center justify-center">
                <Percent className="h-5 w-5" />
              </div>
              <h3 className="text-base font-bold text-slate-900">0% Interest Pay-in-3</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Split any purchase into 3 equal monthly installments with zero interest and zero foreclosure penalties.
              </p>
            </Card>

            <Card className="border-slate-200 bg-white shadow-2xs hover:shadow-md transition-all p-6 rounded-2xl space-y-3">
              <div className="h-10 w-10 bg-blue-100 text-blue-700 rounded-xl flex items-center justify-center">
                <CreditCard className="h-5 w-5" />
              </div>
              <h3 className="text-base font-bold text-slate-900">Instant Paperless KYC</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Verify your Aadhaar via instant UIDAI OTP and PAN details. Real-time approval in under 2 minutes.
              </p>
            </Card>

            <Card className="border-slate-200 bg-white shadow-2xs hover:shadow-md transition-all p-6 rounded-2xl space-y-3">
              <div className="h-10 w-10 bg-purple-100 text-purple-700 rounded-xl flex items-center justify-center">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <h3 className="text-base font-bold text-slate-900">RBI Regulated Security</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                All credit facilities are backed by RBI-regulated NBFC partners with 256-bit bank-grade encryption.
              </p>
            </Card>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" className="py-20 max-w-7xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto space-y-3 mb-14">
          <Badge className="bg-slate-100 text-slate-700 border-slate-200 text-xs px-3 py-0.5">
            Simple 3-Step Process
          </Badge>
          <h2 className="text-3xl font-extrabold text-slate-950 tracking-tight">
            How FlexiPay Works
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="space-y-3 text-center">
            <div className="h-12 w-12 bg-slate-950 text-white rounded-full flex items-center justify-center mx-auto text-base font-bold">
              1
            </div>
            <h4 className="text-sm font-bold text-slate-900">Request Call or Apply Online</h4>
            <p className="text-xs text-slate-500">
              Submit your phone number or apply directly through our 2-minute digital KYC portal.
            </p>
          </div>

          <div className="space-y-3 text-center">
            <div className="h-12 w-12 bg-slate-950 text-white rounded-full flex items-center justify-center mx-auto text-base font-bold">
              2
            </div>
            <h4 className="text-sm font-bold text-slate-900">Instant Verification &amp; Sanction</h4>
            <p className="text-xs text-slate-500">
              Verify your Aadhaar OTP. Our automated credit engine approves up to ₹75,000 instantly.
            </p>
          </div>

          <div className="space-y-3 text-center">
            <div className="h-12 w-12 bg-slate-950 text-white rounded-full flex items-center justify-center mx-auto text-base font-bold">
              3
            </div>
            <h4 className="text-sm font-bold text-slate-900">Shop &amp; Pay in 3 Months</h4>
            <p className="text-xs text-slate-500">
              Use your credit line at thousands of merchant partners and repay in 3 equal monthly installments.
            </p>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-slate-200 bg-white py-12">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 bg-slate-950 text-white rounded-lg flex items-center justify-center font-bold text-xs">
              FP
            </div>
            <span className="font-bold text-sm text-slate-900">FlexiPay Financial Technologies Pvt. Ltd.</span>
          </div>

          <div className="flex gap-6 text-xs text-slate-500">
            <a href="#features" className="hover:text-slate-900">Features</a>
            <a href="#calculator" className="hover:text-slate-900">EMI Calculator</a>
            <a href="/twilio/kyc/onboarding" target="_blank" rel="noreferrer" className="hover:text-slate-900">Digital KYC</a>
            <Link href="/crm" className="hover:text-slate-900 font-semibold text-indigo-700">Enterprise CRM</Link>
          </div>

          <p className="text-[11px] text-slate-400">
            &copy; 2026 FlexiPay. RBI Registered Lending Platform.
          </p>
        </div>
      </footer>

      {/* ── CALLBACK MODAL ("REQUEST INSTANT PHONE CALL") ── */}
      {showCallbackModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <Card className="w-full max-w-md bg-white border-slate-300 shadow-2xl rounded-2xl overflow-hidden">
            <div className="bg-slate-950 p-5 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-emerald-500 text-white flex items-center justify-center">
                  <PhoneCall className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Request Instant Phone Call</h3>
                  <p className="text-[10px] text-slate-400">Twilio will ring your mobile phone immediately</p>
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setShowCallbackModal(false)} className="text-slate-400 hover:text-white h-7 w-7 p-0">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <CardContent className="p-6">
              {callSuccess ? (
                <div className="text-center py-6 space-y-4">
                  <div className="h-14 w-14 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto animate-bounce">
                    <PhoneCall className="h-7 w-7" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-base font-bold text-slate-900">Calling {callbackPhone} Now!</h4>
                    <p className="text-xs text-slate-600">
                      Your phone will ring in a few seconds. Please answer to speak directly with our FlexiPay credit advisor.
                    </p>
                  </div>
                  <Button
                    onClick={() => setShowCallbackModal(false)}
                    className="bg-slate-900 hover:bg-slate-800 text-white text-xs h-9 px-6 rounded-lg font-semibold"
                  >
                    Done
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleRequestCallback} className="space-y-4">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600 block mb-1">Your Full Name</label>
                    <Input
                      value={callbackName}
                      onChange={(e) => setCallbackName(e.target.value)}
                      placeholder="e.g. Rahul Sharma"
                      className="text-xs h-9 bg-slate-50 border-slate-200"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600 block mb-1">
                      Mobile Phone Number <span className="text-rose-500">*</span>
                    </label>
                    <Input
                      value={callbackPhone}
                      onChange={(e) => setCallbackPhone(e.target.value)}
                      placeholder="+91 89199 98149"
                      className="text-xs h-9 bg-slate-50 border-slate-200 font-mono font-semibold text-slate-900"
                      required
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      Twilio will dial this number directly.
                    </p>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600 block mb-1">Desired Credit Limit</label>
                    <select
                      value={callbackAmount}
                      onChange={(e) => setCallbackAmount(parseInt(e.target.value))}
                      className="w-full h-9 bg-slate-50 border border-slate-200 rounded-md px-3 text-xs text-slate-800 outline-none"
                    >
                      <option value={15000}>₹15,000 (Starter)</option>
                      <option value={30000}>₹30,000 (Standard)</option>
                      <option value={50000}>₹50,000 (Most Popular)</option>
                      <option value={75000}>₹75,000 (Maximum Limit)</option>
                    </select>
                  </div>

                  <Button
                    type="submit"
                    disabled={isCalling}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs h-10 rounded-xl gap-2 shadow-sm"
                  >
                    {isCalling ? <span className="animate-spin mr-1">⏳</span> : <PhoneCall className="h-4 w-4" />}
                    {isCalling ? "Dialing Twilio Outbound..." : "Call My Phone Now"}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── FLOATING AI AGENT CHATBOT WIDGET ── */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
        {/* Expanded Chat Window */}
        {isChatOpen && (
          <Card className="w-80 sm:w-96 bg-white border-slate-300 shadow-2xl rounded-2xl mb-3 overflow-hidden animate-in slide-in-from-bottom-5">
            <div className="bg-slate-950 p-4 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-7 w-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center">
                  <Bot className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                    FlexiPay AI Assistant
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  </h4>
                  <p className="text-[10px] text-slate-400">Bilingual · English &amp; Telugu</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Language Toggle */}
                <button
                  onClick={() => {
                    const next = chatLanguage === "en-IN" ? "te-IN" : "en-IN";
                    setChatLanguage(next);
                    setChatMessages((prev) => [
                      ...prev,
                      {
                        sender: "bot" as const,
                        text: next === "te-IN"
                          ? "నమస్కారం! ఇప్పుడు తెలుగులో మాట్లాడవచ్చు. మీకు ఏమి సహాయం చేయాలి?"
                          : "Switched to English! How can I help you today?",
                        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      }
                    ]);
                  }}
                  className="text-[10px] font-bold px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white transition-colors"
                  title="Toggle language"
                >
                  {chatLanguage === "en-IN" ? "తె Telugu" : "EN English"}
                </button>
                <Button size="sm" variant="ghost" onClick={() => setIsChatOpen(false)} className="text-slate-400 hover:text-white h-6 w-6 p-0">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Chat Messages */}
            <div ref={chatScrollRef} className="h-72 p-4 overflow-y-auto space-y-3 bg-slate-50/50">
              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"}`}
                >
                  <div
                    className={`p-3 rounded-xl text-xs max-w-[85%] leading-relaxed ${
                      msg.sender === "user"
                        ? "bg-slate-950 text-white rounded-br-none"
                        : "bg-white border border-slate-200 text-slate-800 rounded-bl-none shadow-2xs"
                    }`}
                  >
                    {msg.text}
                  </div>
                  <span className="text-[9px] text-slate-400 mt-1 px-1">{msg.time}</span>
                </div>
              ))}
              {isChatLoading && (
                <div className="flex items-center gap-1.5 text-xs text-slate-400 p-2">
                  <span className="animate-bounce">●</span>
                  <span className="animate-bounce delay-100">●</span>
                  <span className="animate-bounce delay-200">●</span>
                </div>
              )}
            </div>

            {/* Chat Quick Action Bar */}
            <div className="px-3 py-2 bg-slate-100 border-t border-slate-200 flex items-center justify-between text-[11px]">
              <span className="text-slate-500">Need immediate help?</span>
              <button
                onClick={() => { setShowCallbackModal(true); setCallSuccess(false); }}
                className="text-emerald-700 font-bold hover:underline flex items-center gap-1"
              >
                <Phone className="h-3 w-3" /> Request Phone Call
              </button>
            </div>

            {/* Chat Input */}
            <form onSubmit={handleSendMessage} className="p-3 bg-white border-t border-slate-200 flex gap-2">
              <Input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={chatLanguage === "te-IN" ? "తెలుగులో అడగండి..." : "Ask about 0% EMI, KYC, limits..."}
                className="text-xs h-9 bg-slate-50 border-slate-200"
              />
              <Button type="submit" size="sm" className="bg-slate-950 hover:bg-slate-800 text-white h-9 px-3">
                <Send className="h-3.5 w-3.5" />
              </Button>
            </form>
          </Card>
        )}

        {/* Floating Bubble Button */}
        <Button
          onClick={() => setIsChatOpen(!isChatOpen)}
          className="h-13 w-13 rounded-full bg-slate-950 hover:bg-slate-900 text-white shadow-xl flex items-center justify-center p-0 gap-0 transition-transform hover:scale-105"
        >
          {isChatOpen ? <X className="h-5 w-5" /> : <MessageSquare className="h-5 w-5" />}
        </Button>
      </div>
    </div>
  );
}
