// Serverless price aggregator for Vercel
// Caches CoinGecko responses in-memory for a short TTL to reduce external requests.

const CACHE_TTL = 10 * 1000; // 10 seconds
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3/simple/price';

// Simple in-memory cache stored in module scope (persists across invocations on warm functions)
const cache = {
  // key: ids string -> { ts: Date.now(), data: {...} }
};

async function fetchFromCoinGecko(ids) {
  const url = `${COINGECKO_BASE}?ids=${encodeURIComponent(ids)}&vs_currencies=usd`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`CoinGecko responded ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  // normalize keys to lowercase and map to usd value
  const normalized = Object.fromEntries(Object.entries(json).map(([k, v]) => [k.toLowerCase(), v.usd]));
  return normalized;
}

export default async function handler(req, res) {
  try {
    const idsParam = (req.query.ids || '').toString();
    if (!idsParam) return res.status(400).json({ error: 'missing ids query param' });

    // normalize ids list
    const ids = idsParam.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (ids.length === 0) return res.status(400).json({ error: 'no valid ids' });

    const key = ids.join(',');
    const entry = cache[key];
    if (entry && (Date.now() - entry.ts) < CACHE_TTL) {
      return res.status(200).json({ source: 'cache', data: entry.data });
    }

    // fetch fresh
    try {
      const data = await fetchFromCoinGecko(key);
      cache[key] = { ts: Date.now(), data };
      return res.status(200).json({ source: 'coingecko', data });
    } catch (err) {
      // If CoinGecko rate-limited, try to return stale cache if available
      if (err.status === 429 && entry && entry.data) {
        return res.status(200).json({ source: 'stale-cache', data: entry.data, warning: 'rate_limited' });
      }
      console.error('Price aggregator error:', err);
      return res.status(err.status || 500).json({ error: err.message || 'failed' });
    }
  } catch (e) {
    console.error('Aggregator handler error', e);
    res.status(500).json({ error: e.message });
  }
}
