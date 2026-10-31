/**
 * Cloudflare Pages Functions — 代理 /api 与 /sprites
 * 静态资源由 Pages 直接托管；未命中静态文件的路径（如 /api/xxx）才会进入本函数。
 * 使用 Cache API 做边缘缓存（默认 7 天），无需信用卡，免费额度 10 万请求/天。
 */
const PROXIES = {
  '/api/': ['https://pokeapi.co/api/v2'],
  '/sprites/': [
    'https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon',
    'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon'
  ]
};

const TTL = 7 * 24 * 3600; // 秒

export async function onRequest({ request, params }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(request.url);
  const route = '/' + (params.route || []).join('/');
  const prefix = Object.keys(PROXIES).find((p) => route.startsWith(p));
  if (!prefix) return new Response('Not found', { status: 404 });

  const rest = route.slice(prefix.length - 1); // 保留开头斜杠
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
      // 写入边缘缓存（clone 一份再返回）
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
