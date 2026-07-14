import { createClient } from '@supabase/supabase-js';

// Read the environment variables using Vite's native format
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

console.log("VITE_ENV_DEBUG:", import.meta.env.VITE_SUPABASE_URL);

if (!supabaseUrl || !supabaseAnonKey) {
    console.error("  CRITICAL: Supabase Environment Variables are missing!");
}

export const supabase = createClient(
    supabaseUrl || 'https://MISSING-URL-IN-VERCEL.supabase.co', 
    supabaseAnonKey || 'MISSING-KEY'
);