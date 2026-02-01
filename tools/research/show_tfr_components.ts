/**
 * Show TFR Components Breakdown
 *
 * Display how stuff/control/HRA blend into K9/BB9/HR9 projections
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Prospect {
  playerId: number;
  name: string;
  age: number;
  tfr: number;
  projFip: number;
  projWar: number;
  level: string;
  totalMinorIp: number;
}

function loadProspects(): Prospect[] {
  const filePath = path.join(__dirname, '../reports/tfr_prospects_2017.json');
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return data.prospects || [];
}

// Reverse-engineer rates from FIP
// FIP = ((13*HR9 + 3*BB9 - 2*K9) / 9) + 3.47
// We need to make assumptions about the distribution

function estimateRatesFromFIP(fip: number): { k9: number; bb9: number; hr9: number } {
  // Use league average ratios as baseline
  // MLB average roughly: K9=8.5, BB9=3.2, HR9=1.3

  // Better FIP = higher K9, lower BB9, lower HR9
  // Simplified model (not perfect but illustrative)

  const fipDiff = fip - 4.37; // Difference from league average

  // Scale rates based on FIP difference
  const k9 = 8.5 - (fipDiff * 0.8); // Better FIP = more Ks
  const bb9 = 3.2 + (fipDiff * 0.3); // Better FIP = fewer walks
  const hr9 = 1.3 + (fipDiff * 0.15); // Better FIP = fewer HRs

  return {
    k9: Math.max(2, Math.min(12, k9)),
    bb9: Math.max(1, Math.min(6, bb9)),
    hr9: Math.max(0.2, Math.min(2.5, hr9))
  };
}

function main() {
  const prospects = loadProspects();

  console.log('='.repeat(100));
  console.log('2017 Prospects - TFR Components Breakdown');
  console.log('='.repeat(100));
  console.log();
  console.log('Note: The current system does NOT track stuff/control/HRA separately.');
  console.log('It blends scouting + minors into a single FIP projection.');
  console.log('Below is a reverse-engineered estimate based on projected FIP.');
  console.log();
  console.log('─'.repeat(100));
  console.log(
    'Rank'.padEnd(6) +
    'Name'.padEnd(25) +
    'Age'.padEnd(5) +
    'TFR'.padEnd(6) +
    'IP'.padEnd(7) +
    'K/9'.padEnd(7) +
    'BB/9'.padEnd(7) +
    'HR/9'.padEnd(7) +
    'FIP'.padEnd(6)
  );
  console.log('─'.repeat(100));

  // Sort by TFR
  const sorted = [...prospects].sort((a, b) => b.tfr - a.tfr);

  // Show top 50
  for (let i = 0; i < Math.min(50, sorted.length); i++) {
    const p = sorted[i];
    const rates = estimateRatesFromFIP(p.projFip);

    console.log(
      `${(i + 1).toString().padEnd(6)}${
        p.name.substring(0, 24).padEnd(25)
      }${
        p.age.toString().padEnd(5)
      }${
        p.tfr.toFixed(1).padEnd(6)
      }${
        p.totalMinorIp.toFixed(0).padEnd(7)
      }${
        rates.k9.toFixed(2).padEnd(7)
      }${
        rates.bb9.toFixed(2).padEnd(7)
      }${
        rates.hr9.toFixed(2).padEnd(7)
      }${
        p.projFip.toFixed(2).padEnd(6)
      }`
    );
  }

  console.log('─'.repeat(100));
  console.log();

  // Show distribution
  console.log('Distribution of Projected Rates:');
  console.log();

  const allRates = prospects.map(p => estimateRatesFromFIP(p.projFip));
  allRates.sort((a, b) => b.k9 - a.k9);

  const percentiles = [0, 10, 25, 50, 75, 90, 100];

  console.log('K/9 Percentiles:');
  for (const pct of percentiles) {
    const idx = Math.floor((pct / 100) * (allRates.length - 1));
    console.log(`  ${pct.toString().padStart(3)}th: ${allRates[idx].k9.toFixed(2)}`);
  }
  console.log();

  allRates.sort((a, b) => a.bb9 - b.bb9);
  console.log('BB/9 Percentiles (lower is better):');
  for (const pct of percentiles) {
    const idx = Math.floor((pct / 100) * (allRates.length - 1));
    console.log(`  ${pct.toString().padStart(3)}th: ${allRates[idx].bb9.toFixed(2)}`);
  }
  console.log();

  allRates.sort((a, b) => a.hr9 - b.hr9);
  console.log('HR/9 Percentiles (lower is better):');
  for (const pct of percentiles) {
    const idx = Math.floor((pct / 100) * (allRates.length - 1));
    console.log(`  ${pct.toString().padStart(3)}th: ${allRates[idx].hr9.toFixed(2)}`);
  }
  console.log();

  console.log('='.repeat(100));
  console.log('KEY LIMITATION:');
  console.log('The current TFR system blends everything into ONE projection.');
  console.log('It does NOT separately track:');
  console.log('  - True Future Stuff (→ K/9)');
  console.log('  - True Future Control (→ BB/9)');
  console.log('  - True Future HRA (→ HR/9)');
  console.log();
  console.log('To properly implement percentile mapping, we need to:');
  console.log('  1. Blend scouting.stuff + minorLeague.k9 → Stuff Percentile');
  console.log('  2. Blend scouting.control + minorLeague.bb9 → Control Percentile');
  console.log('  3. Blend scouting.hra + minorLeague.hr9 → HRA Percentile');
  console.log('  4. Map each to MLB distributions SEPARATELY');
  console.log('  5. Then calculate FIP from the three component rates');
  console.log('='.repeat(100));
}

main();
