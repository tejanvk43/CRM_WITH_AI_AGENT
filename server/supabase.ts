import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://iimloiqdaaiukizjnmfj.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_8v0felFytGMLGEXRnAP4VA_-CUsQe1l";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
