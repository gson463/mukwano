import { createClient } from '@supabase/supabase-js';

// Using environment variables is safer and standard practice in Vite
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.warn("Supabase credentials missing in environment variables. Auth may fail.");
}

const customSupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
    }
});

export default customSupabaseClient;

export { 
    customSupabaseClient,
    customSupabaseClient as supabase,
};