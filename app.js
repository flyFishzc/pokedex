/* 宝可梦大全 · 数据来自 https://pokeapi.co */
(() => {
  'use strict';

  // 默认指向同源后端代理（由 server.js 转发 PokéAPI），部署后无需改配置
  const API = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? '/api'
    : (window.__API__ || '/api');
  const PAGE_SIZE = 24;

  const TYPE_ZH = {
    normal: '一般', fighting: '格斗', flying: '飞行', poison: '毒', ground: '地面',
    rock: '岩石', bug: '虫', ghost: '幽灵', steel: '钢', fire: '火', water: '水',
    grass: '草', electric: '电', psychic: '超能力', ice: '冰', dragon: '龙',
    dark: '恶', fairy: '妖精', stellar: '太晶', unknown: '未知'
  };
  const TYPE_COLOR = {
    normal: '#9ca3af', fighting: '#c03028', flying: '#8fa8de', poison: '#a040a0',
    ground: '#d8a058', rock: '#b8a068', bug: '#a8b820', ghost: '#705898',
    steel: '#8f9eb0', fire: '#f08030', water: '#4a90d9', grass: '#63bc5a',
    electric: '#f2c94c', psychic: '#f06ea9', ice: '#74d3f2', dragon: '#7c6ff0',
    dark: '#5a5466', fairy: '#ee8fe6', stellar: '#b57cf5', unknown: '#8a8f98'
  };
  const STAT_ZH = {
    hp: 'HP', attack: '攻击', defense: '防御',
    'special-attack': '特攻', 'special-defense': '特防', speed: '速度'
  };
  const TYPE_ORDER = ['normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting',
    'poison', 'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon',
    'dark', 'steel', 'fairy'];

  /* ---------- 本地存储 ---------- */
  const store = {
    get(key, fallback = null) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
      catch { return fallback; }
    },
    set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* 忽略 */ } }
  };

  let favorites = new Set(store.get('pokedex:favs', []));

  /* ---------- 状态 ---------- */
  const state = {
    index: [],           // 全量 [{id, name}]
    typeMembers: null,   // 当前属性筛选下的 id 集合
    list: [],            // 过滤后的完整结果
    shown: 0,
    query: '',
    searchMode: 'name',
    type: 'all',
    sort: 'id',
    onlyFav: false,
    loading: false,
    current: -1          // 弹窗中当前宝可梦在 list 中的下标
  };

  const cache = { pokemon: new Map(), species: new Map(), type: new Map(), zhName: new Map() };
  let lastRadar = null; // 主题切换时重绘雷达图
  const $ = (s) => document.querySelector(s);
  const el = {
    grid: $('#grid'), search: $('#search'), sort: $('#sort'), typeBar: $('#typeBar'),
    loadMore: $('#loadMore'), sentinel: $('#sentinel'), resultCount: $('#resultCount'),
    empty: $('#empty'), modal: $('#modal'), modalBody: $('#modalBody'),
    favToggle: $('#favToggle'), favCount: $('#favCount'), toast: $('#toast'),
    loadingTip: $('#loadingTip'),
    modeSeg: $('#modeSeg'), descPanel: $('#descPanel'), descBar: $('#descBar'),
    buildIndex: $('#buildIndex'), cancelBuild: $('#cancelBuild'), buildStatus: $('#buildStatus')
  };

  /* ---------- 描述搜索索引 ---------- */
  // 中文/英文属性同义词，用于把描述里的「会放电」「喷火」映射到属性
  const TYPE_SYN = {
    normal: ['一般', '普通', 'normal'], fire: ['火', '喷火', '燃烧', '火焰', 'fire', 'flame'],
    water: ['水', '游泳', '喷水', 'water', 'aqua'], electric: ['电', '闪电', '雷', '放电', 'electric', 'thunder'],
    grass: ['草', '植物', '叶', 'grass', 'plant', 'leaf'], ice: ['冰', '冰冻', '雪', 'ice', 'frozen'],
    fighting: ['格斗', '拳', 'fighting'], poison: ['毒', 'poison'],
    ground: ['地面', '土', '沙', 'ground', 'sand'], flying: ['飞', '翅膀', '天空', '鸟', 'fly', 'wing', 'bird'],
    psychic: ['超能力', '念力', 'psychic'], bug: ['虫', 'bug'],
    rock: ['岩石', '石', 'rock'], ghost: ['幽灵', '鬼', 'ghost'],
    dragon: ['龙', 'dragon'], dark: ['恶', 'dark'], steel: ['钢', '金属', 'steel', 'metal'],
    fairy: ['妖精', 'fairy']
  };
  // 常见动物/形态词，用于匹配分类（如「鼠宝可梦」「猫宝可梦」）
  const ANIMAL_WORDS = ['鼠', '猫', '狗', '犬', '鱼', '蛇', '鸟', '马', '龙', '龟', '兔', '狼',
    '狐', '猴', '蛙', '熊', '鹿', '虫', '猪', '鸡', '鸭', '蟹', '虾', '象', '虎', '狮', '羊',
    '牛', '蜻', '蝶', '甲', '花', '树', '草', '猴', '鲨', '鲸', '蝙'];

  let descIndex = store.get('pokedex:descIndex', null); // [{i,n,z,g,t,f}]
  let buildCancel = false;

  /* ---------- 网络 ---------- */
  async function fetchJSON(url, retry = 2) {
    for (let i = 0; i <= retry; i++) {
      try {
        const res = await fetch(url, { cache: 'force-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
      } catch (err) {
        if (i === retry) throw err;
        await new Promise((r) => setTimeout(r, 400 * (i + 1)));
      }
    }
  }

  async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let i = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        try { out[idx] = await fn(items[idx], idx); } catch { out[idx] = null; }
      }
    });
    await Promise.all(workers);
    return out;
  }

  const idFromUrl = (url) => Number(url.split('/').filter(Boolean).pop());
  const pad = (n) => '#' + String(n).padStart(4, '0');
  // 精灵图统一走同源代理 /sprites（server.js 转发 jsDelivr 并缓存），利于被墙地区访问
  const SPRITE_BASE = '/sprites';
  const sprite = (id) => `${SPRITE_BASE}/other/official-artwork/${id}.png`;
  const fallbackSprite = (id) => `${SPRITE_BASE}/${id}.png`;
  /** 列表卡片用轻量矢量图（体积远小于 PNG，解码更快） */
  const dreamSprite = (id) => `${SPRITE_BASE}/other/dream-world/${id}.svg`;
  const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const zhType = (t) => TYPE_ZH[t] || t;
  const colorOf = (t) => TYPE_COLOR[t] || '#8a8f98';

  function displayName(id, enName) {
    const zh = cache.zhName.get(id);
    return zh || enName.replace(/-/g, ' ');
  }

  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.toast.hidden = true; }, 2600);
  }

  /* ---------- 数据获取 ---------- */
  async function loadIndex() {
    const cached = store.get('pokedex:index');
    if (cached && Array.isArray(cached.data) && cached.data.length) {
      state.index = cached.data;
      return;
    }
    const data = await fetchJSON(`${API}/pokemon?limit=2000&offset=0`);
    state.index = data.results
      .map((r) => ({ id: idFromUrl(r.url), name: r.name }))
      .filter((p) => p.id > 0 && p.id < 20000)
      .sort((a, b) => a.id - b.id);
    store.set('pokedex:index', { time: Date.now(), data: state.index });
  }

  /** 带失败的缓存包装：失败不落缓存，避免一次网络抖动后永久失效 */
  function memo(map, key, task) {
    if (!map.has(key)) {
      map.set(key, task().catch((err) => { map.delete(key); throw err; }));
    }
    return map.get(key);
  }

  function getPokemon(id) {
    return memo(cache.pokemon, id, () => fetchJSON(`${API}/pokemon/${id}`));
  }

  function getSpecies(id) {
    return memo(cache.species, id, async () => {
      const s = await fetchJSON(`${API}/pokemon-species/${id}`);
      const zh = s.names.find((n) => n.language.name === 'zh-Hans');
      if (zh) cache.zhName.set(id, zh.name);
      return s;
    });
  }

  function getTypeDetail(name) {
    return memo(cache.type, name, () => fetchJSON(`${API}/type/${name}`));
  }

  /* ---------- 描述搜索 ---------- */
  async function buildTypeMap() {
    const data = await fetchJSON(`${API}/type?limit=30`);
    const details = await mapLimit(data.results, 6, (r) => fetchJSON(r.url).catch(() => null));
    const map = {}; // id -> [typeName]
    details.forEach((d) => {
      if (!d) return;
      d.pokemon.forEach((p) => {
        const id = idFromUrl(p.pokemon.url);
        (map[id] = map[id] || []).push(d.name);
      });
    });
    return map;
  }

  async function buildDescIndex() {
    buildCancel = false;
    el.buildIndex.hidden = true;
    el.cancelBuild.hidden = false;
    el.buildStatus.textContent = '准备中…';
    const typeMap = await buildTypeMap().catch(() => ({}));
    const all = state.index;
    const out = [];
    let done = 0;
    await mapLimit(all, 10, async (p) => {
      if (buildCancel) return;
      try {
        const s = await fetchJSON(`${API}/pokemon-species/${p.id}`);
        const zh = s.names.find((n) => n.language.name === 'zh-Hans');
        const genus = (s.genera || []).find((g) => g.language.name === 'zh-Hans');
        const fl = (s.flavor_text_entries || []).find((f) => f.language.name === 'zh-Hans')
          || (s.flavor_text_entries || []).find((f) => f.language.name === 'en');
        const flavor = (fl ? fl.flavor_text : '')
          .replace(/[\n\f\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
        out.push({
          i: p.id, n: p.name, z: zh ? zh.name : '',
          g: genus ? genus.genus : '', t: typeMap[p.id] || [], f: flavor
        });
      } catch { /* 忽略单条失败 */ }
      done++;
      el.descBar.style.width = ((done / all.length) * 100).toFixed(1) + '%';
      el.buildStatus.textContent = `${done} / ${all.length}`;
    });
    if (buildCancel) {
      el.buildIndex.hidden = false;
      el.cancelBuild.hidden = true;
      el.buildStatus.textContent = '已取消';
      return;
    }
    out.sort((a, b) => a.i - b.i);
    descIndex = out;
    store.set('pokedex:descIndex', out);
    el.buildIndex.hidden = false;
    el.cancelBuild.hidden = true;
    el.buildStatus.textContent = '索引就绪 ✓';
    if (state.query && state.searchMode === 'desc') { computeList(); renderNextPage(); }
  }

  function descSearch(raw) {
    const q = raw.trim();
    if (!q || !descIndex) return [];
    const needle = q.toLowerCase();
    const hits = [];
    for (const r of descIndex) {
      let s = 0;
      if (r.z && r.z.includes(q)) s += 60;
      if (r.n.toLowerCase().includes(needle)) s += 50;
      for (const t of (r.t || [])) {
        const syn = TYPE_SYN[t] || [];
        if (syn.some((k) => k.length > 1 && needle.includes(k.toLowerCase()))) s += 25;
      }
      for (const w of ANIMAL_WORDS) {
        if (q.includes(w) && r.g.includes(w)) { s += 18; break; }
      }
      if (r.f) {
        const fl = r.f.toLowerCase();
        if (fl.includes(needle)) s += 12;
        for (const t of (r.t || [])) {
          const syn = TYPE_SYN[t] || [];
          if (syn.some((k) => k.length > 2 && fl.includes(k.toLowerCase()))) s += 6;
        }
      }
      if (s > 0) hits.push({ id: r.i, s });
    }
    hits.sort((a, b) => b.s - a.s);
    return hits.map((h) => h.id);
  }

  /* 中文名按需懒加载：只对进入视口的卡片请求 species */
  const nameObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const node = entry.target;
        nameObserver.unobserve(node);
        loadZhName(Number(node.dataset.id));
      });
    }, { rootMargin: '240px' })
    : null;

  async function loadZhName(id) {
    if (cache.zhName.has(id) || !id) return;
    try {
      await getSpecies(id);
    } catch { return; }
    document.querySelectorAll(`.card[data-id="${id}"] .name-zh, .zh-of-${id}`).forEach((n) => {
      const en = n.dataset.en || '';
      n.textContent = displayName(id, en);
    });
  }

  /* ---------- 筛选 ---------- */
  async function applyTypeFilter(type) {
    state.type = type;
    document.querySelectorAll('.type-chip').forEach((c) =>
      c.classList.toggle('is-active', c.dataset.type === type));
    if (type === 'all') { state.typeMembers = null; return; }
    el.loadingTip.hidden = false;
    try {
      const data = await fetchJSON(`${API}/type/${type}`);
      state.typeMembers = new Set(data.pokemon.map((p) => idFromUrl(p.pokemon.url)));
    } catch {
      toast('属性数据加载失败，已显示全部');
      state.typeMembers = null;
    } finally {
      el.loadingTip.hidden = true;
    }
  }

  function computeList() {
    let list = state.index;
    if (state.typeMembers) list = list.filter((p) => state.typeMembers.has(p.id));
    if (state.onlyFav) list = list.filter((p) => favorites.has(p.id));
    const raw = state.query.trim();
    const q = raw.toLowerCase();
    if (q && state.searchMode === 'desc' && descIndex) {
      const scored = descSearch(raw);
      const byId = new Map(scored.map((id, i) => [id, i]));
      list = list.filter((p) => byId.has(p.id))
        .sort((a, b) => byId.get(a.id) - byId.get(b.id));
    } else if (q) {
      list = list.filter((p) => {
        if (String(p.id) === q || pad(p.id) === q) return true;
        if (p.name.includes(q)) return true;
        const zh = cache.zhName.get(p.id);
        return !!(zh && zh.includes(raw));
      });
    }
    if (state.sort === 'name' && state.searchMode !== 'desc') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    else if (state.sort === 'random') {
      const arr = [...list];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      list = arr;
    } else list = [...list].sort((a, b) => a.id - b.id);
    state.list = list;
    state.shown = 0;
    renderToken++;          // 作废仍在飞行中的渲染结果
    pending = [];
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    el.grid.innerHTML = '';
  }

  /* ---------- 渲染列表：流式占位 + rAF 批量上屏 ---------- */
  let renderToken = 0;
  let pending = [];
  let rafId = 0;

  function queueCard(data, slot, token) {
    pending.push({ data, slot, token });
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      const batch = pending;
      pending = [];
      batch.forEach(({ data, slot, token: tk }) => {
        if (tk !== renderToken || !slot.isConnected) return;
        const card = data ? buildCard(data) : buildFail();
        slot.parentNode.replaceChild(card, slot);
        state.shown++; // 失败也推进，避免反复重试同一批
        if (data && nameObserver) nameObserver.observe(card);
      });
      updateMetaThrottled();
    });
  }

  function updateMetaThrottled() {
    if (updateMetaThrottled._r) return;
    updateMetaThrottled._r = requestAnimationFrame(() => {
      updateMetaThrottled._r = 0;
      updateMeta();
    });
  }

  async function renderNextPage() {
    if (state.loading) return;
    const slice = state.list.slice(state.shown, state.shown + PAGE_SIZE);
    if (!slice.length) return;
    const token = renderToken;
    state.loading = true;
    el.loadMore.hidden = true;
    el.loadingTip.hidden = false;

    const frag = document.createDocumentFragment();
    const slots = slice.map(() => {
      const d = document.createElement('div');
      d.className = 'skeleton';
      frag.appendChild(d);
      return d;
    });
    el.grid.appendChild(frag);

    // 并发受限 + 逐个上屏：谁先到谁先替换骨架，避免一次性大量 DOM 写入
    let ok = 0;
    await mapLimit(slice, 6, async (p, i) => {
      let data = null;
      try { data = await getPokemon(p.id); } catch { /* 忽略 */ }
      if (token !== renderToken) return;
      if (data) ok++;
      queueCard(data, slots[i], token);
    });

    state.loading = false;
    if (token !== renderToken) return;   // 条件已变，交给新的渲染流程收尾
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    slots.forEach((s) => s.isConnected && s.remove());
    if (!ok) toast('加载失败，请检查网络后重试');
    el.loadingTip.hidden = true;
    updateMeta();
    el.loadMore.hidden = state.shown >= state.list.length;
    requestAnimationFrame(maybeLoadMore);
  }

  /** 容器没被撑高时 IntersectionObserver 不会再触发，这里补一次判断 */
  function maybeLoadMore() {
    if (state.loading || state.shown >= state.list.length) return;
    const rect = el.sentinel.getBoundingClientRect();
    if (rect.top < window.innerHeight + 180) renderNextPage();
  }

  function buildFail() {
    const d = document.createElement('div');
    d.className = 'card slot-fail';
    d.innerHTML = '<div class="no">加载失败</div>';
    return d;
  }

  function buildCard(p) {
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.id = p.id;
    const types = p.types.map((t) => t.type.name);
    card.style.setProperty('--card-glow', hexA(colorOf(types[0]), 0.35));
    card.innerHTML = `
      <button class="fav-btn ${favorites.has(p.id) ? 'on' : ''}" data-fav="${p.id}"
              aria-label="收藏">${favorites.has(p.id) ? '★' : '☆'}</button>
      <div class="no">${pad(p.id)}</div>
      <img loading="lazy" decoding="async" alt="${p.name}" />
      <h3 class="name"><span class="name-zh" data-en="${escapeHTML(p.name)}">${escapeHTML(displayName(p.id, p.name))}</span>
        <span class="en">${escapeHTML(p.name)}</span></h3>
      <div class="badges">${types.map((t) =>
      `<span class="badge" style="--c:${colorOf(t)}">${zhType(t)}</span>`).join('')}</div>`;

    setSpriteFallback(card.querySelector('img'), [dreamSprite(p.id), sprite(p.id), fallbackSprite(p.id)]);
    if (cache.zhName.has(p.id)) {
      card.querySelector('.name-zh').textContent = cache.zhName.get(p.id);
    }
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-fav]')) return;
      openDetail(p.id);
    });
    card.querySelector('[data-fav]').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFav(p.id, e.currentTarget);
    });
    return card;
  }

  /** 依次尝试图片源，全部失败才放弃 */
  function setSpriteFallback(img, sources) {
    let i = 0;
    img.onerror = () => {
      i++;
      if (i < sources.length) img.src = sources[i];
      else img.onerror = null;
    };
    img.src = sources[0];
  }

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function updateMeta() {
    const total = state.list.length;
    el.resultCount.textContent = total
      ? `共 ${total} 只，已显示 ${Math.min(state.shown, total)} 只`
      : '暂无结果';
    el.empty.hidden = total > 0 || state.loading;
  }

  /* ---------- 收藏 ---------- */
  function toggleFav(id, btn) {
    const on = !favorites.has(id);
    if (on) favorites.add(id); else favorites.delete(id);
    store.set('pokedex:favs', [...favorites]);
    el.favCount.textContent = favorites.size;
    document.querySelectorAll(`[data-fav="${id}"]`).forEach((b) => {
      b.classList.toggle('on', on);
      b.textContent = on ? '★' : '☆';
    });
    if (btn && state.onlyFav) { computeList(); renderNextPage(); }
  }

  /* ---------- 详情弹窗 ---------- */
  async function openDetail(id) {
    const idx = state.list.findIndex((p) => p.id === id);
    state.current = idx;
    el.modal.hidden = false;
    document.body.style.overflow = 'hidden';
    history.replaceState(null, '', `#/pokemon/${id}`);
    el.modalBody.innerHTML = `<div class="section" style="padding:60px 0;text-align:center;color:var(--text-dim)">加载中…</div>`;

    try {
      const [p, species] = await Promise.all([getPokemon(id), getSpecies(id)]);
      const types = p.types.map((t) => t.type.name);
      const relations = await Promise.all(types.map((t) => getTypeDetail(t).catch(() => null)));
      const chain = species.evolution_chain
        ? await fetchJSON(species.evolution_chain.url).catch(() => null) : null;
      renderDetail(p, species, types, relations.filter(Boolean), chain);
    } catch {
      el.modalBody.innerHTML = `<div class="section" style="padding:60px 0;text-align:center">
        加载失败 😢<br><button class="btn-primary" style="margin-top:14px" onclick="location.reload()">重试</button></div>`;
    }
  }

  function renderDetail(p, species, types, typeDetails, chain) {
    const genus = (species.genera || []).find((g) => g.language.name === 'zh-Hans');
    const flavor = (species.flavor_text_entries || []).find((f) => f.language.name === 'zh-Hans')
      || (species.flavor_text_entries || []).find((f) => f.language.name === 'en');
    const desc = (flavor ? flavor.flavor_text : '').replace(/[\n\f\r]/g, ' ').replace(/\s+/g, ' ');
    const total = p.stats.reduce((s, x) => s + x.base_stat, 0);
    const isFav = favorites.has(p.id);

    el.modalBody.innerHTML = `
      <div class="hero" style="--hero1:${colorOf(types[0])};--hero2:${colorOf(types[1] || types[0])}">
        <img alt="${p.name}" decoding="async" />
        <div class="hero-info">
          <div class="no">${pad(p.id)}</div>
          <h2>${escapeHTML(displayName(p.id, p.name))}
            <span class="en">${escapeHTML(p.name)}</span></h2>
          ${genus ? `<p class="genus">${escapeHTML(genus.genus)}</p>` : ''}
          <div class="badges">${types.map((t) =>
      `<span class="badge" style="--c:${colorOf(t)}">${zhType(t)}</span>`).join('')}</div>
          <div class="hero-facts">
            <div><span>身高</span><b>${(p.height / 10).toFixed(1)} m</b></div>
            <div><span>体重</span><b>${(p.weight / 10).toFixed(1)} kg</b></div>
            <div><span>基础经验</span><b>${p.base_experience ?? '-'}</b></div>
          </div>
          <button class="detail-fav ${isFav ? 'on' : ''}" data-fav="${p.id}">
            ${isFav ? '★ 已收藏' : '☆ 收藏'}</button>
        </div>
      </div>

      ${desc ? `<div class="section"><h3>图鉴说明</h3><p class="flavor">${escapeHTML(desc)}</p></div>` : ''}

      <div class="section">
        <h3>种族值</h3>
        <div class="stats-wrap">
          <div>
            ${p.stats.map((s) => `
              <div class="stat-row">
                <span>${STAT_ZH[s.stat.name] || s.stat.name}</span>
                <b>${s.base_stat}</b>
                <span class="bar"><i style="width:${Math.min(100, s.base_stat / 1.8)}%"></i></span>
              </div>`).join('')}
            <p class="total">总和：${total}</p>
          </div>
          <canvas id="radar" width="260" height="240"></canvas>
        </div>
      </div>

      <div class="section">
        <h3>特性</h3>
        <div class="tags">${p.abilities.map((a) =>
      `<span class="tag">${escapeHTML(a.ability.name.replace(/-/g, ' '))}
        ${a.is_hidden ? '<small> · 隐藏</small>' : ''}</span>`).join('')}</div>
      </div>

      ${chain ? `<div class="section"><h3>进化链</h3><div class="evo" id="evo"></div></div>` : ''}

      ${typeDetails.length ? `<div class="section"><h3>属性相克</h3>
        <div class="tags" id="weak"></div>${renderResist(typeDetails)}</div>` : ''}
    `;

    setSpriteFallback(el.modalBody.querySelector('.hero img'),
      [dreamSprite(p.id), sprite(p.id), fallbackSprite(p.id)]);

    el.modalBody.querySelector('[data-fav]').addEventListener('click', (e) => {
      toggleFav(p.id, e.currentTarget);
      e.currentTarget.classList.toggle('on', favorites.has(p.id));
      e.currentTarget.textContent = favorites.has(p.id) ? '★ 已收藏' : '☆ 收藏';
    });

    const stats = p.stats.map((s) => ({
      label: STAT_ZH[s.stat.name] || s.stat.name, value: s.base_stat
    }));
    lastRadar = { stats, color: colorOf(types[0]) };
    drawRadar($('#radar'), stats, lastRadar.color);

    if (chain) renderChain(chain.chain);
    if (typeDetails.length) renderWeakness(typeDetails);
  }

  function renderResist(typeDetails) {
    const resist = calcMultipliers(typeDetails).filter((m) => m.mult > 0 && m.mult < 1);
    if (!resist.length) return '';
    return `<p class="total">抵抗：${resist.map((m) => `${zhType(m.type)} ×${m.mult}`).join('、')}</p>`;
  }

  function calcMultipliers(typeDetails) {
    const map = new Map();
    typeDetails.forEach((td) => {
      const r = td.damage_relations;
      const apply = (arr, factor) => arr.forEach((t) => {
        const cur = map.get(t.name) ?? 1;
        map.set(t.name, factor === 0 ? 0 : cur * factor);
      });
      apply(r.double_damage_from, 2);
      apply(r.half_damage_from, 0.5);
      apply(r.no_damage_from, 0);
    });
    return [...map.entries()].map(([type, mult]) => ({ type, mult }));
  }

  function renderWeakness(typeDetails) {
    const box = $('#weak');
    if (!box) return;
    const weak = calcMultipliers(typeDetails).filter((m) => m.mult > 1)
      .sort((a, b) => b.mult - a.mult);
    box.innerHTML = weak.length
      ? weak.map((m) => `<span class="tag" style="background:${hexA(colorOf(m.type), .85)};color:#fff">
          ${zhType(m.type)} <b>×${m.mult}</b></span>`).join('')
      : '<span class="tag">无明显弱点</span>';
  }

  async function renderChain(chain) {
    const box = $('#evo');
    if (!box) return;
    const nodes = [];
    (function walk(node, level) {
      nodes.push({ name: node.species.name, id: idFromUrl(node.species.url), level,
        detail: node.evolution_details?.[0] });
      (node.evolves_to || []).forEach((c) => walk(c, level + 1));
    })(chain, 0);

    box.innerHTML = nodes.map((n, i) => `
      ${i ? `<span class="evo-arrow">▶</span>` : ''}
      <div class="evo-item" data-go="${n.id}">
        <img alt="${n.name}" decoding="async" />
        <p>${escapeHTML(displayName(n.id, n.name))}</p>
        <small>${evoText(n.detail)}</small>
      </div>`).join('');

    nodes.forEach((n) => {
      const img = box.querySelector(`[data-go="${n.id}"] img`);
      if (img) setSpriteFallback(img, [dreamSprite(n.id), sprite(n.id), fallbackSprite(n.id)]);
    });

    box.querySelectorAll('[data-go]').forEach((node) => {
      node.addEventListener('click', () => openDetail(Number(node.dataset.go)));
    });

    await mapLimit(nodes.filter((n) => !cache.zhName.has(n.id)), 4, async (n) => {
      try { await getSpecies(n.id); } catch { /* 忽略 */ }
    });
    nodes.forEach((n) => {
      const node = box.querySelector(`[data-go="${n.id}"] p`);
      if (node) node.textContent = displayName(n.id, n.name);
    });
  }

  function evoText(d) {
    if (!d) return '基础形态';
    const map = {
      'level-up': '升级', trade: '通信交换', 'use-item': '使用道具',
      'shed': '蜕皮', 'tower-of-darkness': '暗之塔', 'tower-of-waters': '水之塔',
      'three-critical-hits': '三次要害', 'take-damage': '受到伤害',
      'other': '特殊条件', 'agile-style-move': '迅捷动作', 'strong-style-move': '刚猛动作',
      'recoil-damage': '反伤'
    };
    if (d.min_level) return `Lv.${d.min_level}`;
    if (d.item) return `使用 ${d.item.name.replace(/-/g, ' ')}`;
    if (d.trigger) return map[d.trigger.name] || d.trigger.name;
    return '进化';
  }

  function drawRadar(canvas, stats, color) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cx = canvas.width / 2, cy = canvas.height / 2 + 6;
    const R = Math.min(canvas.width, canvas.height) / 2 - 34;
    const n = stats.length;
    const max = Math.max(160, ...stats.map((s) => s.value));
    const pt = (i, r) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    };

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let ring = 1; ring <= 4; ring++) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const [x, y] = pt(i, (R * ring) / 4);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = 'rgba(140,150,170,.35)';
      ctx.stroke();
    }
    for (let i = 0; i < n; i++) {
      const [x, y] = pt(i, R);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y);
      ctx.strokeStyle = 'rgba(140,150,170,.25)'; ctx.stroke();
    }

    ctx.beginPath();
    stats.forEach((s, i) => {
      const [x, y] = pt(i, (R * s.value) / max);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = hexA(color, 0.35);
    ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();

    ctx.font = '12px "PingFang SC", sans-serif';
    ctx.fillStyle = getComputedStyle(document.body).color;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    stats.forEach((s, i) => {
      const [x, y] = pt(i, R + 18);
      ctx.fillText(s.label, x, y);
    });
  }

  function closeModal() {
    el.modal.hidden = true;
    document.body.style.overflow = '';
    history.replaceState(null, '', location.pathname + location.search);
  }

  function step(delta) {
    if (!state.list.length) return;
    const next = (state.current + delta + state.list.length) % state.list.length;
    openDetail(state.list[next].id);
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    let timer;
    el.search.addEventListener('input', () => {
      $('#clearSearch').hidden = !el.search.value;
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.query = el.search.value;
        if (state.searchMode === 'desc' && !descIndex) {
          el.descPanel.hidden = false; // 引导建立索引
          return;
        }
        computeList();
        renderNextPage();
      }, 300);
    });
    $('#clearSearch').addEventListener('click', () => {
      el.search.value = ''; state.query = '';
      $('#clearSearch').hidden = true;
      computeList(); renderNextPage();
    });

    el.sort.addEventListener('change', () => {
      state.sort = el.sort.value; computeList(); renderNextPage();
    });

    el.typeBar.addEventListener('click', async (e) => {
      const chip = e.target.closest('.type-chip');
      if (!chip || chip.dataset.type === state.type) return;
      await applyTypeFilter(chip.dataset.type);
      computeList(); renderNextPage();
    });

    el.favToggle.addEventListener('click', () => {
      state.onlyFav = !state.onlyFav;
      el.favToggle.setAttribute('aria-pressed', String(state.onlyFav));
      computeList(); renderNextPage();
    });

    el.modeSeg.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-mode]');
      if (!btn || btn.dataset.mode === state.searchMode) return;
      state.searchMode = btn.dataset.mode;
      el.modeSeg.querySelectorAll('button').forEach((b) =>
        b.classList.toggle('on', b === btn));
      el.descPanel.hidden = state.searchMode !== 'desc';
      el.search.placeholder = state.searchMode === 'desc'
        ? '描述宝可梦，如「会放电的小老鼠」「喷火的龙」'
        : '搜索名称或编号，如 pikachu / 25';
      if (state.searchMode === 'desc' && descIndex) {
        el.buildStatus.textContent = '索引就绪 ✓';
        el.buildIndex.hidden = true;
        el.cancelBuild.hidden = true;
      } else {
        el.buildIndex.hidden = false;
      }
      if (state.query) {
        if (state.searchMode === 'desc' && !descIndex) { el.descPanel.hidden = false; return; }
        computeList(); renderNextPage();
      }
    });

    el.buildIndex.addEventListener('click', buildDescIndex);
    el.cancelBuild.addEventListener('click', () => { buildCancel = true; });

    $('#surprise').addEventListener('click', () => {
      if (!state.list.length) return;
      openDetail(state.list[Math.floor(Math.random() * state.list.length)].id);
    });

    $('#resetFilter').addEventListener('click', () => {
      el.search.value = ''; state.query = ''; state.onlyFav = false;
      el.favToggle.setAttribute('aria-pressed', 'false');
      applyTypeFilter('all').then(() => { computeList(); renderNextPage(); });
    });

    el.loadMore.addEventListener('click', renderNextPage);

    new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !state.loading && state.shown < state.list.length) {
        renderNextPage();
      }
    }, { rootMargin: '180px' }).observe(el.sentinel);

    el.modal.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
    $('#prevBtn').addEventListener('click', () => step(-1));
    $('#nextBtn').addEventListener('click', () => step(1));

    document.addEventListener('keydown', (e) => {
      if (el.modal.hidden) return;
      if (e.key === 'Escape') closeModal();
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    });

    $('#themeToggle').addEventListener('click', () => {
      const dark = document.documentElement.dataset.theme !== 'dark';
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      $('#themeToggle').textContent = dark ? '☀️' : '🌙';
      store.set('pokedex:theme', dark ? 'dark' : 'light');
      if (lastRadar) drawRadar($('#radar'), lastRadar.stats, lastRadar.color);
    });
  }

  /* ---------- 初始化 ---------- */
  async function init() {
    document.documentElement.dataset.theme = store.get('pokedex:theme', 'light');
    $('#themeToggle').textContent =
      document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙';
    el.favCount.textContent = favorites.size;
    if (descIndex) {
      el.buildStatus.textContent = '索引就绪 ✓';
      el.buildIndex.hidden = true;
    }
    bind();

    TYPE_ORDER.forEach((t) => {
      const b = document.createElement('button');
      b.className = 'type-chip'; b.type = 'button'; b.dataset.type = t;
      b.textContent = zhType(t);
      b.style.setProperty('--tc', colorOf(t));
      el.typeBar.appendChild(b);
    });

    try {
      await loadIndex();
    } catch {
      el.resultCount.textContent = '数据加载失败';
      el.empty.hidden = false;
      el.empty.querySelector('p:last-of-type').textContent = '无法连接 PokéAPI，请检查网络';
      el.empty.querySelector('#resetFilter').textContent = '重新加载';
      el.empty.querySelector('#resetFilter').onclick = () => location.reload();
      toast('无法连接 PokéAPI，请检查网络后重试');
      return;
    }

    computeList();
    renderNextPage();

    const m = location.hash.match(/pokemon\/(\d+)/);
    if (m) openDetail(Number(m[1]));
  }

  init();
})();
