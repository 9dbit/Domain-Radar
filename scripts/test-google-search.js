require('dotenv').config();
const axios = require('axios');

async function main() {
  const key = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX;
  const q = process.argv.slice(2).join(' ') || 'empire88';
  if (!key) throw new Error('GOOGLE_SEARCH_API_KEY is missing');
  if (!cx) throw new Error('GOOGLE_SEARCH_CX is missing');
  const { data } = await axios.get('https://www.googleapis.com/customsearch/v1', {
    timeout: 25000,
    params: { key, cx, q, start: 1, num: 10 }
  });
  console.log(JSON.stringify({
    ok: true,
    query: q,
    count: data.items?.length || 0,
    first_title: data.items?.[0]?.title || '',
    first_link: data.items?.[0]?.link || '',
    search_information: data.searchInformation || null
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.response?.data || err.message }, null, 2));
  process.exit(1);
});
