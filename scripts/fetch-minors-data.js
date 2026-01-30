/**
 * Fetch all historical MLB and minor league data from StatsPlus API and save as CSV files
 * Run with: node scripts/fetch-minors-data.js
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATSPLUS_BASE_URL = 'https://atl-01.statsplus.net/world';
const LEAGUE_START_YEAR = 2000;
const MINORS_OUTPUT_DIR = path.join(__dirname, '..', 'public', 'data', 'minors');
const MLB_OUTPUT_DIR = path.join(__dirname, '..', 'public', 'data', 'mlb');

// League IDs: 201=AAA, 202=AA, 203=A, 204=Rookie
const LEVELS = [
  { name: 'aaa', lid: 201 },
  { name: 'aa', lid: 202 },
  { name: 'a', lid: 203 },
  { name: 'r', lid: 204 }
];

// Get current year (or hardcode if you know the current league year)
const CURRENT_YEAR = new Date().getFullYear();

async function fetchCsv(year, level) {
  const url = `${STATSPLUS_BASE_URL}/api/playerpitchstatsv2/?year=${year}&lid=${level.lid}&split=1`;

  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchMlbCsv(year) {
  const url = `${STATSPLUS_BASE_URL}/api/playerpitchstatsv2/?year=${year}&split=1`;

  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

async function main() {
  // Create output directories
  if (!fs.existsSync(MINORS_OUTPUT_DIR)) {
    fs.mkdirSync(MINORS_OUTPUT_DIR, { recursive: true });
    console.log(`📁 Created directory: ${MINORS_OUTPUT_DIR}`);
  }
  if (!fs.existsSync(MLB_OUTPUT_DIR)) {
    fs.mkdirSync(MLB_OUTPUT_DIR, { recursive: true });
    console.log(`📁 Created directory: ${MLB_OUTPUT_DIR}`);
  }

  const yearCount = CURRENT_YEAR - LEAGUE_START_YEAR + 1;
  const mlbFetches = yearCount;
  const milbFetches = yearCount * LEVELS.length;
  const totalFetches = mlbFetches + milbFetches;
  let fetchedCount = 0;
  let errorCount = 0;

  console.log(`\n🏁 Starting fetch of ${totalFetches} datasets (${LEAGUE_START_YEAR}-${CURRENT_YEAR})`);
  console.log(`   - ${mlbFetches} MLB datasets`);
  console.log(`   - ${milbFetches} MiLB datasets\n`);

  // Fetch MLB data first
  console.log('📊 Fetching MLB data...\n');
  for (let year = LEAGUE_START_YEAR; year <= CURRENT_YEAR; year++) {
    try {
      const filename = `${year}.csv`;
      const filepath = path.join(MLB_OUTPUT_DIR, filename);

      // Check if file already exists
      if (fs.existsSync(filepath)) {
        console.log(`⏭️  Skipping MLB ${year} (already exists)`);
        fetchedCount++;
        continue;
      }

      console.log(`📥 Fetching MLB ${year}... (${fetchedCount + 1}/${totalFetches})`);

      const csv = await fetchMlbCsv(year);

      // Save to file
      fs.writeFileSync(filepath, csv, 'utf8');

      const sizeKB = (csv.length / 1024).toFixed(1);
      console.log(`   ✅ Saved ${filename} (${sizeKB} KB)`);

      fetchedCount++;

      // Rate limiting - 250ms delay between requests
      if (fetchedCount < totalFetches) {
        await delay(250);
      }
    } catch (error) {
      errorCount++;
      console.error(`   ❌ Failed MLB ${year}: ${error.message}`);
    }
  }

  // Fetch minor league data
  console.log('\n📊 Fetching Minor League data...\n');
  for (let year = LEAGUE_START_YEAR; year <= CURRENT_YEAR; year++) {
    for (const level of LEVELS) {
      try {
        const filename = `${year}_${level.name}.csv`;
        const filepath = path.join(MINORS_OUTPUT_DIR, filename);

        // Check if file already exists
        if (fs.existsSync(filepath)) {
          console.log(`⏭️  Skipping ${filename} (already exists)`);
          fetchedCount++;
          continue;
        }

        console.log(`📥 Fetching ${level.name.toUpperCase()} ${year}... (${fetchedCount + 1}/${totalFetches})`);

        const csv = await fetchCsv(year, level);

        // Save to file
        fs.writeFileSync(filepath, csv, 'utf8');

        const sizeKB = (csv.length / 1024).toFixed(1);
        console.log(`   ✅ Saved ${filename} (${sizeKB} KB)`);

        fetchedCount++;

        // Rate limiting - 250ms delay between requests
        if (fetchedCount < totalFetches) {
          await delay(250);
        }
      } catch (error) {
        errorCount++;
        console.error(`   ❌ Failed ${level.name.toUpperCase()} ${year}: ${error.message}`);
        // Continue with next file
      }
    }
  }

  console.log(`\n🎉 Complete!`);
  console.log(`   ✅ Success: ${fetchedCount - errorCount} files`);
  console.log(`   ❌ Errors: ${errorCount} files`);

  // Calculate total size
  const mlbFiles = fs.existsSync(MLB_OUTPUT_DIR) ? fs.readdirSync(MLB_OUTPUT_DIR) : [];
  const milbFiles = fs.existsSync(MINORS_OUTPUT_DIR) ? fs.readdirSync(MINORS_OUTPUT_DIR) : [];
  let totalSize = 0;

  mlbFiles.forEach(file => {
    const stats = fs.statSync(path.join(MLB_OUTPUT_DIR, file));
    totalSize += stats.size;
  });

  milbFiles.forEach(file => {
    const stats = fs.statSync(path.join(MINORS_OUTPUT_DIR, file));
    totalSize += stats.size;
  });

  const totalMB = (totalSize / 1024 / 1024).toFixed(2);
  console.log(`   📦 Total size: ${totalMB} MB (${mlbFiles.length + milbFiles.length} files)`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
