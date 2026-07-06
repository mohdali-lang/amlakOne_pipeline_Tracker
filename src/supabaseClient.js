import { createClient } from "@supabase/supabase-js";

// Values come from .env (see .env.example). Never commit real keys.
const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  console.warn("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — set them in .env");
}

export const supabase = createClient(url, anon);
