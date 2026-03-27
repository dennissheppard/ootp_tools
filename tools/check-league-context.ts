import { supabaseQuery } from './lib/supabase-client';
async function main() {
  const rows = await supabaseQuery<any>('precomputed_cache', 'select=data&key=eq.league_context');
  const ctx = rows[0]?.data;
  if (!ctx) { console.log('No league_context'); return; }
  console.log('fipConstant:', ctx.fipConstant);
  console.log('League averages by year:');
  for (const [yr, avg] of Object.entries(ctx.leagueAverages ?? {})) {
    const a = avg as any;
    console.log(`  ${yr}: lgWoba=${a.lgWoba} lgObp=${a.lgObp} lgSlg=${a.lgSlg} wobaScale=${a.wobaScale} runsPerWin=${a.runsPerWin}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
