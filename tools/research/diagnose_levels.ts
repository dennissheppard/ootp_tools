import * as fs from 'fs';
import * as path from 'path';

const data = JSON.parse(fs.readFileSync('tools/reports/tfr_prospects_2020.json', 'utf-8'));
const prospects = data.prospects;

// Group by level
const byLevel = {
  'AAA': prospects.filter((p: any) => p.level.includes('AAA')),
  'AA': prospects.filter((p: any) => p.level.includes('AA') && !p.level.includes('AAA')),
  'A': prospects.filter((p: any) => p.level.includes('A') && !p.level.includes('AA')),
  'Rookie': prospects.filter((p: any) => p.level.toLowerCase().includes('rookie') || p.level.includes('R-'))
};

console.log('================================================================================');
console.log('PROSPECTS BY LEVEL');
console.log('================================================================================\n');
console.log('AAA:', byLevel.AAA.length);
console.log('AA:', byLevel.AA.length);
console.log('A:', byLevel.A.length);
console.log('Rookie:', byLevel.Rookie.length);

console.log('\n================================================================================');
console.log('TOP 10 A-BALL PROSPECTS (by peak FIP)');
console.log('================================================================================\n');
byLevel.A.sort((a: any, b: any) => a.projFip - b.projFip).slice(0, 10).forEach((p: any, i: number) => {
  console.log(`  ${i+1}. ${p.name.padEnd(25)} Age ${p.age}, Peak FIP: ${p.projFip.toFixed(2)}, TFR: ${p.tfr}, IP: ${p.totalMinorIp}`);
});

console.log('\n================================================================================');
console.log('TOP 10 ROOKIE PROSPECTS (by peak FIP)');
console.log('================================================================================\n');
byLevel.Rookie.sort((a: any, b: any) => a.projFip - b.projFip).slice(0, 10).forEach((p: any, i: number) => {
  console.log(`  ${i+1}. ${p.name.padEnd(25)} Age ${p.age}, Peak FIP: ${p.projFip.toFixed(2)}, TFR: ${p.tfr}, IP: ${p.totalMinorIp}`);
});

console.log('\n================================================================================');
console.log('TOP 10 OVERALL (by peak FIP)');
console.log('================================================================================\n');
prospects.sort((a: any, b: any) => a.projFip - b.projFip).slice(0, 10).forEach((p: any, i: number) => {
  console.log(`  ${i+1}. ${p.name.padEnd(25)} Age ${p.age}, Level ${p.level.padEnd(6)}, Peak FIP: ${p.projFip.toFixed(2)}, TFR: ${p.tfr}`);
});

console.log('\n================================================================================');
console.log('TOP 10 OVERALL (by TFR)');
console.log('================================================================================\n');
prospects.sort((a: any, b: any) => b.tfr - a.tfr).slice(0, 10).forEach((p: any, i: number) => {
  console.log(`  ${i+1}. ${p.name.padEnd(25)} Age ${p.age}, Level ${p.level.padEnd(6)}, Peak FIP: ${p.projFip.toFixed(2)}, TFR: ${p.tfr}`);
});

// Check best A/Rookie vs 100th best overall
const top100ByTfr = prospects.sort((a: any, b: any) => b.tfr - a.tfr).slice(0, 100);
const rank100 = top100ByTfr[99];

const bestA = byLevel.A.sort((a: any, b: any) => b.tfr - a.tfr)[0];
const bestRookie = byLevel.Rookie.sort((a: any, b: any) => b.tfr - a.tfr)[0];

console.log('\n================================================================================');
console.log('COMPARISON');
console.log('================================================================================\n');
console.log(`100th best overall: ${rank100.name} (${rank100.level}) - Peak FIP: ${rank100.projFip.toFixed(2)}, TFR: ${rank100.tfr}`);
console.log(`Best A-ball:        ${bestA.name} (${bestA.level}) - Peak FIP: ${bestA.projFip.toFixed(2)}, TFR: ${bestA.tfr}`);
console.log(`Best Rookie:        ${bestRookie.name} (${bestRookie.level}) - Peak FIP: ${bestRookie.projFip.toFixed(2)}, TFR: ${bestRookie.tfr}`);
console.log(`\nGap: 100th overall has ${(rank100.projFip - bestA.projFip).toFixed(2)} better FIP than best A-ball`);
console.log(`Gap: 100th overall has ${(rank100.projFip - bestRookie.projFip).toFixed(2)} better FIP than best Rookie`);
