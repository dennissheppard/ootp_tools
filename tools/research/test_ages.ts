/**
 * Quick test script to verify age data loading
 */

import { loadPlayerDOBs, getPlayerAge, getPlayerSeasonAge, getAgeGroup } from './lib/playerAges';

async function testAges() {
  console.log('🧪 Testing Age Data Loading\n');

  // Load DOBs
  const dobs = loadPlayerDOBs();

  // Test some random players
  const testPlayerIds = Array.from(dobs.keys()).slice(0, 10);

  console.log('\n📊 Sample Player Ages (2020 season):');
  console.log('─'.repeat(80));
  console.log('Player ID  DOB         Age in 2020  Age Group');
  console.log('─'.repeat(80));

  for (const playerId of testPlayerIds) {
    const dob = dobs.get(playerId)!;
    const age2020 = getPlayerSeasonAge(playerId, 2020, dobs);
    const ageGroup = age2020 ? getAgeGroup(age2020) : 'Unknown';

    console.log(
      `${playerId.toString().padEnd(10)} ${dob.toISOString().split('T')[0]}  ${age2020?.toString().padEnd(11) ?? 'N/A'.padEnd(11)}  ${ageGroup}`
    );
  }

  // Statistics
  console.log('\n📈 Age Distribution Statistics:');
  console.log('─'.repeat(80));

  const ages2020 = Array.from(dobs.keys())
    .map(pid => getPlayerSeasonAge(pid, 2020, dobs))
    .filter((age): age is number => age !== undefined);

  const avgAge = ages2020.reduce((sum, age) => sum + age, 0) / ages2020.length;
  const minAge = Math.min(...ages2020);
  const maxAge = Math.max(...ages2020);

  console.log(`Total players with DOB: ${dobs.size}`);
  console.log(`Ages in 2020 season: ${ages2020.length}`);
  console.log(`Average age: ${avgAge.toFixed(1)} years`);
  console.log(`Age range: ${minAge} - ${maxAge} years`);

  // Age distribution
  const ageGroups = new Map<string, number>();
  for (const age of ages2020) {
    const group = getAgeGroup(age);
    ageGroups.set(group, (ageGroups.get(group) ?? 0) + 1);
  }

  console.log('\n📊 Age Group Distribution (2020):');
  console.log('─'.repeat(80));
  for (const [group, count] of ageGroups) {
    const pct = (count / ages2020.length * 100).toFixed(1);
    console.log(`${group.padEnd(30)} ${count.toString().padStart(5)} (${pct}%)`);
  }

  console.log('\n✅ Age data test complete!\n');
}

testAges().catch(console.error);
