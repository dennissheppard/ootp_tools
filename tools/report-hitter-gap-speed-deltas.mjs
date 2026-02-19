import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseCsv } from 'csv-parse/sync';

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [k, ...rest] = arg.slice(2).split('=');
    out[k] = rest.join('=');
  }
  return out;
}

function pctAt(index, n) {
  return n > 1 ? ((n - index - 1) / (n - 1)) * 100 : 50;
}

function findPercentile(value, sortedValues, higherIsBetter) {
  if (!sortedValues.length) return 50;
  const n = sortedValues.length;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedValues[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  const pctBelowOrEqual = (lo / n) * 100;
  return higherIsBetter
    ? Math.max(0, Math.min(100, pctBelowOrEqual))
    : Math.max(0, Math.min(100, 100 - pctBelowOrEqual));
}

function ratingFromPct(percentile) {
  return Math.round(20 + (percentile / 100) * 60);
}

function expectedDoublesRate(gap) {
  return -0.012627 + 0.001086 * gap;
}

function convertSpeed2080To20200(speed80) {
  const clamped = Math.max(20, Math.min(80, speed80));
  return 20 + ((clamped - 20) / 60) * 180;
}

function expectedTriplesRate(speed80) {
  const speed200 = convertSpeed2080To20200(speed80);
  return Math.max(0, -0.001657 + 0.000083 * speed200);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function fmt(v, digits = 2) {
  return Number.isFinite(v) ? v.toFixed(digits) : 'n/a';
}

function num(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseStarValue(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const raw = String(v).trim();
  if (!raw) return null;
  const direct = Number(raw);
  if (Number.isFinite(direct)) return direct;
  const m = raw.match(/(\d+(?:\.\d+)?)\s*stars?/i);
  if (!m) return null;
  const stars = Number(m[1]);
  return Number.isFinite(stars) ? stars : null;
}

function normalizeHeaderName(v) {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function findHeader(headers, aliases) {
  const normalized = headers.map(h => normalizeHeaderName(h));
  for (const alias of aliases) {
    const idx = normalized.indexOf(normalizeHeaderName(alias));
    if (idx >= 0) return headers[idx];
  }
  return null;
}

function computeLegacyMid(sortedValuesDesc, value) {
  const n = sortedValuesDesc.length;
  let first = -1;
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (sortedValuesDesc[i] === value) {
      if (first === -1) first = i;
      last = i;
    } else if (first !== -1) {
      break;
    }
  }
  if (first === -1) {
    first = n - 1;
    last = n - 1;
  }
  const minPct = Math.min(pctAt(first, n), pctAt(last, n));
  const maxPct = Math.max(pctAt(first, n), pctAt(last, n));
  const midPct = (minPct + maxPct) / 2;
  return {
    minRating: ratingFromPct(minPct),
    maxRating: ratingFromPct(maxPct),
    midRating: ratingFromPct(midPct),
    ties: (last - first + 1),
  };
}

function calcAgeAtSeasonStart(dob, season) {
  if (!dob) return null;
  const seasonStart = new Date(season, 3, 1);
  return Math.floor((seasonStart.getTime() - dob.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
}

async function loadDobMap(repoRoot) {
  const dobCsv = await fs.readFile(path.join(repoRoot, 'public', 'data', 'mlb_dob.csv'), 'utf8');
  const rows = parseCsv(dobCsv, { columns: true, skip_empty_lines: true });
  const map = new Map();
  for (const r of rows) {
    const id = Number(r.ID);
    const dob = String(r.DOB ?? '');
    if (!Number.isFinite(id) || !dob) continue;
    const [m, d, y] = dob.split('/').map(x => Number(x));
    if (!m || !d || !y) continue;
    map.set(id, new Date(y, m - 1, d));
  }
  return map;
}

async function buildMlbDoublesTriplesDistributions(repoRoot) {
  const years = [2015, 2016, 2017, 2018, 2019, 2020];
  const dobMap = await loadDobMap(repoRoot);
  const doublesRates = [];
  const triplesRates = [];

  for (const year of years) {
    const csvPath = path.join(repoRoot, 'public', 'data', 'mlb_batting', `${year}_batting.csv`);
    const csv = await fs.readFile(csvPath, 'utf8');
    const rows = parseCsv(csv, { columns: true, skip_empty_lines: true });

    for (const r of rows) {
      const playerId = num(r.player_id);
      const pa = num(r.pa);
      const ab = num(r.ab);
      const d = num(r.d);
      const t = num(r.t);
      const bb = num(r.bb);
      const k = num(r.k);
      const hr = num(r.hr);
      const avg = num(r.avg ?? (ab && num(r.h) != null ? num(r.h) / ab : null));

      if (playerId == null || pa == null || ab == null || d == null || t == null || bb == null || k == null || hr == null || avg == null) {
        continue;
      }
      if (pa < 300 || ab <= 0) continue;

      const age = calcAgeAtSeasonStart(dobMap.get(playerId), year);
      if (age == null || age < 25 || age > 29) continue;

      const bbPct = (bb / pa) * 100;
      const kPct = (k / pa) * 100;
      const hrPct = (hr / pa) * 100;
      const doublesRate = d / ab;
      const triplesRate = t / ab;

      if (!(bbPct >= 2 && bbPct <= 25 && kPct >= 5 && kPct <= 40 && hrPct >= 0 && hrPct <= 10 && avg >= 0.150 && avg <= 0.400)) {
        continue;
      }
      if (!(doublesRate >= 0 && doublesRate <= 0.15 && triplesRate >= 0 && triplesRate <= 0.03)) {
        continue;
      }

      doublesRates.push(doublesRate);
      triplesRates.push(triplesRate);
    }
  }

  doublesRates.sort((a, b) => a - b);
  triplesRates.sort((a, b) => a - b);
  return { doublesRates, triplesRates };
}

async function loadScoutingPool(repoRoot) {
  const csv = await fs.readFile(path.join(repoRoot, 'public', 'data', 'default_hitter_osa_scouting.csv'), 'utf8');
  const rows = parseCsv(csv, { columns: true, skip_empty_lines: true, relax_column_count: true });
  if (!rows.length) return [];

  const headers = Object.keys(rows[0]);
  const idCol = findHeader(headers, ['playerid', 'player_id', 'id', 'pid']);
  const nameCol = findHeader(headers, ['playername', 'player_name', 'name', 'player']);
  const gapCol = findHeader(headers, ['gap', 'gap p', 'gapp', 'gappower', 'gaps']);
  const speedCol = findHeader(headers, ['speed', 'speed p', 'spd', 'spdp', 'run', 'running', 'spe', 'spep']);
  const ovrCol = findHeader(headers, ['ovr', 'overall', 'cur', 'current']);
  const potCol = findHeader(headers, ['pot', 'potential', 'ceil', 'ceiling']);
  const ageCol = findHeader(headers, ['age']);

  if (!idCol || !gapCol || !speedCol || !ovrCol || !potCol) {
    throw new Error('Could not resolve required scouting columns in default_hitter_osa_scouting.csv');
  }

  const out = [];
  for (const r of rows) {
    const playerId = num(r[idCol]);
    const gap = num(r[gapCol]);
    const speed = num(r[speedCol]);
    const ovr = parseStarValue(r[ovrCol]);
    const pot = parseStarValue(r[potCol]);
    const age = ageCol ? num(r[ageCol]) : null;
    if (playerId == null || gap == null || speed == null || ovr == null || pot == null) continue;

    // Approximate TeamRatingsService gate: age < 26 OR starGap >= 0.5
    const starGap = pot - ovr;
    const passesGate = (age == null ? true : age < 26) || starGap >= 0.5;
    if (!passesGate) continue;

    out.push({
      playerId,
      name: nameCol ? String(r[nameCol] ?? `Player ${playerId}`) : `Player ${playerId}`,
      scoutGap: gap,
      scoutSpeed: speed,
      ovr,
      pot,
      age,
    });
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const year = Number(args.year ?? 2021);
  const topN = Math.max(5, Number(args.top ?? 15));
  const focusId = Number(args.playerId ?? 0);
  const repoRoot = process.cwd();

  const pool = await loadScoutingPool(repoRoot);
  const { doublesRates, triplesRates } = await buildMlbDoublesTriplesDistributions(repoRoot);

  const gapValuesDesc = pool.map(p => p.scoutGap).sort((a, b) => b - a);
  const speedValuesDesc = pool.map(p => p.scoutSpeed).sort((a, b) => b - a);

  const rows = pool.map(p => {
    const legacyGap = computeLegacyMid(gapValuesDesc, p.scoutGap);
    const legacySpeed = computeLegacyMid(speedValuesDesc, p.scoutSpeed);

    const newGapPct = findPercentile(expectedDoublesRate(p.scoutGap), doublesRates, true);
    const newSpeedPct = findPercentile(expectedTriplesRate(p.scoutSpeed), triplesRates, true);
    const currentGap = ratingFromPct(newGapPct);
    const currentSpeed = ratingFromPct(newSpeedPct);

    return {
      playerId: p.playerId,
      name: p.name,
      scoutGap: p.scoutGap,
      scoutSpeed: p.scoutSpeed,
      currentGap,
      currentSpeed,
      legacyGapMid: legacyGap.midRating,
      legacySpeedMid: legacySpeed.midRating,
      legacyGapRange: `${legacyGap.minRating}-${legacyGap.maxRating}`,
      legacySpeedRange: `${legacySpeed.minRating}-${legacySpeed.maxRating}`,
      gapDelta: currentGap - legacyGap.midRating,
      speedDelta: currentSpeed - legacySpeed.midRating,
      gapTieCount: legacyGap.ties,
      speedTieCount: legacySpeed.ties,
    };
  });

  const gapDeltas = rows.map(r => r.gapDelta);
  const speedDeltas = rows.map(r => r.speedDelta);
  const gapAbs = gapDeltas.map(Math.abs);
  const speedAbs = speedDeltas.map(Math.abs);
  const changedGap = rows.filter(r => r.gapDelta !== 0).length;
  const changedSpeed = rows.filter(r => r.speedDelta !== 0).length;

  console.log(`Hitter TFR Gap/Speed Delta Report (${year})`);
  console.log(`Pool size: ${rows.length}`);
  console.log(`MLB dist sizes: doubles=${doublesRates.length}, triples=${triplesRates.length}`);
  console.log(`Method: current MLB-based vs legacy prospect-rank midpoint (offline tie-aware approximation).`);
  console.log('');
  console.log(`Gap: changed=${changedGap}/${rows.length} (${fmt((changedGap / rows.length) * 100, 1)}%), meanAbs=${fmt(gapAbs.reduce((a, b) => a + b, 0) / rows.length)}, medianAbs=${fmt(median(gapAbs))}, maxUp=${Math.max(...gapDeltas)}, maxDown=${Math.min(...gapDeltas)}`);
  console.log(`Speed: changed=${changedSpeed}/${rows.length} (${fmt((changedSpeed / rows.length) * 100, 1)}%), meanAbs=${fmt(speedAbs.reduce((a, b) => a + b, 0) / rows.length)}, medianAbs=${fmt(median(speedAbs))}, maxUp=${Math.max(...speedDeltas)}, maxDown=${Math.min(...speedDeltas)}`);
  console.log('');

  const topGap = [...rows].sort((a, b) => Math.abs(b.gapDelta) - Math.abs(a.gapDelta)).slice(0, topN);
  console.log(`Top ${topN} Gap Movers (abs delta):`);
  for (const r of topGap) {
    console.log(`- ${r.playerId} ${r.name}: scoutGap=${r.scoutGap}, current=${r.currentGap}, legacyMid=${r.legacyGapMid} (range ${r.legacyGapRange}, ties=${r.gapTieCount}), delta=${r.gapDelta >= 0 ? '+' : ''}${r.gapDelta}`);
  }
  console.log('');

  const topSpeed = [...rows].sort((a, b) => Math.abs(b.speedDelta) - Math.abs(a.speedDelta)).slice(0, topN);
  console.log(`Top ${topN} Speed Movers (abs delta):`);
  for (const r of topSpeed) {
    console.log(`- ${r.playerId} ${r.name}: scoutSpeed=${r.scoutSpeed}, current=${r.currentSpeed}, legacyMid=${r.legacySpeedMid} (range ${r.legacySpeedRange}, ties=${r.speedTieCount}), delta=${r.speedDelta >= 0 ? '+' : ''}${r.speedDelta}`);
  }
  console.log('');

  if (Number.isFinite(focusId) && focusId > 0) {
    const row = rows.find(r => r.playerId === focusId);
    if (!row) {
      console.log(`Player ${focusId} not found in this approximation pool.`);
    } else {
      console.log(`Player Focus ${row.playerId} ${row.name}`);
      console.log(`- Gap: scout=${row.scoutGap}, current=${row.currentGap}, legacyMid=${row.legacyGapMid}, legacyRange=${row.legacyGapRange}, ties=${row.gapTieCount}, delta=${row.gapDelta >= 0 ? '+' : ''}${row.gapDelta}`);
      console.log(`- Speed: scout=${row.scoutSpeed}, current=${row.currentSpeed}, legacyMid=${row.legacySpeedMid}, legacyRange=${row.legacySpeedRange}, ties=${row.speedTieCount}, delta=${row.speedDelta >= 0 ? '+' : ''}${row.speedDelta}`);
    }
  }
}

main().catch((err) => {
  process.stderr.write(`report-hitter-gap-speed-deltas.mjs failed: ${String(err)}\n`);
  process.exit(1);
});
