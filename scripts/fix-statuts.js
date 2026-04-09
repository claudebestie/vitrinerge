import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Mark the first 250 leads (by priority/created_at) as email_sent
// since they were sent but not updated
async function fix() {
  const { data, error } = await supabase
    .from('leads_vitrinerge')
    .select('id')
    .eq('statut', 'new')
    .eq('has_email', true)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(250);

  if (error) { console.error(error); return; }
  console.log(`Found ${data.length} leads to fix`);

  const ids = data.map(l => l.id);
  const { error: e2 } = await supabase
    .from('leads_vitrinerge')
    .update({
      statut: 'email_sent',
      contacted_at: new Date().toISOString(),
      batch_date: '2026-04-09',
    })
    .in('id', ids);

  if (e2) console.error('Update error:', e2);
  else console.log(`✅ ${ids.length} leads marqués email_sent`);
}

fix();
