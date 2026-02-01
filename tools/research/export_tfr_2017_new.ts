/**
 * Export 2017 TFR Projections (NEW Algorithm)
 *
 * Exports 2017 prospect ratings using the rebuilt percentile-based algorithm.
 * This replaces the old confidence-factor approach with pure peak projections.
 *
 * Output: tools/reports/tfr_prospects_2017_new.json
 *
 * Usage: npx tsx tools/research/export_tfr_2017_new.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Import services (need to build paths for Node.js context)
import { trueFutureRatingService } from '../../src/services/TrueFutureRatingService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('='.repeat(70));
  console.log('TFR 2017 Export (NEW Percentile-Based Algorithm)');
  console.log('='.repeat(70));
  console.log();

  const YEAR = 2017;

  try {
    console.log(`Calculating TFR for ${YEAR} prospects...`);
    console.log();

    // Use the new algorithm to get TFR ratings
    const results = await trueFutureRatingService.getProspectTrueFutureRatings(YEAR);

    console.log(`✅ Calculated TFR for ${results.length} prospects`);
    console.log();

    // Find highest level for each prospect (for export)
    const resultsWithLevel = results.map(r => {
      // Determine level from their stats (simplified - just use highest level from description)
      let level = 'Unknown';
      if (r.totalMinorIp === 0) {
        level = 'No Stats';
      }
      // Note: We don't have level in the result anymore, would need to infer from input data
      // For now, just mark as calculated
      level = 'Calculated';

      return {
        playerId: r.playerId,
        name: r.playerName,
        age: r.age,
        level,
        tfr: r.trueFutureRating,
        tfrPercentile: r.percentile,
        stuffPercentile: r.stuffPercentile,
        controlPercentile: r.controlPercentile,
        hraPercentile: r.hraPercentile,
        projFip: r.projFip,
        projK9: r.projK9,
        projBb9: r.projBb9,
        projHr9: r.projHr9,
        totalMinorIp: r.totalMinorIp,
      };
    });

    // Distribution stats
    const distribution = {
      total: resultsWithLevel.length,
      elite_5_0: resultsWithLevel.filter(r => r.tfr >= 5.0).length,
      elite_4_5: resultsWithLevel.filter(r => r.tfr >= 4.5 && r.tfr < 5.0).length,
      star_4_0: resultsWithLevel.filter(r => r.tfr >= 4.0 && r.tfr < 4.5).length,
      aboveAvg_3_5: resultsWithLevel.filter(r => r.tfr >= 3.5 && r.tfr < 4.0).length,
      average_3_0: resultsWithLevel.filter(r => r.tfr >= 3.0 && r.tfr < 3.5).length,
      fringe_2_5: resultsWithLevel.filter(r => r.tfr >= 2.5 && r.tfr < 3.0).length,
      below_2_0: resultsWithLevel.filter(r => r.tfr < 2.5).length,
    };

    console.log('Distribution:');
    console.log(`  5.0 (Elite):      ${distribution.elite_5_0} (${(distribution.elite_5_0 / distribution.total * 100).toFixed(1)}%)`);
    console.log(`  4.5 (Star):       ${distribution.elite_4_5} (${(distribution.elite_4_5 / distribution.total * 100).toFixed(1)}%)`);
    console.log(`  4.0 (Above Avg):  ${distribution.star_4_0} (${(distribution.star_4_0 / distribution.total * 100).toFixed(1)}%)`);
    console.log(`  3.5 (Average):    ${distribution.aboveAvg_3_5} (${(distribution.aboveAvg_3_5 / distribution.total * 100).toFixed(1)}%)`);
    console.log(`  3.0 (Fringe):     ${distribution.average_3_0} (${(distribution.average_3_0 / distribution.total * 100).toFixed(1)}%)`);
    console.log(`  2.5 (Below Avg):  ${distribution.fringe_2_5} (${(distribution.fringe_2_5 / distribution.total * 100).toFixed(1)}%)`);
    console.log(`  <2.5:             ${distribution.below_2_0} (${(distribution.below_2_0 / distribution.total * 100).toFixed(1)}%)`);
    console.log();

    // Export to JSON
    const output = {
      algorithm: 'percentile-based (v2.0)',
      year: YEAR,
      generated: new Date().toISOString(),
      totalProspects: resultsWithLevel.length,
      distribution,
      prospects: resultsWithLevel.sort((a, b) => b.tfr - a.tfr), // Sort by TFR descending
    };

    const outputPath = path.join(__dirname, '../reports/tfr_prospects_2017_new.json');
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

    console.log(`💾 Exported to: ${path.basename(outputPath)}`);
    console.log();

    // Show top 10
    console.log('Top 10 Prospects:');
    console.log('─'.repeat(70));
    resultsWithLevel.slice(0, 10).forEach((p, i) => {
      console.log(`${i + 1}. ${p.name} (Age ${p.age})`);
      console.log(`   TFR: ${p.tfr.toFixed(1)} | Percentile: ${p.tfrPercentile.toFixed(1)}%`);
      console.log(`   Proj FIP: ${p.projFip.toFixed(2)} (K9: ${p.projK9.toFixed(2)}, BB9: ${p.projBb9.toFixed(2)}, HR9: ${p.projHr9.toFixed(2)})`);
      console.log(`   Total IP: ${p.totalMinorIp.toFixed(1)}`);
      console.log();
    });

    console.log('='.repeat(70));
    console.log('✅ Export Complete');
    console.log('='.repeat(70));

  } catch (error) {
    console.error('❌ Export failed:', error);
    process.exit(1);
  }
}

main();
