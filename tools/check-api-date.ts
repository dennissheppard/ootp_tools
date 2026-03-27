import { wblFetchJson } from './lib/wbl-api-client';
async function main() {
  const data = await wblFetchJson<any>('/api/date');
  console.log(JSON.stringify(data, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
