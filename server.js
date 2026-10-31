/**
 * 宝可梦大全 · 轻量后端代理 + 缓存
 * - 托管静态站点（index.html / styles.css / app.js ...）
 * - /api/*      → 转发 PokéAPI（https://pokeapi.co/api/v2），带缓存
 * - /sprites/*  → 转发 jsDelivr 精灵图 CDN，带缓存
 * 两级缓存：内存(Map) + 磁盘(.cache/)，按 TTL 复验；并发请求去重，避免缓存击穿。
 * 零第三方依赖，仅需 Node 18+。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const TTL = Number(process.env.CACHE_TTL) || 7 * 24 * 3600 * 1000; // 默认缓存 7 天
const CLEAR_TOKEN = process.env.CLEAR_TOKEN || '';
const CACHE_DIR = path.join(__dirname, '.cache');
const PUBLIC_DIR = __dirname;

// 仅允许代理到这些白名单主机，避免成为开放代理
// api 单一源；sprites 配置主源 + 备用源（某个 CDN 不可达时自动回退）
const PROXIES = {
  '/api/': { bases: ['https://pokeapi.co/api/v2'] },
  '/sprites/': {
    bases: [
      'https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon',
      'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon'
    ]
  }
};

const memCache = new Map();   // key -> { data: Buffer, type: string, time: number }
const inflight = new Map();   // key -> Promise（并发去重）

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

function cacheFile(key) {
  const hash = crypto.createHash('sha1').update(key).digest('hex');
  return path.join(CACHE_DIR, hash + '.bin');
}

async function cachedFetch(url) {
  // 1) 内存
  const mem = memCache.get(url);
  if (mem && Date.now() - mem.time < TTL) return mem;

  // 2) 磁盘
  const file = cacheFile(url);
  try {
    const st = await fsp.stat(file);
    if (Date.now() - st.mtimeMs < TTL) {
      const data = await fsp.readFile(file);
      const type = memCache.get(url)?.type || guessType(url);
      const rec = { data, type, time: st.mtimeMs };
      memCache.set(url, rec);
      return rec;
    }
  } catch { /* 未命中 */ }

  // 3) 网络（并发去重）
  if (inflight.has(url)) return inflight.get(url);
  const p = (async () => {
    const resp = await fetch(url, {
      headers: { 'Accept': '*/*', 'User-Agent': 'pokedex-proxy/1.0 (+https://github.com)' }
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = Buffer.from(await resp.arrayBuffer());
    await fsp.mkdir(CACHE_DIR, { recursive: true });
    const type = resp.headers.get('content-type') || guessType(url);
    await fsp.writeFile(file, data);
    const rec = { data, type, time: Date.now() };
    memCache.set(url, rec);
    return rec;
  })();
  inflight.set(url, p);
  try { return await p; } finally { inflight.delete(url); }
}

function guessType(url) {
  if (url.includes('/api/') || url.endsWith('.json')) return 'application/json; charset=utf-8';
  const ext = path.extname(new URL(url).pathname);
  return MIME[ext] || 'application/octet-stream';
}

function sendProxy(req, res, prefix, rest, rawQuery) {
  const cfg = PROXIES[prefix];
  fetchFirst(cfg.bases, rest, rawQuery).then(({ data, type }) => {
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'public, max-age=3600'
    });
    res.end(data);
  }).catch((err) => {
    console.error('proxy error:', prefix + rest, err && err.message);
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad gateway');
  });
}

/** 依次尝试多个上游源，任一成功即返回（用于精灵图回退） */
async function fetchFirst(bases, rest, rawQuery) {
  let lastErr;
  for (const base of bases) {
    const target = base + rest + (rawQuery ? '?' + rawQuery : '');
    try { return await cachedFetch(target); } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

function sendFile(res, filePath) {
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const type = MIME[path.extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size });
    fs.createReadStream(filePath).pipe(res);
  });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      // SPA 兜底：未知路径回退到首页（本站用哈希路由，真实页面只有 /）
      sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
      return;
    }
    sendFile(res, filePath);
  });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const pathname = u.pathname;
  const rawQuery = u.search.replace(/^\?/, '');

  // 缓存清理接口：GET /admin/clear?token=xxx
  if (pathname === '/admin/clear') {
    if (!CLEAR_TOKEN || rawQuery.split('&').map(s => s.split('=')).find(([k]) => k === 'token')?.[1] !== CLEAR_TOKEN) {
      res.writeHead(401); res.end('Unauthorized'); return;
    }
    fsp.rm(CACHE_DIR, { recursive: true, force: true }).then(() => {
      memCache.clear();
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Cache cleared');
    });
    return;
  }

  const prefix = Object.keys(PROXIES).find((p) => pathname.startsWith(p));
  if (prefix) {
    sendProxy(req, res, prefix, pathname.slice(prefix.length - 1), rawQuery);
    return;
  }
  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`✅ 宝可梦大全服务已启动： http://localhost:${PORT}`);
  console.log(`   代理： /api → ${PROXIES['/api/'].bases[0]}`);
  console.log(`          /sprites → ${PROXIES['/sprites/'].bases[0]} （含 ${PROXIES['/sprites/'].bases.length - 1} 个备用源）`);
  console.log(`   缓存目录： ${CACHE_DIR}（TTL ${Math.round(TTL / 86400000)} 天）`);
});
