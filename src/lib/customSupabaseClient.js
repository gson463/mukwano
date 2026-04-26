import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://jdwgpfyaygirkqyywvvj.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impkd2dwZnlheWdpcmtxeXl3dnZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1OTA5OTQsImV4cCI6MjA3NzE2Njk5NH0.9Gesydov6DMN4Cp44-0MW6s2pRyBSl0xi1XvuUV6a8w';

const customSupabaseClient = createClient(supabaseUrl, supabaseAnonKey);

export default customSupabaseClient;

export { 
    customSupabaseClient,
    customSupabaseClient as supabase,
};
