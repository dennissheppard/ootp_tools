/**
 * Fetch all historical MLB and minor league data from StatsPlus API and save as CSV files
 * Fetches both pitching and batting stats.
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

// Pitching data directories
const MINORS_OUTPUT_DIR = path.join(__dirname, '..', 'public', 'data', 'minors');
const MLB_OUTPUT_DIR = path.join(__dirname, '..', 'public', 'data', 'mlb');

// Batting data directories
const MINORS_BATTING_OUTPUT_DIR = path.join(__dirname, '..', 'public', 'data', 'minors_batting');
const MLB_BATTING_OUTPUT_DIR = path.join(__dirname, '..', 'public', 'data', 'mlb_batting');

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

// Batting stats fetch functions
async function fetchBattingCsv(year, level) {
  const url = `${STATSPLUS_BASE_URL}/api/playerbatstatsv2/?year=${year}&lid=${level.lid}&split=1`;

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

async function fetchMlbBattingCsv(year) {
  const url = `${STATSPLUS_BASE_URL}/api/playerbatstatsv2/?year=${year}&split=1`;

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
  // Create output directories for pitching
  if (!fs.existsSync(MINORS_OUTPUT_DIR)) {
    fs.mkdirSync(MINORS_OUTPUT_DIR, { recursive: true });
    console.log(`📁 Created directory: ${MINORS_OUTPUT_DIR}`);
  }
  if (!fs.existsSync(MLB_OUTPUT_DIR)) {
    fs.mkdirSync(MLB_OUTPUT_DIR, { recursive: true });
    console.log(`📁 Created directory: ${MLB_OUTPUT_DIR}`);
  }

  // Create output directories for batting
  if (!fs.existsSync(MINORS_BATTING_OUTPUT_DIR)) {
    fs.mkdirSync(MINORS_BATTING_OUTPUT_DIR, { recursive: true });
    console.log(`📁 Created directory: ${MINORS_BATTING_OUTPUT_DIR}`);
  }
  if (!fs.existsSync(MLB_BATTING_OUTPUT_DIR)) {
    fs.mkdirSync(MLB_BATTING_OUTPUT_DIR, { recursive: true });
    console.log(`📁 Created directory: ${MLB_BATTING_OUTPUT_DIR}`);
  }

  const yearCount = CURRENT_YEAR - LEAGUE_START_YEAR + 1;
  const mlbPitchingFetches = yearCount;
  const milbPitchingFetches = yearCount * LEVELS.length;
  const mlbBattingFetches = yearCount;
  const milbBattingFetches = yearCount * LEVELS.length;
  const totalFetches = mlbPitchingFetches + milbPitchingFetches + mlbBattingFetches + milbBattingFetches;
  let fetchedCount = 0;
  let errorCount = 0;

  console.log(`\n🏁 Starting fetch of ${totalFetches} datasets (${LEAGUE_START_YEAR}-${CURRENT_YEAR})`);
  console.log(`   Pitching:`);
  console.log(`   - ${mlbPitchingFetches} MLB datasets`);
  console.log(`   - ${milbPitchingFetches} MiLB datasets`);
  console.log(`   Batting:`);
  console.log(`   - ${mlbBattingFetches} MLB datasets`);
  console.log(`   - ${milbBattingFetches} MiLB datasets\n`);

  // Fetch MLB pitching data first
  console.log('📊 Fetching MLB pitching data...\n');
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

  // Fetch minor league pitching data
  console.log('\n📊 Fetching Minor League pitching data...\n');
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

  // Fetch MLB batting data
  console.log('\n📊 Fetching MLB batting data...\n');
  for (let year = LEAGUE_START_YEAR; year <= CURRENT_YEAR; year++) {
    try {
      const filename = `${year}_batting.csv`;
      const filepath = path.join(MLB_BATTING_OUTPUT_DIR, filename);

      // Check if file already exists
      if (fs.existsSync(filepath)) {
        console.log(`⏭️  Skipping MLB batting ${year} (already exists)`);
        fetchedCount++;
        continue;
      }

      console.log(`📥 Fetching MLB batting ${year}... (${fetchedCount + 1}/${totalFetches})`);

      const csv = await fetchMlbBattingCsv(year);

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
      console.error(`   ❌ Failed MLB batting ${year}: ${error.message}`);
    }
  }

  // Fetch minor league batting data
  console.log('\n📊 Fetching Minor League batting data...\n');
  for (let year = LEAGUE_START_YEAR; year <= CURRENT_YEAR; year++) {
    for (const level of LEVELS) {
      try {
        const filename = `${year}_${level.name}_batting.csv`;
        const filepath = path.join(MINORS_BATTING_OUTPUT_DIR, filename);

        // Check if file already exists
        if (fs.existsSync(filepath)) {
          console.log(`⏭️  Skipping ${filename} (already exists)`);
          fetchedCount++;
          continue;
        }

        console.log(`📥 Fetching ${level.name.toUpperCase()} batting ${year}... (${fetchedCount + 1}/${totalFetches})`);

        const csv = await fetchBattingCsv(year, level);

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
        console.error(`   ❌ Failed ${level.name.toUpperCase()} batting ${year}: ${error.message}`);
        // Continue with next file
      }
    }
  }

  console.log(`\n🎉 Complete!`);
  console.log(`   ✅ Success: ${fetchedCount - errorCount} files`);
  console.log(`   ❌ Errors: ${errorCount} files`);

  // Calculate total size
  const mlbPitchingFiles = fs.existsSync(MLB_OUTPUT_DIR) ? fs.readdirSync(MLB_OUTPUT_DIR) : [];
  const milbPitchingFiles = fs.existsSync(MINORS_OUTPUT_DIR) ? fs.readdirSync(MINORS_OUTPUT_DIR) : [];
  const mlbBattingFiles = fs.existsSync(MLB_BATTING_OUTPUT_DIR) ? fs.readdirSync(MLB_BATTING_OUTPUT_DIR) : [];
  const milbBattingFiles = fs.existsSync(MINORS_BATTING_OUTPUT_DIR) ? fs.readdirSync(MINORS_BATTING_OUTPUT_DIR) : [];
  let totalSize = 0;

  mlbPitchingFiles.forEach(file => {
    const stats = fs.statSync(path.join(MLB_OUTPUT_DIR, file));
    totalSize += stats.size;
  });

  milbPitchingFiles.forEach(file => {
    const stats = fs.statSync(path.join(MINORS_OUTPUT_DIR, file));
    totalSize += stats.size;
  });

  mlbBattingFiles.forEach(file => {
    const stats = fs.statSync(path.join(MLB_BATTING_OUTPUT_DIR, file));
    totalSize += stats.size;
  });

  milbBattingFiles.forEach(file => {
    const stats = fs.statSync(path.join(MINORS_BATTING_OUTPUT_DIR, file));
    totalSize += stats.size;
  });

  const totalFiles = mlbPitchingFiles.length + milbPitchingFiles.length + mlbBattingFiles.length + milbBattingFiles.length;
  const totalMB = (totalSize / 1024 / 1024).toFixed(2);
  console.log(`   📦 Total size: ${totalMB} MB (${totalFiles} files)`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
