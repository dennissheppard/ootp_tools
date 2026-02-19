/**
 * Explain Player Tool
 *
 * Uses the real service pipelines and optional trace hooks to explain how a
 * player's rating/projection was produced.
 *
 * Usage examples:
 *   npx tsx tools/explain-player.ts --playerId=1234 --type=pitcher --mode=rating --year=2026
 *   npx tsx tools/explain-player.ts --playerId=1234 --type=pitcher --mode=projection --year=2026
 *   npx tsx tools/explain-player.ts --playerId=5678 --type=hitter --mode=rating --year=2026
 *   npx tsx tools/explain-player.ts --playerId=5678 --type=hitter --mode=all --year=2026 --format=markdown
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

type ExplainMode = 'rating' | 'projection' | 'all';
type PlayerType = 'pitcher' | 'hitter';
type OutputFormat = 'text' | 'json' | 'markdown';

class MemoryStorage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [k, ...rest] = arg.slice(2).split('=');
    out[k] = rest.join('=');
  }
  return out;
}

function toUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

async function setupNodeEnvironment(): Promise<void> {
  const storage = new MemoryStorage();
  (globalThis as any).localStorage = storage;

  const windowStub = {
    localStorage: storage,
    dispatchEvent: () => true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  (globalThis as any).window = windowStub;

  const API_BASE_URL = 'https://atl-01.statsplus.net/world';
  const nativeFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = toUrl(input);

    if (url.startsWith('/api/')) {
      return nativeFetch(`${API_BASE_URL}${url}`, init);
    }

    if (url.startsWith('/data/')) {
      const relPath = url.replace(/^\/+/, '');
      const filePath = path.join(process.cwd(), 'public', relPath);
      try {
        const body = await fs.readFile(filePath);
        return new Response(body, { status: 200 });
      } catch {
        return new Response('Not Found', { status: 404, statusText: 'Not Found' });
      }
    }

    return nativeFetch(input as any, init);
  };
}

async function seedDefaultScouting(year: number): Promise<void> {
  const { scoutingDataService } = await import('../src/services/ScoutingDataService');
  const { hitterScoutingDataService } = await import('../src/services/HitterScoutingDataService');

  const pitcherCsvPath = path.join(process.cwd(), 'public', 'data', 'default_osa_scouting.csv');
  const hitterCsvPath = path.join(process.cwd(), 'public', 'data', 'default_hitter_osa_scouting.csv');

  const ymd = `${year}-12-31`;

  try {
    const pitcherCsv = await fs.readFile(pitcherCsvPath, 'utf8');
    const pitcherRatings = scoutingDataService.parseScoutingCsv(pitcherCsv, 'osa');
    localStorage.setItem(`wbl_scouting_ratings_${ymd}_osa`, JSON.stringify(pitcherRatings));
  } catch {
    // optional seed
  }

  try {
    const hitterCsv = await fs.readFile(hitterCsvPath, 'utf8');
    const hitterRatings = hitterScoutingDataService.parseScoutingCsv(hitterCsv, 'osa');
    localStorage.setItem(`wbl_hitter_scouting_ratings_${ymd}_osa`, JSON.stringify(hitterRatings));
  } catch {
    // optional seed
  }
}

async function disableIndexedDbPersistence(): Promise<void> {
  const { indexedDBService } = await import('../src/services/IndexedDBService');
  const db = indexedDBService as any;

  db.getPlayers = async () => [];
  db.savePlayers = async () => undefined;
  db.getMlbLeagueStats = async () => null;
  db.saveMlbLeagueStats = async () => undefined;
  db.deleteMlbLeagueStats = async () => undefined;
  db.getAllScoutingKeys = async () => [];
  db.getScoutingRatings = async () => null;
  db.getAllHitterScoutingKeys = async () => [];
  db.getHitterScoutingRatings = async () => null;
}

async function resolvePlayerType(playerId: number, explicitType?: string): Promise<PlayerType> {
  if (explicitType === 'pitcher' || explicitType === 'hitter') return explicitType;

  const { playerService } = await import('../src/services/PlayerService');
  const players = await playerService.getAllPlayers();
  const player = players.find((p) => p.id === playerId);
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }
  return player.position === 1 ? 'pitcher' : 'hitter';
}

async function explainPitcherRating(playerId: number, year: number): Promise<any> {
  const { trueRatingsService } = await import('../src/services/TrueRatingsService');
  const { trueRatingsCalculationService, getYearWeights } = await import('../src/services/TrueRatingsCalculationService');
  const { scoutingDataFallbackService } = await import('../src/services/ScoutingDataFallbackService');
  const { playerService } = await import('../src/services/PlayerService');
  const { determinePitcherRole } = await import('../src/models/Player');
  const { dateService } = await import('../src/services/DateService');

  const currentYear = await dateService.getCurrentYear();
  const yearWeights = year === currentYear
    ? getYearWeights(await dateService.getSeasonProgress())
    : undefined;

  const [multiYearStats, leagueAverages, scoutingFallback, allPlayers, allPitchers, canonicalMap] = await Promise.all([
    trueRatingsService.getMultiYearPitchingStats(year),
    trueRatingsService.getLeagueAverages(year),
    scoutingDataFallbackService.getScoutingRatingsWithFallback(year),
    playerService.getAllPlayers(),
    trueRatingsService.getTruePitchingStats(year),
    trueRatingsService.getPitcherTrueRatings(year),
  ]);

  const yearlyStats = multiYearStats.get(playerId);
  if (!yearlyStats || yearlyStats.length === 0) {
    throw new Error(`No multi-year pitching stats found for player ${playerId} in ${year}`);
  }

  const scouting = scoutingFallback.ratings.find((r) => r.playerId === playerId);
  const player = allPlayers.find((p) => p.id === playerId);
  const yearStat = allPitchers.find((p) => p.player_id === playerId);
  const role = determinePitcherRole({
    pitchRatings: scouting?.pitches,
    stamina: scouting?.stamina,
    ootpRole: player?.role,
    gamesStarted: yearStat?.gs,
    inningsPitched: yearStat ? trueRatingsService.parseIp(yearStat.ip) : undefined,
  });
  const name = yearStat?.playerName ?? (player ? `${player.firstName} ${player.lastName}` : `Player ${playerId}`);

  const trace: import('../src/services/TrueRatingsCalculationService').PitcherTrueRatingTrace = {};
  const single = trueRatingsCalculationService.calculateSinglePitcher({
    playerId,
    playerName: name,
    yearlyStats,
    scoutingRatings: scouting,
    role,
  }, yearWeights, trace);

  const canonical = canonicalMap.get(playerId);

  return {
    playerId,
    playerName: name,
    type: 'pitcher',
    mode: 'rating',
    year,
    poolSize: canonicalMap.size,
    leagueAverages,
    scoutingSource: scouting?.source ?? null,
    scoutingInput: scouting
      ? {
          stuff: scouting.stuff,
          control: scouting.control,
          hra: scouting.hra,
          stamina: scouting.stamina ?? null,
          ovr: scouting.ovr ?? null,
          pot: scouting.pot ?? null,
          injuryProneness: scouting.injuryProneness ?? null,
          usablePitches: scouting.pitches
            ? Object.entries(scouting.pitches)
                .filter(([, v]) => (v ?? 0) >= 25)
                .map(([k]) => k)
            : [],
        }
      : null,
    canonicalResult: canonical ?? null,
    singlePlayerResult: single,
    trace,
  };
}

async function explainHitterRating(playerId: number, year: number): Promise<any> {
  const { trueRatingsService } = await import('../src/services/TrueRatingsService');
  const { hitterTrueRatingsCalculationService, getYearWeights } = await import('../src/services/HitterTrueRatingsCalculationService');
  const { hitterScoutingDataService } = await import('../src/services/HitterScoutingDataService');
  const { playerService } = await import('../src/services/PlayerService');
  const { dateService } = await import('../src/services/DateService');

  const currentYear = await dateService.getCurrentYear();
  const yearWeights = year === currentYear
    ? getYearWeights(await dateService.getSeasonProgress())
    : undefined;

  const [multiYearStats, myScouting, osaScouting, allBatters, allPlayers, canonicalMap] = await Promise.all([
    trueRatingsService.getMultiYearBattingStats(year),
    hitterScoutingDataService.getLatestScoutingRatings('my'),
    hitterScoutingDataService.getLatestScoutingRatings('osa'),
    trueRatingsService.getTrueBattingStats(year),
    playerService.getAllPlayers(),
    trueRatingsService.getHitterTrueRatings(year),
  ]);

  const yearlyStats = multiYearStats.get(playerId);
  if (!yearlyStats || yearlyStats.length === 0) {
    throw new Error(`No multi-year batting stats found for player ${playerId} in ${year}`);
  }

  const scoutingById = new Map<number, any>();
  for (const r of osaScouting) scoutingById.set(r.playerId, r);
  for (const r of myScouting) scoutingById.set(r.playerId, r);
  const scouting = scoutingById.get(playerId);

  const yearStat = allBatters.find((b) => b.player_id === playerId);
  const player = allPlayers.find((p) => p.id === playerId);
  const name = yearStat?.playerName ?? (player ? `${player.firstName} ${player.lastName}` : `Player ${playerId}`);

  const trace: import('../src/services/HitterTrueRatingsCalculationService').HitterTrueRatingTrace = {};
  const single = hitterTrueRatingsCalculationService.calculateSingleHitter({
    playerId,
    playerName: name,
    yearlyStats,
    scoutingRatings: scouting,
  }, hitterTrueRatingsCalculationService.getDefaultLeagueAverages(), yearWeights, trace);

  const canonical = canonicalMap.get(playerId);

  return {
    playerId,
    playerName: name,
    type: 'hitter',
    mode: 'rating',
    year,
    poolSize: canonicalMap.size,
    scoutingSource: scouting?.source ?? null,
    scoutingInput: scouting
      ? {
          power: scouting.power,
          eye: scouting.eye,
          avoidK: scouting.avoidK,
          contact: scouting.contact,
          gap: scouting.gap,
          speed: scouting.speed,
          stealingAggressiveness: scouting.stealingAggressiveness ?? null,
          stealingAbility: scouting.stealingAbility ?? null,
          ovr: scouting.ovr ?? null,
          pot: scouting.pot ?? null,
          injuryProneness: scouting.injuryProneness ?? null,
        }
      : null,
    canonicalResult: canonical ?? null,
    singlePlayerResult: single,
    trace,
  };
}

async function explainPitcherProjection(playerId: number, year: number): Promise<any> {
  const { projectionService } = await import('../src/services/ProjectionService');
  const { trueRatingsService } = await import('../src/services/TrueRatingsService');
  const { scoutingDataFallbackService } = await import('../src/services/ScoutingDataFallbackService');
  const { playerService } = await import('../src/services/PlayerService');
  const { leagueStatsService } = await import('../src/services/LeagueStatsService');

  const [pitcherTRMap, scoutingFallback, allPlayers, yearlyStatsMap, yearPitchingStats] = await Promise.all([
    trueRatingsService.getPitcherTrueRatings(year),
    scoutingDataFallbackService.getScoutingRatingsWithFallback(year),
    playerService.getAllPlayers(),
    trueRatingsService.getMultiYearPitchingStats(year, 4),
    trueRatingsService.getTruePitchingStats(year),
  ]);

  const tr = pitcherTRMap.get(playerId);
  if (!tr) {
    throw new Error(`No pitcher TR found for player ${playerId} in ${year}`);
  }

  const player = allPlayers.find((p) => p.id === playerId);
  const scouting = scoutingFallback.ratings.find((r) => r.playerId === playerId);
  const currentYearStat = yearPitchingStats.find((s) => s.player_id === playerId);
  const historicalStats = yearlyStatsMap.get(playerId) ?? [];

  let leagueContext = { fipConstant: 3.47, avgFip: 4.2, runsPerWin: 8.5 };
  try {
    const lg = await leagueStatsService.getLeagueStats(year);
    leagueContext = { fipConstant: lg.fipConstant, avgFip: lg.avgFip, runsPerWin: 8.5 };
  } catch {
    // use defaults
  }

  const trace: import('../src/services/ProjectionService').ProjectionCalculationTrace = {};
  const projection = await projectionService.calculateProjection(
    { stuff: tr.estimatedStuff, control: tr.estimatedControl, hra: tr.estimatedHra },
    player?.age ?? 27,
    scouting?.pitches ? Object.values(scouting.pitches).filter((r) => r >= 25).length : 0,
    currentYearStat?.gs ?? 0,
    leagueContext,
    scouting?.stamina,
    scouting?.injuryProneness,
    historicalStats.length > 0 ? historicalStats : undefined,
    tr.trueRating,
    scouting?.pitches,
    trace
  );

  return {
    playerId,
    playerName: tr.playerName,
    type: 'pitcher',
    mode: 'projection',
    year,
    canonicalTrueRating: tr,
    scoutingInput: scouting
      ? {
          stuff: scouting.stuff,
          control: scouting.control,
          hra: scouting.hra,
          stamina: scouting.stamina ?? null,
          ovr: scouting.ovr ?? null,
          pot: scouting.pot ?? null,
          injuryProneness: scouting.injuryProneness ?? null,
          usablePitches: scouting.pitches
            ? Object.entries(scouting.pitches)
                .filter(([, v]) => (v ?? 0) >= 25)
                .map(([k]) => k)
            : [],
        }
      : null,
    projection,
    trace,
  };
}

async function explainHitterProjection(playerId: number, year: number): Promise<any> {
  const { batterProjectionService } = await import('../src/services/BatterProjectionService');
  const traced = await batterProjectionService.getProjectionWithTrace(year, playerId);
  if (!traced) {
    throw new Error(`No hitter projection found for player ${playerId} in ${year}`);
  }

  return {
    playerId,
    playerName: traced.projection.name,
    type: 'hitter',
    mode: 'projection',
    year,
    statsYearUsed: traced.statsYear,
    usedFallbackStats: traced.usedFallbackStats,
    projectionPoolSize: traced.projectionPoolSize,
    projection: traced.projection,
    trace: traced.trace,
  };
}

function n(value: unknown, digits: number = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return value.toFixed(digits);
}

function signedDelta(after: unknown, before: unknown, digits: number = 1): string {
  if (typeof after !== 'number' || typeof before !== 'number') return 'n/a';
  const d = after - before;
  const sign = d >= 0 ? '+' : '';
  return `${sign}${d.toFixed(digits)}`;
}

function formatYearWeights(traceInput: any): string {
  const years = (traceInput?.yearlyStats ?? []).map((s: any) => s.year);
  const weights = traceInput?.yearWeights ?? [];
  if (!years.length || !weights.length) return 'n/a';
  return years.map((y: number, i: number) => `${y}:${n(weights[i] ?? 0, 2)}`).join(', ');
}

function canonicalRatingBinsText(): string {
  return '97.7->5.0, 93.3->4.5, 84.1->4.0, 69.1->3.5, 50.0->3.0, 30.9->2.5, 15.9->2.0, 6.7->1.5, 2.3->1.0, else 0.5';
}

function renderPitcherRatingExplanation(output: any): string {
  const t = output.trace ?? {};
  const canonical = output.canonicalResult;
  const lines: string[] = [];

  lines.push(`Pitcher Rating Explanation: ${output.playerName} (${output.playerId}), ${output.year}`);
  lines.push(`Step 1. Source data`);
  lines.push(`- Component ratings here are NOT raw scouting. They are inferred from blended MLB rates after multi-year weighting + regression + optional scouting anchor.`);
  lines.push(`- Stats years used: ${(t.input?.yearlyStats ?? []).map((s: any) => s.year).join(', ') || 'n/a'}`);
  lines.push(`- Year weights (most recent first): ${formatYearWeights(t.input)}`);
  lines.push(`- Scouting included: ${t.input?.hasScouting ? 'yes' : 'no'}${output.scoutingSource ? ` (source=${output.scoutingSource})` : ''}`);
  if (output.scoutingInput) {
    lines.push(`- Raw scouting input (20-80): stuff/control/hra=${n(output.scoutingInput.stuff, 1)} / ${n(output.scoutingInput.control, 1)} / ${n(output.scoutingInput.hra, 1)}; stamina=${n(output.scoutingInput.stamina, 0)}, OVR/POT=${n(output.scoutingInput.ovr, 1)}/${n(output.scoutingInput.pot, 1)}, injury=${output.scoutingInput.injuryProneness ?? 'n/a'}`);
    lines.push(`- Usable pitches (>=25): ${(output.scoutingInput.usablePitches ?? []).join(', ') || 'none'}`);
  }

  lines.push(`Step 2. Multi-year weighting`);
  lines.push(`- Weighted rates are IP-weighted across years, then fed into regression.`);
  lines.push(`- Weighted K/9=${n(t.weightedRates?.k9)}, BB/9=${n(t.weightedRates?.bb9)}, HR/9=${n(t.weightedRates?.hr9)}, total IP=${n(t.weightedRates?.totalIp, 1)}`);

  lines.push(`Step 3. Role + tier regression`);
  lines.push(`- Role tier=${t.tierContext?.role ?? 'n/a'}; percentile ranking is later done WITHIN role tier (SP/SW/RP).`);
  lines.push(`- Tier league targets: K/9=${n(t.tierContext?.leagueAverages?.avgK9)}, BB/9=${n(t.tierContext?.leagueAverages?.avgBb9)}, HR/9=${n(t.tierContext?.leagueAverages?.avgHr9)}`);
  lines.push(`- K/9: weighted ${n(t.regression?.k9?.weightedRate)} -> target ${n(t.regression?.k9?.regressionTarget)} with adjustedK ${n(t.regression?.k9?.adjustedKAfterIpScale)} -> regressed ${n(t.regression?.k9?.regressedRate)}`);
  lines.push(`- BB/9: weighted ${n(t.regression?.bb9?.weightedRate)} -> target ${n(t.regression?.bb9?.regressionTarget)} with adjustedK ${n(t.regression?.bb9?.adjustedKAfterIpScale)} -> regressed ${n(t.regression?.bb9?.regressedRate)}`);
  lines.push(`- HR/9: weighted ${n(t.regression?.hr9?.weightedRate)} -> target ${n(t.regression?.hr9?.regressionTarget)} with adjustedK ${n(t.regression?.hr9?.adjustedKAfterIpScale)} -> regressed ${n(t.regression?.hr9?.regressedRate)}`);

  lines.push(`Step 4. Scouting blend`);
  if (t.scoutingBlend) {
    lines.push(`- Effective dev ratio=${n(t.scoutingBlend.effectiveDevRatio, 3)} controls how far scouting target can pull from league average.`);
    lines.push(`- Blend weight: base=${n(t.scoutingBlend.weights?.baseScoutWeight, 3)}, boost=${n(t.scoutingBlend.weights?.scoutBoost, 3)}, final scoutWeight=${n(t.scoutingBlend.weights?.scoutWeight, 3)} (confidence IP=${n(t.scoutingBlend.weights?.confidenceIp, 0)})`);
    lines.push(`- Scout expected K/9=${n(t.scoutingBlend.scoutingExpectedRates?.k9)}, BB/9=${n(t.scoutingBlend.scoutingExpectedRates?.bb9)}, HR/9=${n(t.scoutingBlend.scoutingExpectedRates?.hr9)}`);
    lines.push(`- Final blended K/9=${n(t.output?.blendedK9)}, BB/9=${n(t.output?.blendedBb9)}, HR/9=${n(t.output?.blendedHr9)}`);
  } else {
    lines.push(`- No scouting blend applied`);
  }

  lines.push(`Step 5. Convert to rating outputs`);
  lines.push(`- Inverse conversion (rate -> 20-80-ish): Stuff=(K/9-2.10)/0.074, Control=(5.30-BB/9)/0.052, HRA=(2.18-HR/9)/0.024`);
  lines.push(`- Estimated stuff/control/hra = ${n(t.output?.estimatedStuff, 1)} / ${n(t.output?.estimatedControl, 1)} / ${n(t.output?.estimatedHra, 1)}`);
  lines.push(`- FIP-like = ((13*HR/9 + 3*BB/9 - 2*K/9)/9) = ${n(t.output?.fipLike)}`);

  lines.push(`Step 6. Percentile -> star rating (pool-relative)`);
  lines.push(`- Canonical pool (from TrueRatingsService): pitchers with total multi-year IP >= 10 (years include entries with >= 1 IP).`);
  lines.push(`- Percentile-to-rating bins: ${canonicalRatingBinsText()}`);
  if (canonical) {
    lines.push(`- Pool size=${output.poolSize}; role=${canonical.role}; percentile=${n(canonical.percentile, 1)} within role tier -> TR=${n(canonical.trueRating, 1)}`);
  } else {
    lines.push(`- Canonical pool result not found for this player`);
  }

  return lines.join('\n');
}

function renderHitterRatingExplanation(output: any): string {
  const t = output.trace ?? {};
  const canonical = output.canonicalResult;
  const lines: string[] = [];

  lines.push(`Hitter Rating Explanation: ${output.playerName} (${output.playerId}), ${output.year}`);
  lines.push(`Step 1. Source data`);
  lines.push(`- Component ratings here are NOT raw OSA/my scouting. They are derived from blended MLB rates, then percentile-ranked.`);
  lines.push(`- Stats years used: ${(t.input?.yearlyStats ?? []).map((s: any) => s.year).join(', ') || 'n/a'}`);
  lines.push(`- Year weights (most recent first): ${formatYearWeights(t.input)}`);
  lines.push(`- Scouting included: ${t.input?.hasScouting ? 'yes' : 'no'}${output.scoutingSource ? ` (source=${output.scoutingSource})` : ''}`);
  if (output.scoutingInput) {
    lines.push(`- Raw scouting input (20-80): power/eye/avoidK/contact/gap/speed=${n(output.scoutingInput.power, 1)} / ${n(output.scoutingInput.eye, 1)} / ${n(output.scoutingInput.avoidK, 1)} / ${n(output.scoutingInput.contact, 1)} / ${n(output.scoutingInput.gap, 1)} / ${n(output.scoutingInput.speed, 1)}`);
    lines.push(`- SR/STE=${n(output.scoutingInput.stealingAggressiveness, 1)}/${n(output.scoutingInput.stealingAbility, 1)}, OVR/POT=${n(output.scoutingInput.ovr, 1)}/${n(output.scoutingInput.pot, 1)}, injury=${output.scoutingInput.injuryProneness ?? 'n/a'}`);
  }

  lines.push(`Step 2. Multi-year weighting`);
  lines.push(`- Weighted rates are PA-weighted across years before regression.`);
  lines.push(`- Weighted BB%=${n(t.weightedRates?.bbPct)}, K%=${n(t.weightedRates?.kPct)}, HR%=${n(t.weightedRates?.hrPct)}, AVG=${n(t.weightedRates?.avg, 3)}, PA=${n(t.weightedRates?.totalPa, 0)}`);

  lines.push(`Step 3. Tier-aware regression`);
  lines.push(`- Raw wOBA=${n(t.rawWoba, 3)} sets regression tier (elite hitters regress toward elite targets, weak hitters toward weaker targets).`);
  lines.push(`- BB%: weighted ${n(t.regression?.bbPct?.weightedRate)} -> target ${n(t.regression?.bbPct?.regressionTarget)} with adjustedK ${n(t.regression?.bbPct?.adjustedKAfterPaScale)} -> regressed ${n(t.regression?.bbPct?.regressedRate)}`);
  lines.push(`- K%: weighted ${n(t.regression?.kPct?.weightedRate)} -> target ${n(t.regression?.kPct?.regressionTarget)} with adjustedK ${n(t.regression?.kPct?.adjustedKAfterPaScale)} -> regressed ${n(t.regression?.kPct?.regressedRate)}`);
  lines.push(`- AVG: weighted ${n(t.regression?.avg?.weightedRate, 3)} -> target ${n(t.regression?.avg?.regressionTarget, 3)} with adjustedK ${n(t.regression?.avg?.adjustedKAfterPaScale)} -> regressed ${n(t.regression?.avg?.regressedRate, 3)}`);
  lines.push(`- HR% is intentionally not regressed here (coefficient calibration already accounts for power regression).`);

  lines.push(`Step 4. Scouting blend`);
  if (t.scoutingBlend) {
    lines.push(`- Effective dev ratio=${n(t.scoutingBlend.effectiveDevRatio, 3)} scales scouting targets toward/away from league average.`);
    lines.push(`- Scout weights BB/K/HR/AVG=${n(t.scoutingBlend.weights?.bbPct?.scoutWeight, 3)} / ${n(t.scoutingBlend.weights?.kPct?.scoutWeight, 3)} / ${n(t.scoutingBlend.weights?.hrPct?.scoutWeight, 3)} / ${n(t.scoutingBlend.weights?.avg?.scoutWeight, 3)}`);
    lines.push(`- Final blended BB%=${n(t.output?.blendedBbPct)}, K%=${n(t.output?.blendedKPct)}, HR%=${n(t.output?.blendedHrPct)}, AVG=${n(t.output?.blendedAvg, 3)}`);
  } else {
    lines.push(`- No scouting blend applied`);
  }

  lines.push(`Step 5. Convert to offense outputs`);
  lines.push(`- wOBA uses linear weights: 0.69*BB + 0.89*1B + 1.27*2B + 1.62*3B + 2.10*HR (rate-based model).`);
  lines.push(`- Final blended wOBA=${n(t.output?.woba, 3)}`);

  lines.push(`Step 6. Percentile -> star rating (pool-relative via WAR/600)`);
  lines.push(`- Canonical pool (from TrueRatingsService): batters with total multi-year PA >= 30 (years include entries with >= 10 PA).`);
  lines.push(`- Percentile is WAR/600 rank across that pool; rating bins: ${canonicalRatingBinsText()}`);
  if (canonical) {
    lines.push(`- Pool size=${output.poolSize}, WAR/600=${n(canonical.war, 1)}, percentile=${n(canonical.percentile, 1)} -> TR=${n(canonical.trueRating, 1)}`);
  } else {
    lines.push(`- Canonical pool result not found for this player`);
  }

  return lines.join('\n');
}

function renderPitcherProjectionExplanation(output: any): string {
  const t = output.trace ?? {};
  const ip = t.ipPipeline ?? {};
  const lines: string[] = [];

  lines.push(`Pitcher Projection Explanation: ${output.playerName} (${output.playerId}), ${output.year}`);
  lines.push(`Step 1. Start from canonical current ratings`);
  lines.push(`- Current stuff/control/hra = ${n(t.input?.currentRatings?.stuff, 1)} / ${n(t.input?.currentRatings?.control, 1)} / ${n(t.input?.currentRatings?.hra, 1)} (from canonical pitcher TR map)`);
  lines.push(`- Current TR=${n(t.input?.trueRating, 1)}, age=${n(t.input?.age, 0)}, role signals: pitches=${n(t.input?.pitchCount, 0)}, GS=${n(t.input?.gs, 0)}`);
  if (output.scoutingInput) {
    lines.push(`- Raw scouting input (20-80): stuff/control/hra=${n(output.scoutingInput.stuff, 1)} / ${n(output.scoutingInput.control, 1)} / ${n(output.scoutingInput.hra, 1)}; stamina=${n(output.scoutingInput.stamina, 0)}, OVR/POT=${n(output.scoutingInput.ovr, 1)}/${n(output.scoutingInput.pot, 1)}, injury=${output.scoutingInput.injuryProneness ?? 'n/a'}`);
  }

  lines.push(`Step 2. Apply aging to ratings`);
  lines.push(`- Aged ratings = ${n(t.projectedRatings?.stuff, 1)} / ${n(t.projectedRatings?.control, 1)} / ${n(t.projectedRatings?.hra, 1)}`);
  lines.push(`- Aging deltas (rating points): stuff ${signedDelta(t.projectedRatings?.stuff, t.input?.currentRatings?.stuff)}, control ${signedDelta(t.projectedRatings?.control, t.input?.currentRatings?.control)}, hra ${signedDelta(t.projectedRatings?.hra, t.input?.currentRatings?.hra)}`);

  lines.push(`Step 3. Estimate skill baseline for IP allocation`);
  lines.push(`- Rates are generated from aged ratings via PotentialStatsService forward formulas; estimated FIP before IP pipeline = ${n(t.estimatedFipBeforeIp)}`);

  lines.push(`Step 4. Determine role and base IP`);
  lines.push(`- Role decision: isSP=${ip.roleDecision?.isSp ? 'yes' : 'no'} (${ip.roleDecision?.reason ?? 'n/a'})`);
  lines.push(`- Base IP (${ip.baseIp?.source ?? 'n/a'}) = ${n(ip.baseIp?.preInjury, 1)}`);

  lines.push(`Step 5. Apply IP modifiers`);
  lines.push(`- Injury modifier=${n(ip.injuryAdjustment?.modifier, 2)} -> ${n(ip.injuryAdjustment?.resultIp, 1)} IP`);
  lines.push(`- Skill modifier=${n(ip.skillAdjustment?.modifier, 2)} -> ${n(ip.skillAdjustment?.resultIp, 1)} IP`);
  lines.push(`- Historical blend (${ip.historicalBlend?.blendMode ?? 'none'}) -> ${n(ip.historicalBlend?.resultIp, 1)} IP`);
  lines.push(`- Age factor=${n(ip.ageAdjustment?.factor, 2)} -> ${n(ip.ageAdjustment?.resultIp, 1)} IP`);
  lines.push(`- Cap applied=${ip.ipCap?.applied ? 'yes' : 'no'}, elite boost=${n(ip.eliteBoost?.boost, 2)} -> ${n(ip.eliteBoost?.resultIp, 1)} IP`);

  lines.push(`Step 6. Final projected line`);
  lines.push(`- IP=${n(t.output?.projectedStats?.ip, 0)}, K/9=${n(t.output?.projectedStats?.k9)}, BB/9=${n(t.output?.projectedStats?.bb9)}, HR/9=${n(t.output?.projectedStats?.hr9)}, FIP=${n(t.output?.projectedStats?.fip)}, WAR=${n(t.output?.projectedStats?.war, 2)}`);

  return lines.join('\n');
}

function renderHitterProjectionExplanation(output: any): string {
  const t = output.trace ?? {};
  const p = output.projection;
  const lines: string[] = [];

  lines.push(`Hitter Projection Explanation: ${output.playerName} (${output.playerId}), ${output.year}`);
  lines.push(`Step 1. Start from projection input ratings`);
  lines.push(`- Current power/eye/avoidK/contact = ${n(t.input?.currentRatings?.power, 1)} / ${n(t.input?.currentRatings?.eye, 1)} / ${n(t.input?.currentRatings?.avoidK, 1)} / ${n(t.input?.currentRatings?.contact, 1)}`);
  lines.push(`- These are TR-derived component ratings from the projection build (stats+regression+scouting), not raw scouting ratings.`);
  if (p?.scoutingRatings) {
    lines.push(`- Raw scouting used in projection path (subset): power/eye/avoidK/contact=${n(p.scoutingRatings.power, 1)} / ${n(p.scoutingRatings.eye, 1)} / ${n(p.scoutingRatings.avoidK, 1)} / ${n(p.scoutingRatings.contact, 1)}`);
  }
  lines.push(`- Projection pool size=${n(output.projectionPoolSize, 0)}; percentile=${n(t.input?.percentile, 1)} is WAR/600 rank within that projection pool.`);
  lines.push(`- Input TR used for math=${n(t.input?.currentTrueRating, 1)}; displayed projection current TR=${n(p?.currentTrueRating, 1)} (may differ due to canonical overlay for UI consistency).`);

  lines.push(`Step 2. Apply aging to ratings`);
  lines.push(`- Aged ratings = ${n(t.projectedRatings?.power, 1)} / ${n(t.projectedRatings?.eye, 1)} / ${n(t.projectedRatings?.avoidK, 1)} / ${n(t.projectedRatings?.contact, 1)}`);
  lines.push(`- Age=${n(t.input?.age, 0)}; rating-point deltas: power ${signedDelta(t.projectedRatings?.power, t.input?.currentRatings?.power)}, eye ${signedDelta(t.projectedRatings?.eye, t.input?.currentRatings?.eye)}, avoidK ${signedDelta(t.projectedRatings?.avoidK, t.input?.currentRatings?.avoidK)}, contact ${signedDelta(t.projectedRatings?.contact, t.input?.currentRatings?.contact)}`);

  lines.push(`Step 3. Convert ratings to projected rates`);
  lines.push(`- Formula family: BB% = a + b*Eye, K% = a + b*AvoidK, AVG = a + b*Contact, HR% = piecewise(power<=50 vs >50).`);
  lines.push(`- BB%=${n(t.projectedRates?.bbPct)}, K%=${n(t.projectedRates?.kPct)}, AVG=${n(t.projectedRates?.avg, 3)}, HR%=${n(t.projectedRates?.hrPct)}`);
  lines.push(`- Hit mix assumption from non-HR hits: 1B/2B/3B = 65%/27%/8%.`);
  lines.push(`- wOBA contributions: 0.69*BB(${n(t.wobaComponents?.bbRate, 4)}) + 0.89*1B(${n(t.wobaComponents?.singleRate, 4)}) + 1.27*2B(${n(t.wobaComponents?.doubleRate, 4)}) + 1.62*3B(${n(t.wobaComponents?.tripleRate, 4)}) + 2.10*HR(${n(t.wobaComponents?.hrRate, 4)}) = ${n(t.wobaComponents?.woba, 3)}`);
  lines.push(`- OBP=min(0.450, AVG+BB), SLG=AVG+ISO, OPS=OBP+SLG -> ${n(t.wobaComponents?.obp, 3)} / ${n(t.wobaComponents?.slg, 3)} / ${n(t.wobaComponents?.ops, 3)}`);

  lines.push(`Step 4. Project playing time and baserunning`);
  lines.push(`- Projected PA=${n(t.playingTime?.projectedPa, 0)} (injury: ${t.playingTime?.injuryProneness ?? 'n/a'}), blended from recent PA history + age curve + injury multiplier.`);
  lines.push(`- Historical PA inputs: ${(t.playingTime?.historicalPaData ?? []).map((s: any) => `${s.year}:${s.pa}`).join(', ') || 'n/a'}`);
  lines.push(`- SB path=${t.stolenBaseProjection?.method ?? 'n/a'}${t.stolenBaseProjection?.method === 'scouting' ? ` (SR=${n(t.stolenBaseProjection?.sr, 1)}, STE=${n(t.stolenBaseProjection?.ste, 1)})` : ''} -> SB=${n(t.stolenBaseProjection?.sb, 0)}, CS=${n(t.stolenBaseProjection?.cs, 0)}, SB runs=${n(t.stolenBaseProjection?.sbRuns, 2)}`);

  lines.push(`Step 5. Convert to run value outputs`);
  lines.push(`- League context available: ${t.runValueOutput?.hasLeagueAverages ? 'yes' : 'no'}`);
  lines.push(`- wRC+=${n(t.runValueOutput?.wrcPlus, 0)} from projected wOBA vs league baseline; WAR=${n(t.runValueOutput?.war, 2)} includes baserunning runs.`);

  lines.push(`Step 6. Final projected line`);
  lines.push(`- PA=${n(p?.projectedStats?.pa, 0)}, AVG=${n(p?.projectedStats?.avg, 3)}, OBP=${n(p?.projectedStats?.obp, 3)}, SLG=${n(p?.projectedStats?.slg, 3)}, HR=${n(p?.projectedStats?.hr, 0)}, SB=${n(p?.projectedStats?.sb, 0)}, wOBA=${n(p?.projectedStats?.woba, 3)}, WAR=${n(p?.projectedStats?.war, 1)}`);

  return lines.join('\n');
}

function renderOutputExplanation(output: any): string {
  if (output.type === 'pitcher' && output.mode === 'rating') {
    return renderPitcherRatingExplanation(output);
  }
  if (output.type === 'hitter' && output.mode === 'rating') {
    return renderHitterRatingExplanation(output);
  }
  if (output.type === 'pitcher' && output.mode === 'projection') {
    return renderPitcherProjectionExplanation(output);
  }
  if (output.type === 'hitter' && output.mode === 'projection') {
    return renderHitterProjectionExplanation(output);
  }
  return output.message ?? 'No explanation available.';
}

function renderTextReport(payload: any): string {
  const sections: string[] = [];
  sections.push(`Explain Report`);
  sections.push(`- Player ID: ${payload.playerId}`);
  sections.push(`- Type: ${payload.playerType}`);
  sections.push(`- Year: ${payload.year}`);
  sections.push(`- Mode: ${payload.mode}`);

  for (const output of payload.outputs as any[]) {
    sections.push('\n' + renderOutputExplanation(output));
  }

  return sections.join('\n');
}

function renderExplanationMarkdown(explanation: string): string {
  const lines = explanation.split('\n');
  const title = lines[0] ?? 'Explanation';
  const body = lines.slice(1);
  const out: string[] = [`## ${title}`];

  for (const line of body) {
    if (line.startsWith('Step ')) {
      out.push(`### ${line}`);
    } else {
      out.push(line);
    }
  }

  return out.join('\n');
}

function renderMarkdownReport(payload: any): string {
  const sections: string[] = [];
  sections.push('# Explain Report');
  sections.push(`- Generated At: ${payload.generatedAt}`);
  sections.push(`- Player ID: ${payload.playerId}`);
  sections.push(`- Type: ${payload.playerType}`);
  sections.push(`- Year: ${payload.year}`);
  sections.push(`- Mode: ${payload.mode}`);

  for (const output of payload.outputs as any[]) {
    sections.push('');
    sections.push(renderExplanationMarkdown(renderOutputExplanation(output)));
  }

  return sections.join('\n');
}

async function main(): Promise<void> {
  await setupNodeEnvironment();

  const args = parseArgs(process.argv.slice(2));
  const formatArg = (args.format ?? 'text').toLowerCase();
  const format: OutputFormat =
    formatArg === 'json' ? 'json' : (formatArg === 'markdown' || formatArg === 'md' ? 'markdown' : 'text');
  const verbose = args.verbose === 'true';
  const baseConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };
  if (!verbose) {
    console.log = () => undefined;
    console.warn = () => undefined;
    console.error = () => undefined;
  }

  await disableIndexedDbPersistence();

  const playerId = Number(args.playerId ?? args.id);
  if (!Number.isFinite(playerId) || playerId <= 0) {
    throw new Error('Missing required --playerId=<id>');
  }

  const { dateService } = await import('../src/services/DateService');
  const fallbackYear = await dateService.getCurrentYear();
  const year = Number(args.year ?? fallbackYear);
  const mode = (args.mode ?? 'all') as ExplainMode;
  const playerType = await resolvePlayerType(playerId, args.type);

  await seedDefaultScouting(year);

  const outputs: any[] = [];

  if (mode === 'rating' || mode === 'all') {
    if (playerType === 'pitcher') {
      outputs.push(await explainPitcherRating(playerId, year));
    } else {
      outputs.push(await explainHitterRating(playerId, year));
    }
  }

  if (mode === 'projection' || mode === 'all') {
    if (playerType === 'pitcher') {
      outputs.push(await explainPitcherProjection(playerId, year));
    } else {
      outputs.push(await explainHitterProjection(playerId, year));
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    playerId,
    playerType,
    year,
    mode,
    outputs,
  };

  if (format === 'json') {
    baseConsole.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (format === 'markdown') {
    baseConsole.log(renderMarkdownReport(payload));
    return;
  }

  baseConsole.log(renderTextReport(payload));
}

main().catch((err) => {
  process.stderr.write(`Explain tool failed: ${String(err)}\n`);
  process.exit(1);
});
