/**
 * Hitter True Future Rating (TFR) Validation Test
 *
 * Tests the HitterTrueFutureRatingService against historical data:
 * - Uses 2017 scouting data to calculate TFR
 * - Compares to actual MLB performance in 2021 (peak years)
 * - Validates distribution alignment and component accuracy
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Interfaces
// ============================================================================

interface ScoutingRow {
  id: number;
  pos: string;
  name: string;
  org: string;
  level: string;
  dob: string;
  ovr: number;
  pot: number;
  prone: string;
  conP: number; // Contact Potential -> contact (replaces Hit Tool)
  gapP: number; // Gap Power
  powP: number; // Power
  eyeP: number; // Eye
  kP: number;   // Avoid K
  spe: number;  // Speed
}

interface MinorBattingRow {
  player_id: number;
  year: number;
  level_id: number;
  pa: number;
  ab: number;
  h: number;
  d: number;
  t: number;
  hr: number;
  bb: number;
  k: number;
  war: number;
}

interface MLBBattingRow {
  player_id: number;
  year: number;
  pa: number;
  ab: number;
  h: number;
  d: number;
  t: number;
  hr: number;
  bb: number;
  k: number;
  war: number;
}

interface HitterScoutingRatings {
  playerId: number;
  playerName: string;
  power: number;
  eye: number;
  avoidK: number;
  contact: number;  // Contact rating (replaces Hit Tool/BABIP)
  gap: number;
  speed: number;
  ovr: number;
  pot: number;
  source: 'my' | 'osa';
}

interface MinorLeagueBattingStatsWithLevel {
  id: number;
  name: string;
  year: number;
  level: 'aaa' | 'aa' | 'a' | 'r';
  pa: number;
  ab: number;
  h: number;
  d: number;
  t: number;
  hr: number;
  bb: number;
  k: number;
  avg: number;
  hr_pct: number;  // HR% instead of ISO
  bb_pct: number;
  k_pct: number;
}

interface HitterTFRResult {
  playerId: number;
  playerName: string;
  age: number;
  eyePercentile: number;
  avoidKPercentile: number;
  powerPercentile: number;
  contactPercentile: number;  // Replaces babipPercentile
  scoutBbPct: number;
  scoutKPct: number;
  scoutHrPct: number;
  scoutAvg: number;
  projBbPct: number;
  projKPct: number;
  projHrPct: number;
  projAvg: number;
  projWoba: number;
  percentile: number;
  trueFutureRating: number;
  totalMinorPa: number;
}

interface MLBActualPerformance {
  playerId: number;
  totalPa: number;
  peakWoba: number;
  peakWar: number;
  avgWoba: number;
  avgWar: number;
  yearsPlayed: number;
}

// ============================================================================
// Constants
// ============================================================================

const DATA_DIR = path.join(__dirname, '..', 'public', 'data');

// Level ID mapping from CSV
const LEVEL_ID_MAP: Record<number, 'aaa' | 'aa' | 'a' | 'r'> = {
  2: 'aaa',
  3: 'aa',
  4: 'a',
  5: 'r',
};

// Rating-to-stat coefficients (from HitterRatingEstimatorService - Modern Era 2015-2021)
// Power now maps to HR% instead of ISO
const REGRESSION_COEFFICIENTS = {
  eye: { intercept: -0.4196, slope: 0.114789 },     // BB% 1.9% to 8.8% (adjusted to fix +1.9% bias)
  avoidK: { intercept: 26.1423, slope: -0.200303 }, // K% 22.1% to 10.1%
  power: { intercept: -0.9862, slope: 0.058434 },   // HR% 0.18% to 3.69% (adjusted to fix HR% bias)
  contact: { intercept: 0.074367, slope: 0.00316593 }, // AVG .138 to .328 (Contact replaces Hit Tool)
};

// Level adjustments for minor league stats (using HR% instead of ISO)
const LEVEL_ADJUSTMENTS: Record<'aaa' | 'aa' | 'a' | 'r', { bbPct: number; kPct: number; hrPct: number; avg: number }> = {
  aaa: { bbPct: 0, kPct: 2.0, hrPct: -0.3, avg: -0.020 },
  aa: { bbPct: -0.5, kPct: 3.5, hrPct: -0.6, avg: -0.035 },
  a: { bbPct: -1.0, kPct: 5.0, hrPct: -1.0, avg: -0.050 },
  r: { bbPct: -1.5, kPct: 7.0, hrPct: -1.5, avg: -0.065 },
};

const LEVEL_PA_WEIGHTS: Record<'aaa' | 'aa' | 'a' | 'r', number> = {
  aaa: 1.0,
  aa: 0.7,
  a: 0.4,
  r: 0.2,
};

const MINOR_YEAR_WEIGHTS = [5, 3];

const PERCENTILE_TO_RATING = [
  { threshold: 99.0, rating: 5.0 },
  { threshold: 97.0, rating: 4.5 },
  { threshold: 93.0, rating: 4.0 },
  { threshold: 75.0, rating: 3.5 },
  { threshold: 60.0, rating: 3.0 },
  { threshold: 35.0, rating: 2.5 },
  { threshold: 20.0, rating: 2.0 },
  { threshold: 10.0, rating: 1.5 },
  { threshold: 5.0, rating: 1.0 },
  { threshold: 0.0, rating: 0.5 },
];

const WOBA_WEIGHTS = {
  bb: 0.69,
  single: 0.89,
  double: 1.27,
  triple: 1.62,
  hr: 2.10,
};

// ============================================================================
// CSV Parsing
// ============================================================================

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function parseScoutingCsv(csvText: string, source: 'my' | 'osa'): HitterScoutingRatings[] {
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const results: HitterScoutingRatings[] = [];

  // Skip header
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    if (cells.length < 16) continue;

    const pos = cells[1];
    // Skip pitchers
    if (pos === 'SP' || pos === 'RP') continue;

    const id = parseInt(cells[0], 10);
    const name = cells[2];

    // Parse star ratings
    const ovrStr = cells[6].toLowerCase().replace(/\s*stars?\s*/gi, '').trim();
    const potStr = cells[7].toLowerCase().replace(/\s*stars?\s*/gi, '').trim();
    const ovr = parseFloat(ovrStr);
    const pot = parseFloat(potStr);

    if (isNaN(id) || isNaN(ovr) || isNaN(pot)) continue;

    // Parse hitting ratings
    // Column indices: 9=HT P, 10=CON P, 11=GAP P, 12=POW P, 13=EYE P, 14=K P, 15=SPE
    const conP = parseInt(cells[10], 10); // Contact -> contact (replaces Hit Tool)
    const gapP = parseInt(cells[11], 10); // Gap Power
    const powP = parseInt(cells[12], 10); // Power
    const eyeP = parseInt(cells[13], 10); // Eye
    const kP = parseInt(cells[14], 10);   // Avoid K
    const spe = parseInt(cells[15], 10);  // Speed

    if (isNaN(powP) || isNaN(eyeP) || isNaN(kP)) continue;

    results.push({
      playerId: id,
      playerName: name,
      power: powP,
      eye: eyeP,
      avoidK: kP,
      contact: isNaN(conP) ? 50 : conP,  // Contact replaces Hit Tool/BABIP
      gap: isNaN(gapP) ? 50 : gapP,
      speed: isNaN(spe) ? 50 : spe,
      ovr,
      pot,
      source,
    });
  }

  return results;
}

function parseMinorsBattingCsv(csvText: string): MinorBattingRow[] {
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const results: MinorBattingRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    if (cells.length < 34) continue;

    // Column indices from header:
    // 0:id, 1:player_id, 2:year, 3:team_id, 4:game_id, 5:league_id, 6:level_id, 7:split_id,
    // 8:position, 9:ab, 10:h, 11:k, 12:pa, 13:pitches_seen, 14:g, 15:gs, 16:d, 17:t, 18:hr,
    // 19:r, 20:rbi, 21:sb, 22:cs, 23:bb, 24:ibb, 25:gdp, 26:sh, 27:sf, 28:hp, 29:ci,
    // 30:wpa, 31:stint, 32:ubr, 33:war
    const row: MinorBattingRow = {
      player_id: parseInt(cells[1], 10),
      year: parseInt(cells[2], 10),
      level_id: parseInt(cells[6], 10),
      pa: parseInt(cells[12], 10),
      ab: parseInt(cells[9], 10),
      h: parseInt(cells[10], 10),
      d: parseInt(cells[16], 10),
      t: parseInt(cells[17], 10),
      hr: parseInt(cells[18], 10),
      bb: parseInt(cells[23], 10),  // Fixed: was 24, now 23
      k: parseInt(cells[11], 10),
      war: parseFloat(cells[33]) || 0,  // Fixed: was 23, now 33
    };

    if (!isNaN(row.player_id) && row.pa > 0) {
      results.push(row);
    }
  }

  return results;
}

function parseMLBBattingCsv(csvText: string): MLBBattingRow[] {
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const results: MLBBattingRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    if (cells.length < 34) continue;

    // Column indices from header:
    // 0:id, 1:player_id, 2:year, 3:team_id, 4:game_id, 5:league_id, 6:level_id, 7:split_id,
    // 8:position, 9:ab, 10:h, 11:k, 12:pa, 13:pitches_seen, 14:g, 15:gs, 16:d, 17:t, 18:hr,
    // 19:r, 20:rbi, 21:sb, 22:cs, 23:bb, 24:ibb, 25:gdp, 26:sh, 27:sf, 28:hp, 29:ci,
    // 30:wpa, 31:stint, 32:ubr, 33:war
    const row: MLBBattingRow = {
      player_id: parseInt(cells[1], 10),
      year: parseInt(cells[2], 10),
      pa: parseInt(cells[12], 10),
      ab: parseInt(cells[9], 10),
      h: parseInt(cells[10], 10),
      d: parseInt(cells[16], 10),
      t: parseInt(cells[17], 10),
      hr: parseInt(cells[18], 10),
      bb: parseInt(cells[23], 10),  // Fixed: was 24, now 23
      k: parseInt(cells[11], 10),
      war: parseFloat(cells[33]) || 0,  // Fixed: was 23, now 33
    };

    if (!isNaN(row.player_id) && row.pa > 0) {
      results.push(row);
    }
  }

  return results;
}

// ============================================================================
// TFR Calculation (mirrors HitterTrueFutureRatingService)
// ============================================================================

function expectedBbPct(eye: number): number {
  return REGRESSION_COEFFICIENTS.eye.intercept + REGRESSION_COEFFICIENTS.eye.slope * eye;
}

function expectedKPct(avoidK: number): number {
  return REGRESSION_COEFFICIENTS.avoidK.intercept + REGRESSION_COEFFICIENTS.avoidK.slope * avoidK;
}

function expectedHrPct(power: number): number {
  return REGRESSION_COEFFICIENTS.power.intercept + REGRESSION_COEFFICIENTS.power.slope * power;
}

function expectedAvg(contact: number): number {
  return REGRESSION_COEFFICIENTS.contact.intercept + REGRESSION_COEFFICIENTS.contact.slope * contact;
}

/**
 * Component-specific scouting weights based on predictive validity analysis.
 * Eye and Contact use 100% scouting (MiLB stats are noise).
 * AvoidK and Power use PA-based weights (MiLB stats have some predictive value).
 */
function calculateComponentScoutingWeight(
  component: 'eye' | 'avoidK' | 'power' | 'contact',
  weightedPa: number
): number {
  // Eye and Contact: 100% scouting always (MiLB BB% r=0.05, AVG r=0.18)
  if (component === 'eye' || component === 'contact') {
    return 1.0;
  }

  // AvoidK: MiLB K% is predictive (r=0.68), so blend with stats
  if (component === 'avoidK') {
    if (weightedPa < 150) return 1.0;
    else if (weightedPa <= 300) return 0.65;
    else if (weightedPa <= 500) return 0.50;
    else return 0.40;
  }

  // Power: MiLB HR% is moderately predictive (r=0.44), but we over-projected
  // Use higher scouting weights to reduce HR% inflation
  if (component === 'power') {
    if (weightedPa < 150) return 1.0;
    else if (weightedPa <= 300) return 0.85;
    else if (weightedPa <= 500) return 0.80;
    else return 0.75;
  }

  return 1.0;
}

function calculateWeightedMinorStats(
  stats: MinorLeagueBattingStatsWithLevel[],
  currentYear: number
): { bbPct: number; kPct: number; hrPct: number; avg: number; totalPa: number; weightedPa: number } | null {
  if (stats.length === 0) return null;

  let weightedBbPctSum = 0;
  let weightedKPctSum = 0;
  let weightedHrPctSum = 0;
  let weightedAvgSum = 0;
  let totalWeight = 0;
  let totalPa = 0;
  let weightedPa = 0;

  for (const stat of stats) {
    if (stat.pa === 0) continue;

    const yearDiff = currentYear - stat.year;
    let yearWeight = 2;
    if (yearDiff === 0) yearWeight = MINOR_YEAR_WEIGHTS[0];
    else if (yearDiff === 1) yearWeight = MINOR_YEAR_WEIGHTS[1];

    const bbPct = stat.bb_pct;
    const kPct = stat.k_pct;
    const hrPctVal = (stat as any).hr ? ((stat as any).hr / stat.pa) * 100 : 0;  // HR% from stats
    const avgVal = stat.avg;

    // Apply level adjustments
    const adj = LEVEL_ADJUSTMENTS[stat.level];
    const adjustedBbPct = bbPct + adj.bbPct;
    const adjustedKPct = kPct + adj.kPct;
    const adjustedHrPct = hrPctVal + adj.hrPct;
    const adjustedAvg = avgVal + adj.avg;

    const weight = yearWeight * stat.pa;

    weightedBbPctSum += adjustedBbPct * weight;
    weightedKPctSum += adjustedKPct * weight;
    weightedHrPctSum += adjustedHrPct * weight;
    weightedAvgSum += adjustedAvg * weight;

    totalWeight += weight;
    totalPa += stat.pa;

    const levelWeight = LEVEL_PA_WEIGHTS[stat.level] ?? 0.5;
    weightedPa += stat.pa * levelWeight;
  }

  if (totalWeight === 0) return null;

  return {
    bbPct: weightedBbPctSum / totalWeight,
    kPct: weightedKPctSum / totalWeight,
    hrPct: weightedHrPctSum / totalWeight,
    avg: weightedAvgSum / totalWeight,
    totalPa,
    weightedPa,
  };
}

function calculateWobaFromRates(bbPct: number, _kPct: number, hrPct: number, avg: number): number {
  const bbRate = bbPct / 100;
  const hrRate = hrPct / 100;

  // Hit rate (excluding walks)
  const hitRate = avg * (1 - bbRate);

  // Non-HR hits
  const nonHrHitRate = Math.max(0, hitRate - hrRate);

  // Distribute non-HR hits: ~65% singles, ~27% doubles, ~8% triples
  const singleRate = nonHrHitRate * 0.65;
  const doubleRate = nonHrHitRate * 0.27;
  const tripleRate = nonHrHitRate * 0.08;

  const woba =
    WOBA_WEIGHTS.bb * bbRate +
    WOBA_WEIGHTS.single * singleRate +
    WOBA_WEIGHTS.double * doubleRate +
    WOBA_WEIGHTS.triple * tripleRate +
    WOBA_WEIGHTS.hr * hrRate;

  return Math.max(0.200, Math.min(0.500, woba));
}

function percentileToRating(percentile: number): number {
  for (const { threshold, rating } of PERCENTILE_TO_RATING) {
    if (percentile >= threshold) {
      return rating;
    }
  }
  return 0.5;
}

function mapPercentileToValue(percentile: number, sortedValues: number[]): number {
  if (sortedValues.length === 0) return 0;

  const clampedPercentile = Math.max(0, Math.min(100, percentile));
  const position = (clampedPercentile / 100) * (sortedValues.length - 1);
  const lowerIdx = Math.floor(position);
  const upperIdx = Math.ceil(position);

  if (lowerIdx === upperIdx) return sortedValues[lowerIdx];

  const lowerValue = sortedValues[lowerIdx];
  const upperValue = sortedValues[upperIdx];
  const fraction = position - lowerIdx;

  return lowerValue + (upperValue - lowerValue) * fraction;
}

interface ComponentBlendResult {
  playerId: number;
  playerName: string;
  age: number;
  eyeValue: number;
  avoidKValue: number;
  powerValue: number;
  contactValue: number;  // Replaces babipValue
  scoutBbPct: number;
  scoutKPct: number;
  scoutHrPct: number;
  scoutAvg: number;
  totalMinorPa: number;
}

function calculateComponentBlend(
  scouting: HitterScoutingRatings,
  minorStats: MinorLeagueBattingStatsWithLevel[],
  age: number
): ComponentBlendResult {
  const currentYear = minorStats.length > 0
    ? Math.max(...minorStats.map(s => s.year))
    : 2017;

  const weightedStats = calculateWeightedMinorStats(minorStats, currentYear);
  const totalMinorPa = weightedStats?.totalPa ?? 0;
  const weightedPa = weightedStats?.weightedPa ?? 0;

  // Component-specific scouting weights
  const eyeScoutWeight = calculateComponentScoutingWeight('eye', weightedPa);
  const avoidKScoutWeight = calculateComponentScoutingWeight('avoidK', weightedPa);
  const powerScoutWeight = calculateComponentScoutingWeight('power', weightedPa);
  const contactScoutWeight = calculateComponentScoutingWeight('contact', weightedPa);

  const scoutBbPct = expectedBbPct(scouting.eye);
  const scoutKPct = expectedKPct(scouting.avoidK);
  const scoutHrPct = expectedHrPct(scouting.power);
  const scoutAvg = expectedAvg(scouting.contact);

  let adjustedBbPct = scoutBbPct;
  let adjustedKPct = scoutKPct;
  let adjustedHrPct = scoutHrPct;
  let adjustedAvg = scoutAvg;

  if (weightedStats) {
    adjustedBbPct = weightedStats.bbPct;
    adjustedKPct = weightedStats.kPct;
    adjustedHrPct = weightedStats.hrPct;
    adjustedAvg = weightedStats.avg;
  }

  // Blend each component using its specific scouting weight
  const eyeValue = eyeScoutWeight * scoutBbPct + (1 - eyeScoutWeight) * adjustedBbPct;
  const avoidKValue = avoidKScoutWeight * scoutKPct + (1 - avoidKScoutWeight) * adjustedKPct;
  const powerValue = powerScoutWeight * scoutHrPct + (1 - powerScoutWeight) * adjustedHrPct;
  const contactValue = contactScoutWeight * scoutAvg + (1 - contactScoutWeight) * adjustedAvg;

  return {
    playerId: scouting.playerId,
    playerName: scouting.playerName,
    age,
    eyeValue,
    avoidKValue,
    powerValue,
    contactValue,  // Replaces babipValue
    scoutBbPct,
    scoutKPct,
    scoutHrPct,
    scoutAvg,
    totalMinorPa,
  };
}

function calculateTFRBatch(
  scoutingData: HitterScoutingRatings[],
  minorStatsMap: Map<number, MinorLeagueBattingStatsWithLevel[]>,
  ageMap: Map<number, number>,
  mlbDistribution: { bbPct: number[]; kPct: number[]; hrPct: number[]; avg: number[] }
): HitterTFRResult[] {
  // Step 1: Calculate component blends
  const componentResults = scoutingData.map(scout => {
    const minorStats = minorStatsMap.get(scout.playerId) ?? [];
    const age = ageMap.get(scout.playerId) ?? 21;
    return calculateComponentBlend(scout, minorStats, age);
  });

  // Step 2: Rank by each component
  const n = componentResults.length;
  if (n === 0) return [];

  const percentiles = new Map<number, { eye: number; avoidK: number; power: number; contact: number }>();

  // Eye ranking (higher is better)
  const eyeSorted = [...componentResults].sort((a, b) => b.eyeValue - a.eyeValue);
  for (let i = 0; i < n; i++) {
    const p = eyeSorted[i];
    const pct = n > 1 ? ((n - i - 1) / (n - 1)) * 100 : 50;
    if (!percentiles.has(p.playerId)) {
      percentiles.set(p.playerId, { eye: 0, avoidK: 0, power: 0, contact: 0 });
    }
    percentiles.get(p.playerId)!.eye = pct;
  }

  // AvoidK ranking (lower K% is better, so sort ascending)
  const avoidKSorted = [...componentResults].sort((a, b) => a.avoidKValue - b.avoidKValue);
  for (let i = 0; i < n; i++) {
    const p = avoidKSorted[i];
    const pct = n > 1 ? ((n - i - 1) / (n - 1)) * 100 : 50;
    percentiles.get(p.playerId)!.avoidK = pct;
  }

  // Power ranking (higher HR% is better)
  const powerSorted = [...componentResults].sort((a, b) => b.powerValue - a.powerValue);
  for (let i = 0; i < n; i++) {
    const p = powerSorted[i];
    const pct = n > 1 ? ((n - i - 1) / (n - 1)) * 100 : 50;
    percentiles.get(p.playerId)!.power = pct;
  }

  // Contact ranking (higher is better)
  const contactSorted = [...componentResults].sort((a, b) => b.contactValue - a.contactValue);
  for (let i = 0; i < n; i++) {
    const p = contactSorted[i];
    const pct = n > 1 ? ((n - i - 1) / (n - 1)) * 100 : 50;
    percentiles.get(p.playerId)!.contact = pct;
  }

  // Step 3: Map to MLB distribution and calculate wOBA
  const resultsWithWoba = componentResults.map(result => {
    const pcts = percentiles.get(result.playerId)!;

    let projBbPct = mapPercentileToValue(pcts.eye, mlbDistribution.bbPct);
    let projKPct = mapPercentileToValue(100 - pcts.avoidK, mlbDistribution.kPct);
    let projHrPct = mapPercentileToValue(pcts.power, mlbDistribution.hrPct);
    let projAvg = mapPercentileToValue(pcts.contact, mlbDistribution.avg);

    // Clamp
    projBbPct = Math.max(3.0, Math.min(20.0, projBbPct));
    projKPct = Math.max(5.0, Math.min(35.0, projKPct));
    projHrPct = Math.max(0.5, Math.min(8.0, projHrPct));  // HR% range
    projAvg = Math.max(0.200, Math.min(0.350, projAvg));

    const projWoba = calculateWobaFromRates(projBbPct, projKPct, projHrPct, projAvg);

    return {
      ...result,
      eyePercentile: pcts.eye,
      avoidKPercentile: pcts.avoidK,
      powerPercentile: pcts.power,
      contactPercentile: pcts.contact,
      projBbPct,
      projKPct,
      projHrPct,
      projAvg,
      projWoba,
    };
  });

  // Step 4: Rank by wOBA for final TFR
  const sortedByWoba = [...resultsWithWoba].sort((a, b) => b.projWoba - a.projWoba);

  return sortedByWoba.map((result, index) => {
    const percentile = n > 1 ? ((n - index - 1) / (n - 1)) * 100 : 50;
    const trueFutureRating = percentileToRating(percentile);

    return {
      playerId: result.playerId,
      playerName: result.playerName,
      age: result.age,
      eyePercentile: Math.round(result.eyePercentile * 10) / 10,
      avoidKPercentile: Math.round(result.avoidKPercentile * 10) / 10,
      powerPercentile: Math.round(result.powerPercentile * 10) / 10,
      contactPercentile: Math.round(result.contactPercentile * 10) / 10,
      scoutBbPct: Math.round(result.scoutBbPct * 10) / 10,
      scoutKPct: Math.round(result.scoutKPct * 10) / 10,
      scoutHrPct: Math.round(result.scoutHrPct * 100) / 100,
      scoutAvg: Math.round(result.scoutAvg * 1000) / 1000,
      projBbPct: Math.round(result.projBbPct * 10) / 10,
      projKPct: Math.round(result.projKPct * 10) / 10,
      projHrPct: Math.round(result.projHrPct * 100) / 100,
      projAvg: Math.round(result.projAvg * 1000) / 1000,
      projWoba: Math.round(result.projWoba * 1000) / 1000,
      percentile: Math.round(percentile * 10) / 10,
      trueFutureRating,
      totalMinorPa: result.totalMinorPa,
    };
  });
}

// ============================================================================
// Data Loading
// ============================================================================

function loadScoutingData(source: 'my' | 'osa'): HitterScoutingRatings[] {
  const filename = source === 'my'
    ? 'scouting_my_hitting_2017_11_2.csv'
    : 'scouting_OSA_hitting_2017_11_2.csv';

  const filepath = path.join(DATA_DIR, filename);

  if (!fs.existsSync(filepath)) {
    console.log(`Scouting file not found: ${filepath}`);
    return [];
  }

  const csvText = fs.readFileSync(filepath, 'utf-8');
  return parseScoutingCsv(csvText, source);
}

function loadMinorsBattingData(years: number[]): MinorBattingRow[] {
  const allRows: MinorBattingRow[] = [];

  for (const year of years) {
    for (const level of ['aaa', 'aa', 'a', 'r']) {
      const filename = `${year}_${level}_batting.csv`;
      const filepath = path.join(DATA_DIR, 'minors_batting', filename);

      if (!fs.existsSync(filepath)) continue;

      const csvText = fs.readFileSync(filepath, 'utf-8');
      const rows = parseMinorsBattingCsv(csvText);
      allRows.push(...rows);
    }
  }

  return allRows;
}

function loadMLBBattingData(years: number[]): MLBBattingRow[] {
  const allRows: MLBBattingRow[] = [];

  for (const year of years) {
    const filename = `${year}_batting.csv`;
    const filepath = path.join(DATA_DIR, 'mlb_batting', filename);

    if (!fs.existsSync(filepath)) continue;

    const csvText = fs.readFileSync(filepath, 'utf-8');
    const rows = parseMLBBattingCsv(csvText);
    allRows.push(...rows);
  }

  return allRows;
}

function buildMinorStatsMap(rows: MinorBattingRow[]): Map<number, MinorLeagueBattingStatsWithLevel[]> {
  const map = new Map<number, MinorLeagueBattingStatsWithLevel[]>();

  for (const row of rows) {
    const level = LEVEL_ID_MAP[row.level_id];
    if (!level) continue;

    const stat: MinorLeagueBattingStatsWithLevel = {
      id: row.player_id,
      name: '',
      year: row.year,
      level,
      pa: row.pa,
      ab: row.ab,
      h: row.h,
      d: row.d,
      t: row.t,
      hr: row.hr,
      bb: row.bb,
      k: row.k,
      avg: row.ab > 0 ? row.h / row.ab : 0,
      hr_pct: row.pa > 0 ? (row.hr / row.pa) * 100 : 0,  // HR% instead of ISO
      bb_pct: row.pa > 0 ? (row.bb / row.pa) * 100 : 0,
      k_pct: row.pa > 0 ? (row.k / row.pa) * 100 : 0,
    };

    if (!map.has(row.player_id)) {
      map.set(row.player_id, []);
    }
    map.get(row.player_id)!.push(stat);
  }

  return map;
}

function calculateIso(row: { ab: number; h: number; d: number; t: number; hr: number }): number {
  const singles = row.h - row.d - row.t - row.hr;
  const totalBases = singles + 2 * row.d + 3 * row.t + 4 * row.hr;
  const slg = row.ab > 0 ? totalBases / row.ab : 0;
  const avg = row.ab > 0 ? row.h / row.ab : 0;
  return slg - avg;
}

function calculateWoba(row: { pa: number; bb: number; h: number; d: number; t: number; hr: number }): number {
  const singles = row.h - row.d - row.t - row.hr;
  const woba = row.pa > 0
    ? (WOBA_WEIGHTS.bb * row.bb +
       WOBA_WEIGHTS.single * singles +
       WOBA_WEIGHTS.double * row.d +
       WOBA_WEIGHTS.triple * row.t +
       WOBA_WEIGHTS.hr * row.hr) / row.pa
    : 0;
  return woba;
}

function buildMLBDistribution(rows: MLBBattingRow[], minPa: number = 300): {
  bbPct: number[];
  kPct: number[];
  hrPct: number[];
  avg: number[];
} {
  const bbPct: number[] = [];
  const kPct: number[] = [];
  const hrPct: number[] = [];
  const avg: number[] = [];

  for (const row of rows) {
    if (row.pa < minPa) continue;

    const bb = (row.bb / row.pa) * 100;
    const k = (row.k / row.pa) * 100;
    const hr = (row.hr / row.pa) * 100;  // HR% instead of ISO
    const avgVal = row.ab > 0 ? row.h / row.ab : 0;

    // Filter outliers
    if (bb >= 2 && bb <= 25 && k >= 5 && k <= 40 &&
        hr >= 0 && hr <= 10 && avgVal >= 0.150 && avgVal <= 0.400) {
      bbPct.push(bb);
      kPct.push(k);
      hrPct.push(hr);
      avg.push(avgVal);
    }
  }

  // Sort ascending
  bbPct.sort((a, b) => a - b);
  kPct.sort((a, b) => a - b);
  hrPct.sort((a, b) => a - b);
  avg.sort((a, b) => a - b);

  return { bbPct, kPct, hrPct, avg };
}

function buildMLBActualPerformance(rows: MLBBattingRow[], minPa: number = 100): Map<number, MLBActualPerformance> {
  const playerStats = new Map<number, { totalPa: number; wobaSum: number; warSum: number; years: number; peakWoba: number; peakWar: number }>();

  for (const row of rows) {
    if (row.pa < minPa) continue;

    const woba = calculateWoba(row);

    if (!playerStats.has(row.player_id)) {
      playerStats.set(row.player_id, { totalPa: 0, wobaSum: 0, warSum: 0, years: 0, peakWoba: 0, peakWar: 0 });
    }

    const stats = playerStats.get(row.player_id)!;
    stats.totalPa += row.pa;
    stats.wobaSum += woba * row.pa;
    stats.warSum += row.war;
    stats.years += 1;
    stats.peakWoba = Math.max(stats.peakWoba, woba);
    stats.peakWar = Math.max(stats.peakWar, row.war);
  }

  const result = new Map<number, MLBActualPerformance>();

  for (const [playerId, stats] of playerStats) {
    result.set(playerId, {
      playerId,
      totalPa: stats.totalPa,
      peakWoba: Math.round(stats.peakWoba * 1000) / 1000,
      peakWar: Math.round(stats.peakWar * 10) / 10,
      avgWoba: stats.totalPa > 0 ? Math.round((stats.wobaSum / stats.totalPa) * 1000) / 1000 : 0,
      avgWar: stats.years > 0 ? Math.round((stats.warSum / stats.years) * 10) / 10 : 0,
      yearsPlayed: stats.years,
    });
  }

  return result;
}

function calculateAge(dob: string, year: number): number {
  // Parse DOB in format "MM/DD/YYYY"
  const parts = dob.split('/');
  if (parts.length !== 3) return 21; // default

  const birthYear = parseInt(parts[2], 10);
  if (isNaN(birthYear)) return 21;

  return year - birthYear;
}

// ============================================================================
// Analysis Functions
// ============================================================================

function analyzeDistributionAlignment(
  tfrResults: HitterTFRResult[],
  mlbActual: Map<number, MLBActualPerformance>
): void {
  console.log('\n' + '='.repeat(80));
  console.log('DISTRIBUTION ALIGNMENT ANALYSIS');
  console.log('='.repeat(80));

  // Group by TFR tier
  const tiers = [
    { name: 'Elite (4.5+)', min: 4.5, max: 5.0 },
    { name: 'Above-Avg (3.5-4.4)', min: 3.5, max: 4.4 },
    { name: 'Average (2.5-3.4)', min: 2.5, max: 3.4 },
    { name: 'Fringe (<2.5)', min: 0.5, max: 2.4 },
  ];

  for (const tier of tiers) {
    const tierProspects = tfrResults.filter(r => r.trueFutureRating >= tier.min && r.trueFutureRating <= tier.max);
    const arrivedProspects = tierProspects.filter(p => mlbActual.has(p.playerId));

    const arrivedWithMinPa = arrivedProspects.filter(p => {
      const actual = mlbActual.get(p.playerId);
      return actual && actual.totalPa >= 300;
    });

    console.log(`\n${tier.name}:`);
    console.log(`  Prospects: ${tierProspects.length}`);
    console.log(`  Arrived (any MLB): ${arrivedProspects.length} (${tierProspects.length > 0 ? ((arrivedProspects.length / tierProspects.length) * 100).toFixed(1) : 0}%)`);
    console.log(`  Arrived (300+ PA): ${arrivedWithMinPa.length} (${tierProspects.length > 0 ? ((arrivedWithMinPa.length / tierProspects.length) * 100).toFixed(1) : 0}%)`);

    if (arrivedWithMinPa.length > 0) {
      const avgProjWoba = arrivedWithMinPa.reduce((sum, p) => sum + p.projWoba, 0) / arrivedWithMinPa.length;
      const avgActualWoba = arrivedWithMinPa.reduce((sum, p) => sum + (mlbActual.get(p.playerId)?.peakWoba ?? 0), 0) / arrivedWithMinPa.length;
      const avgActualWar = arrivedWithMinPa.reduce((sum, p) => sum + (mlbActual.get(p.playerId)?.avgWar ?? 0), 0) / arrivedWithMinPa.length;

      console.log(`  Avg Proj wOBA: ${avgProjWoba.toFixed(3)}`);
      console.log(`  Avg Peak wOBA: ${avgActualWoba.toFixed(3)}`);
      console.log(`  Avg WAR/yr:    ${avgActualWar.toFixed(1)}`);
    }
  }
}

function analyzeComponentValidation(
  tfrResults: HitterTFRResult[],
  mlbActual: Map<number, MLBActualPerformance>,
  mlbRows: MLBBattingRow[]
): void {
  console.log('\n' + '='.repeat(80));
  console.log('COMPONENT VALIDATION');
  console.log('='.repeat(80));

  // Get players who arrived with significant PA
  const arrivedPlayers = tfrResults.filter(p => {
    const actual = mlbActual.get(p.playerId);
    return actual && actual.totalPa >= 300;
  });

  if (arrivedPlayers.length === 0) {
    console.log('\nNo prospects with 300+ MLB PA found.');
    return;
  }

  // Calculate actual peak stats for each arrived player
  const playerPeakStats = new Map<number, { bbPct: number; kPct: number; hrPct: number; avg: number }>();

  for (const player of arrivedPlayers) {
    const playerRows = mlbRows.filter(r => r.player_id === player.playerId && r.pa >= 100);
    if (playerRows.length === 0) continue;

    // Find peak season
    let peakWoba = 0;
    let peakStats = { bbPct: 0, kPct: 0, hrPct: 0, avg: 0 };

    for (const row of playerRows) {
      const woba = calculateWoba(row);
      if (woba > peakWoba) {
        peakWoba = woba;
        peakStats = {
          bbPct: (row.bb / row.pa) * 100,
          kPct: (row.k / row.pa) * 100,
          hrPct: (row.hr / row.pa) * 100,  // HR% instead of ISO
          avg: row.ab > 0 ? row.h / row.ab : 0,
        };
      }
    }

    playerPeakStats.set(player.playerId, peakStats);
  }

  // Compare projected vs actual for each component
  const comparisons = ['bbPct', 'kPct', 'hrPct', 'avg'] as const;
  const projKeys = ['projBbPct', 'projKPct', 'projHrPct', 'projAvg'] as const;

  for (let i = 0; i < comparisons.length; i++) {
    const comp = comparisons[i];
    const projKey = projKeys[i];

    let sumDiff = 0;
    let sumAbsDiff = 0;
    let count = 0;

    for (const player of arrivedPlayers) {
      const peakStats = playerPeakStats.get(player.playerId);
      if (!peakStats) continue;

      const projected = player[projKey];
      const actual = peakStats[comp];
      const diff = projected - actual;

      sumDiff += diff;
      sumAbsDiff += Math.abs(diff);
      count++;
    }

    if (count > 0) {
      const avgBias = sumDiff / count;
      const avgError = sumAbsDiff / count;

      console.log(`\n${comp.toUpperCase()}:`);
      console.log(`  Sample size: ${count}`);
      console.log(`  Avg Bias: ${avgBias > 0 ? '+' : ''}${avgBias.toFixed(comp === 'hrPct' || comp === 'avg' ? 3 : 1)}`);
      console.log(`  Avg Abs Error: ${avgError.toFixed(comp === 'hrPct' || comp === 'avg' ? 3 : 1)}`);
    }
  }
}

function printTopProspects(
  tfrResults: HitterTFRResult[],
  mlbActual: Map<number, MLBActualPerformance>,
  limit: number = 30
): void {
  console.log('\n' + '='.repeat(80));
  console.log(`TOP ${limit} PROSPECTS BY TFR`);
  console.log('='.repeat(80));

  const top = tfrResults.slice(0, limit);

  console.log('\n' + 'Name'.padEnd(25) + 'TFR'.padStart(5) + 'wOBA'.padStart(7) + 'POW%'.padStart(6) + 'EYE%'.padStart(6) + 'AVK%'.padStart(6) + 'MiPA'.padStart(6) + 'MLB PA'.padStart(8) + 'MLB wOBA'.padStart(10) + 'MLB WAR'.padStart(9));
  console.log('-'.repeat(100));

  for (const p of top) {
    const actual = mlbActual.get(p.playerId);
    const mlbPa = actual?.totalPa ?? 0;
    const mlbWoba = actual?.peakWoba ?? 0;
    const mlbWar = actual?.avgWar ?? 0;

    console.log(
      p.playerName.padEnd(25) +
      p.trueFutureRating.toFixed(1).padStart(5) +
      p.projWoba.toFixed(3).padStart(7) +
      p.powerPercentile.toFixed(0).padStart(6) +
      p.eyePercentile.toFixed(0).padStart(6) +
      p.avoidKPercentile.toFixed(0).padStart(6) +
      p.totalMinorPa.toString().padStart(6) +
      mlbPa.toString().padStart(8) +
      (mlbWoba > 0 ? mlbWoba.toFixed(3) : '-').padStart(10) +
      (mlbWar !== 0 ? mlbWar.toFixed(1) : '-').padStart(9)
    );
  }
}

function printArrivalRateAnalysis(
  tfrResults: HitterTFRResult[],
  mlbActual: Map<number, MLBActualPerformance>
): void {
  console.log('\n' + '='.repeat(80));
  console.log('ARRIVAL RATE ANALYSIS');
  console.log('='.repeat(80));

  const tfrLevels = [5.0, 4.5, 4.0, 3.5, 3.0, 2.5, 2.0, 1.5, 1.0, 0.5];

  console.log('\n' + 'TFR'.padStart(5) + 'Count'.padStart(8) + 'Arrived'.padStart(10) + 'Rate'.padStart(8) + 'Avg WAR'.padStart(10) + 'Avg wOBA'.padStart(10));
  console.log('-'.repeat(60));

  for (const tfr of tfrLevels) {
    const prospects = tfrResults.filter(r => r.trueFutureRating === tfr);
    const arrived = prospects.filter(p => {
      const actual = mlbActual.get(p.playerId);
      return actual && actual.totalPa >= 200;
    });

    const rate = prospects.length > 0 ? (arrived.length / prospects.length) * 100 : 0;
    const avgWar = arrived.length > 0
      ? arrived.reduce((sum, p) => sum + (mlbActual.get(p.playerId)?.avgWar ?? 0), 0) / arrived.length
      : 0;
    const avgWoba = arrived.length > 0
      ? arrived.reduce((sum, p) => sum + (mlbActual.get(p.playerId)?.peakWoba ?? 0), 0) / arrived.length
      : 0;

    console.log(
      tfr.toFixed(1).padStart(5) +
      prospects.length.toString().padStart(8) +
      arrived.length.toString().padStart(10) +
      `${rate.toFixed(1)}%`.padStart(8) +
      (avgWar !== 0 ? avgWar.toFixed(1) : '-').padStart(10) +
      (avgWoba > 0 ? avgWoba.toFixed(3) : '-').padStart(10)
    );
  }
}

function printSummaryStats(
  tfrResults: HitterTFRResult[],
  mlbActual: Map<number, MLBActualPerformance>
): void {
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY STATISTICS');
  console.log('='.repeat(80));

  const totalProspects = tfrResults.length;
  const arrivedAny = tfrResults.filter(p => mlbActual.has(p.playerId)).length;
  const arrivedMin = tfrResults.filter(p => {
    const actual = mlbActual.get(p.playerId);
    return actual && actual.totalPa >= 300;
  }).length;

  // wOBA distribution
  const wobas = tfrResults.map(p => p.projWoba);
  const meanWoba = wobas.reduce((a, b) => a + b, 0) / wobas.length;
  const sortedWobas = [...wobas].sort((a, b) => a - b);
  const medianWoba = sortedWobas[Math.floor(sortedWobas.length / 2)];

  console.log(`\nTotal Prospects: ${totalProspects}`);
  console.log(`Arrived (any MLB): ${arrivedAny} (${((arrivedAny / totalProspects) * 100).toFixed(1)}%)`);
  console.log(`Arrived (300+ PA): ${arrivedMin} (${((arrivedMin / totalProspects) * 100).toFixed(1)}%)`);
  console.log(`\nProjected wOBA Distribution:`);
  console.log(`  Mean: ${meanWoba.toFixed(3)}`);
  console.log(`  Median: ${medianWoba.toFixed(3)}`);
  console.log(`  Min: ${sortedWobas[0].toFixed(3)}`);
  console.log(`  Max: ${sortedWobas[sortedWobas.length - 1].toFixed(3)}`);
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('HITTER TRUE FUTURE RATING (TFR) VALIDATION TEST');
  console.log('='.repeat(80));
  console.log('\nUsing 2017 scouting data to project and compare to actual MLB performance.');

  // Load scouting data
  console.log('\nLoading scouting data...');
  const myScoutingData = loadScoutingData('my');
  const osaScoutingData = loadScoutingData('osa');

  console.log(`  My scouting: ${myScoutingData.length} hitters`);
  console.log(`  OSA scouting: ${osaScoutingData.length} hitters`);

  // Use "my" scouting if available, otherwise OSA
  const scoutingData = myScoutingData.length > 0 ? myScoutingData : osaScoutingData;
  if (scoutingData.length === 0) {
    console.error('No scouting data found!');
    return;
  }

  // Load minor league batting stats (2016-2017)
  console.log('\nLoading minor league batting data (2016-2017)...');
  const minorRows = loadMinorsBattingData([2016, 2017]);
  console.log(`  Total records: ${minorRows.length}`);

  const minorStatsMap = buildMinorStatsMap(minorRows);
  console.log(`  Unique players: ${minorStatsMap.size}`);

  // Build age map from scouting DOB (assuming 2017 season)
  const ageMap = new Map<number, number>();
  // Note: Scouting CSV doesn't have DOB in easily parseable format, use default age
  for (const scout of scoutingData) {
    ageMap.set(scout.playerId, 21); // Default age for minor leaguers
  }

  // Load MLB batting data for distribution (2015-2020 peak-age)
  console.log('\nLoading MLB batting data (2015-2020) for distribution...');
  const mlbDistRows = loadMLBBattingData([2015, 2016, 2017, 2018, 2019, 2020]);
  console.log(`  Total records: ${mlbDistRows.length}`);

  const mlbDistribution = buildMLBDistribution(mlbDistRows, 300);
  console.log(`  Distribution samples: ${mlbDistribution.bbPct.length}`);

  // Load MLB batting data for actual performance (2018-2021)
  console.log('\nLoading MLB batting data (2018-2021) for actual performance...');
  const mlbActualRows = loadMLBBattingData([2018, 2019, 2020, 2021]);
  console.log(`  Total records: ${mlbActualRows.length}`);

  const mlbActual = buildMLBActualPerformance(mlbActualRows, 100);
  console.log(`  Unique players: ${mlbActual.size}`);

  // Calculate TFR for all prospects
  console.log('\nCalculating TFR for all prospects...');
  const tfrResults = calculateTFRBatch(scoutingData, minorStatsMap, ageMap, mlbDistribution);
  console.log(`  Calculated TFR for ${tfrResults.length} hitters`);

  // Print results
  printTopProspects(tfrResults, mlbActual, 30);
  analyzeDistributionAlignment(tfrResults, mlbActual);
  printArrivalRateAnalysis(tfrResults, mlbActual);
  analyzeComponentValidation(tfrResults, mlbActual, mlbActualRows);
  printSummaryStats(tfrResults, mlbActual);

  console.log('\n' + '='.repeat(80));
  console.log('TEST COMPLETE');
  console.log('='.repeat(80));
}

main().catch(console.error);
