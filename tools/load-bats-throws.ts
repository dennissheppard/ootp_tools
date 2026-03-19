/**
 * One-time script: load bats/throws from CSV into Supabase players table.
 *
 * Prerequisites: run migrate-009-bats-throws.sql first.
 * Usage: npx tsx tools/load-bats-throws.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { supabaseUpsertBatches } from './lib/supabase-client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const csvPath = path.join(__dirname, '..', 'public', 'data', 'id_bats_throws.csv');
  const text = fs.readFileSync(csvPath, 'utf-8');
  const lines = text.trim().split(/\r?\n/);

  // Skip header: ID,B,T
  const rows: { id: number; bats: string; throws: string }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 3) continue;
    const id = parseInt(parts[0], 10);
    const bats = parts[1].trim();
    const throws = parts[2].trim();
    if (!id || !bats || !throws) continue;
    rows.push({ id, bats, throws });
  }

  console.log(`Parsed ${rows.length} players from CSV`);

  // Upsert in batches (players table PK = id)
  const count = await supabaseUpsertBatches('players', rows, 500, 'id');
  console.log(`Updated ${count} players with bats/throws`);
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
