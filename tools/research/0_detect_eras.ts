/**
 * Era Detection Script
 *
 * Analyzes league-wide MLB statistics from 2000-2021 to detect OOTP engine transitions.
 *
 * Known transitions:
 * - 2006: OOTP 23 → OOTP 24 (confirmed)
 * - 2013?: OOTP 24 → OOTP 25 (needs confirmation)
 * - 2018: OOTP 25 → OOTP 26 (confirmed)
 *
 * Output: Year-over-year changes in K/9, BB/9, HR/9, FIP to identify sharp changes
 */

import { loadMlbData, mean, standardDeviation } from './lib/dataLoader';

interface EraStats {
  year: number;
  pitchers: number;
  totalIP: number;
  avgK9: number;
  avgBB9: number;
  avgHR9: number;
  avgFIP: number;
  avgERA: number;
  medianIP: number;
}

interface YearChange {
  year: number;
  k9Change: number;
  bb9Change: number;
  hr9Change: number;
  fipChange: number;
  significant: boolean;
}

async function detectEras() {
  console.log('🔬 OOTP Era Detection Analysis');
  console.log('=' .repeat(80));
  console.log('Analyzing MLB data from 2000-2021 to detect engine transitions\n');

  const startYear = 2000;
  const endYear = 2021;
  const allStats: EraStats[] = [];

  // Load and analyze each year
  console.log('📊 Loading data...\n');

  for (let year = startYear; year <= endYear; year++) {
    const data = loadMlbData(year);

    if (data.length === 0) {
      console.log(`⚠️  No data for ${year}, skipping...`);
      continue;
    }

    // Calculate league-wide averages
    const k9Values = data.map(p => p.k9);
    const bb9Values = data.map(p => p.bb9);
    const hr9Values = data.map(p => p.hr9);
    const fipValues = data.map(p => p.fip);
    const eraValues = data.map(p => p.era);
    const ipValues = data.map(p => p.ip).sort((a, b) => a - b);

    const stats: EraStats = {
      year,
      pitchers: data.length,
      totalIP: data.reduce((sum, p) => sum + p.ip, 0),
      avgK9: mean(k9Values),
      avgBB9: mean(bb9Values),
      avgHR9: mean(hr9Values),
      avgFIP: mean(fipValues),
      avgERA: mean(eraValues),
      medianIP: ipValues[Math.floor(ipValues.length / 2)]
    };

    allStats.push(stats);
  }

  // Display results
  console.log('Year  Pitchers  Avg K/9  Avg BB/9  Avg HR/9  Avg FIP  Avg ERA  Notes');
  console.log('-'.repeat(80));

  const changes: YearChange[] = [];

  for (let i = 0; i < allStats.length; i++) {
    const curr = allStats[i];
    const prev = i > 0 ? allStats[i - 1] : null;

    let change: YearChange | null = null;
    let note = '';

    if (prev) {
      const k9Change = ((curr.avgK9 - prev.avgK9) / prev.avgK9) * 100;
      const bb9Change = ((curr.avgBB9 - prev.avgBB9) / prev.avgBB9) * 100;
      const hr9Change = ((curr.avgHR9 - prev.avgHR9) / prev.avgHR9) * 100;
      const fipChange = ((curr.avgFIP - prev.avgFIP) / prev.avgFIP) * 100;

      change = {
        year: curr.year,
        k9Change,
        bb9Change,
        hr9Change,
        fipChange,
        significant: Math.abs(k9Change) > 5 || Math.abs(bb9Change) > 5 || Math.abs(hr9Change) > 10
      };

      changes.push(change);

      // Flag significant changes
      if (curr.year === 2006) {
        note = '⚠️  OOTP 24 transition';
      } else if (curr.year >= 2012 && curr.year <= 2014 && change.significant) {
        note = '⚠️  Possible OOTP 25 transition?';
      } else if (curr.year === 2018) {
        note = '⚠️  OOTP 26 transition';
      } else if (change.significant) {
        note = '⚠️  Significant change';
      }
    }

    console.log(
      `${curr.year}  ${curr.pitchers.toString().padEnd(8)}  ` +
      `${curr.avgK9.toFixed(2).padEnd(7)}  ` +
      `${curr.avgBB9.toFixed(2).padEnd(8)}  ` +
      `${curr.avgHR9.toFixed(2).padEnd(8)}  ` +
      `${curr.avgFIP.toFixed(2).padEnd(7)}  ` +
      `${curr.avgERA.toFixed(2).padEnd(7)}  ` +
      note
    );
  }

  // Detailed year-over-year changes
  console.log('\n\n📈 Year-Over-Year Changes (%)');
  console.log('=' .repeat(80));
  console.log('Year  K/9 Δ%   BB/9 Δ%  HR/9 Δ%  FIP Δ%   Significant?');
  console.log('-'.repeat(80));

  for (const change of changes) {
    const sigFlag = change.significant ? '⚠️  YES' : '';
    console.log(
      `${change.year}  ` +
      `${change.k9Change >= 0 ? '+' : ''}${change.k9Change.toFixed(1)}%`.padEnd(8) + '  ' +
      `${change.bb9Change >= 0 ? '+' : ''}${change.bb9Change.toFixed(1)}%`.padEnd(8) + '  ' +
      `${change.hr9Change >= 0 ? '+' : ''}${change.hr9Change.toFixed(1)}%`.padEnd(8) + '  ' +
      `${change.fipChange >= 0 ? '+' : ''}${change.fipChange.toFixed(1)}%`.padEnd(8) + '  ' +
      sigFlag
    );
  }

  // Recommend era boundaries
  console.log('\n\n✅ Recommended Era Boundaries');
  console.log('=' .repeat(80));

  const significantYears = changes.filter(c => c.significant).map(c => c.year);
  console.log('\nYears with significant changes:', significantYears.join(', '));

  // Heuristic: Look for clusters around known transition years
  const era1End = significantYears.find(y => y >= 2005 && y <= 2007) || 2005;
  const era2End = significantYears.find(y => y >= 2011 && y <= 2014) || 2013;
  const era3End = significantYears.find(y => y >= 2017 && y <= 2019) || 2017;

  console.log(`\n📅 OOTP 23:  2000-${era1End}`);
  console.log(`📅 OOTP 24:  ${era1End + 1}-${era2End}`);
  console.log(`📅 OOTP 25:  ${era2End + 1}-${era3End}`);
  console.log(`📅 OOTP 26:  ${era3End + 1}-2021`);

  // Calculate era averages
  console.log('\n\n📊 Era-Wide Averages');
  console.log('=' .repeat(80));

  const eras = [
    { name: 'OOTP 23', start: 2000, end: era1End },
    { name: 'OOTP 24', start: era1End + 1, end: era2End },
    { name: 'OOTP 25', start: era2End + 1, end: era3End },
    { name: 'OOTP 26', start: era3End + 1, end: 2021 }
  ];

  console.log('\nEra       Years         K/9   BB/9  HR/9  FIP   ERA');
  console.log('-'.repeat(80));

  for (const era of eras) {
    const eraStats = allStats.filter(s => s.year >= era.start && s.year <= era.end);
    if (eraStats.length === 0) continue;

    const avgK9 = mean(eraStats.map(s => s.avgK9));
    const avgBB9 = mean(eraStats.map(s => s.avgBB9));
    const avgHR9 = mean(eraStats.map(s => s.avgHR9));
    const avgFIP = mean(eraStats.map(s => s.avgFIP));
    const avgERA = mean(eraStats.map(s => s.avgERA));

    console.log(
      `${era.name.padEnd(9)} ${era.start}-${era.end}`.padEnd(20) +
      `${avgK9.toFixed(2)}  ${avgBB9.toFixed(2)}  ${avgHR9.toFixed(2)}  ${avgFIP.toFixed(2)}  ${avgERA.toFixed(2)}`
    );
  }

  console.log('\n\n💡 Recommendations:');
  console.log('=' .repeat(80));
  console.log('1. Use OOTP 26 data (2018-2021) for current projections');
  console.log('2. If sample size is insufficient, consider using OOTP 25 (2014-2017)');
  console.log('3. Check if stat patterns are consistent within each era');
  console.log('4. If patterns differ significantly, use only most recent era\n');

  console.log('✅ Analysis complete!\n');
}

detectEras().catch(console.error);
