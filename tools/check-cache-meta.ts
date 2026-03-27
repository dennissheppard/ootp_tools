import { supabaseQuery } from './lib/supabase-client';
async function main() {
  const rows = await supabaseQuery<any>('precomputed_cache', 'select=data&key=eq.batter_projections');
  const d = rows[0]?.data;
  console.log('statsYear:', d?.statsYear, 'usedFallbackStats:', d?.usedFallbackStats);
  const top = (d?.projections ?? []).slice(0, 5).map((p: any) =>
    `${p.name}: WAR=${p.projectedStats.war} PA=${p.projectedStats.pa} wOBA=${p.projectedStats.woba}`
  );
  console.log('Top 5:'); top.forEach((t: string) => console.log(' ', t));
}
main().catch(e => { console.error(e); process.exit(1); });
