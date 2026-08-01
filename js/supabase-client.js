// Shared Supabase client — loaded on every page after the supabase-js CDN script.
const SUPABASE_URL = 'https://kzvheplmtzjmzcxjkxub.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ohcQ5SUnO_lH_HYGgOtxnQ_umqwx027';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
