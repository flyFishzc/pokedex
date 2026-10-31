/**
 * Cloudflare Worker — 宝可梦大全后端代理
 * - /api/*     → 转发 PokéAPI（https://pokeapi.co/api/v2）
 * - /sprites/* → 转发精灵图 CDN（jsDelivr，失败回退 raw.githubusercontent）
 * - 其余路径由静态资源直接托管（见 wrangler.jsonc 的 assets 配置）
 * 使用 Cache API 做边缘缓存（7 天），免费额度 10 万请求/天，无需信用卡。
 */
const PROXIES = {
  '/api/': ['https://pokeapi.co/api/v2'],
  '/sprites/': [
    'https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon',
    'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon'
  ]
};

const TTL = 7 * 24 * 3600; // 秒

export default {
  async fetch(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const prefix = Object.keys(PROXIES).find((p) => path.startsWith(p));

    // 非代理路径交给静态资源（run_worker_first 已限定 /api 与 /sprites，这里兜底）
    if (!prefix) return fetch(request);

    const rest = path.slice(prefix.length - 1); // 保留开头斜杠
    const query = url.search;
    const cache = caches.default;
    let lastErr = null;

    for (const base of PROXIES[prefix]) {
      const target = base + rest + query;
      try {
        // 1) 边缘缓存命中直接返回
        const hit = await cache.match(new Request(target));
        if (hit) {
          const res = new Response(hit.body, hit);
          res.headers.set('X-Cache', 'HIT');
          return res;
        }

        // 2) 回源（jsDelivr 失败自动回退 raw.githubusercontent）
        const upstream = await fetch(target, {
          headers: { 'User-Agent': 'pokedex-cf/1.0' },
          cf: { cacheTtl: TTL, cacheEverything: true }
        });
        if (!upstream.ok) { lastErr = new Error('HTTP ' + upstream.status); continue; }

        const res = new Response(upstream.body, upstream);
        res.headers.set('Cache-Control', `public, max-age=${TTL}`);
        res.headers.set('X-Cache', 'MISS');
        if (request.method === 'GET') {
          await cache.put(new Request(target), res.clone());
        }
        return res;
      } catch (e) {
        lastErr = e;
      }
    }

    return new Response('Bad gateway: ' + (lastErr && lastErr.message), {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
};
