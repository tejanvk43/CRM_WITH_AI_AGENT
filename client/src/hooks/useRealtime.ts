import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

export interface RealtimeCallTurn {
  id: number;
  callId: number;
  speaker: string;
  text: string;
  intent: string | null;
  sentiment: string | null;
  assistantResponse: string | null;
  costUsd: string;
  createdAt: string;
}

export interface RealtimeLead {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  status: string;
  creditScore: number;
  approvedLimit: number | null;
  notes: string | null;
  lastCallAt: string | null;
  createdAt: string;
}

/**
 * Subscribes to Supabase real-time changes on call_transcripts and leads tables.
 * Returns new transcript turns and lead updates as they arrive in the DB.
 */
export function useRealtimeCall(callId: number | null) {
  const [realtimeTurns, setRealtimeTurns] = useState<RealtimeCallTurn[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!callId) return;

    // Subscribe to new rows in call_transcripts for this callId
    const channel = supabase
      .channel(`call-transcripts-${callId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "call_transcripts",
          filter: `callId=eq.${callId}`,
        },
        (payload) => {
          const newTurn = payload.new as RealtimeCallTurn;
          setRealtimeTurns((prev) => [...prev, newTurn]);
        }
      )
      .subscribe((status) => {
        setIsConnected(status === "SUBSCRIBED");
      });

    return () => {
      supabase.removeChannel(channel);
      setIsConnected(false);
    };
  }, [callId]);

  const clearTurns = useCallback(() => setRealtimeTurns([]), []);

  return { realtimeTurns, isConnected, clearTurns };
}

/**
 * Subscribes to Supabase real-time changes on the leads table.
 * Returns updated leads as they change (status updates, new leads, etc.)
 */
export function useRealtimeLeads(onLeadUpdate: (lead: RealtimeLead) => void) {
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const channel = supabase
      .channel("leads-realtime")
      .on(
        "postgres_changes",
        {
          event: "*", // INSERT, UPDATE, DELETE
          schema: "public",
          table: "leads",
        },
        (payload) => {
          if (payload.new) {
            onLeadUpdate(payload.new as RealtimeLead);
          }
        }
      )
      .subscribe((status) => {
        setIsConnected(status === "SUBSCRIBED");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [onLeadUpdate]);

  return { isConnected };
}
