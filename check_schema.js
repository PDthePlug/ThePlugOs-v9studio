import { createClient } from '@supabase/supabase-js';
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function check() {
  const { data, error } = await supabase.from('businesses').select('*').limit(1);
  if (error) {
    console.error("Error querying businesses:", error.message);
  } else {
    console.log("Businesses table exists.");
    if (data.length > 0) {
      console.log("Sample:", data[0]);
    } else {
      console.log("No data, but table exists. Trying to insert a dummy row and rollback, or just checking if onboarding_status exists.");
    }
  }
}
check();
