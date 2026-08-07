import { createClient } from "@supabase/supabase-js";

// These are the public-facing (anon/publishable) keys — safe to use client-side
const SUPABASE_URL = "https://iimloiqdaaiukizjnmfj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_8v0felFytGMLGEXRnAP4VA_-CUsQe1l";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
