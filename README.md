# 宝可梦大全 · Pokédex

一个纯前端（零依赖、零构建）的宝可梦图鉴网站，数据来自 [PokéAPI](https://pokeapi.co)。
配套一个 **零依赖的 Node 代理/缓存服务**（`server.js`），用于上线时统一出口、缓存数据、降低上游压力，并帮助被墙地区访问。

## 结构

```
index.html  页面结构
styles.css  主题与响应式样式
app.js      前端逻辑（请求走同源 /api 与 /sprites）
server.js   Node 代理 + 静态托管（零依赖，Node 18+）
package.json  启动脚本
.cache/     服务端磁盘缓存（已 gitignore，自动生成）
```

- 前端 `API` 在 localhost 下指向 `/api`；部署后也走同源 `/api`，由 `server.js` 转发 PokéAPI 并缓存。
- 精灵图统一走 `/sprites`（转发 jsDelivr，失败自动回退 raw.githubusercontent）。

## 本地运行（含代理）

```bash
npm start            # 等价于 node server.js
# 然后访问 http://localhost:3000
```

环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 监听端口 |
| `CACHE_TTL` | `604800000`（7 天） | 缓存有效期（毫秒），到期自动回源刷新 |
| `CLEAR_TOKEN` | 空 | 设置后，可通过 `GET /admin/clear?token=xxx` 清空缓存 |

手动清缓存：`curl "http://localhost:3000/admin/clear?token=你的TOKEN"`（不设 `CLEAR_TOKEN` 则该接口 401）。

## 部署（给大家使用）

需要能跑 Node 的托管：Railway / Render / Fly.io / 任意 VPS。这些平台读取 `npm start` 即可。
首屏静态资源由本服务直接返回；`/api`、`/sprites` 走服务端缓存，所有用户共享，大幅减少 PokéAPI 请求量。

> 若只想要纯静态托管（Netlify/Vercel/GitHub Pages 拖拽），前端也可直接连 PokéAPI（`app.js` 顶部 `API` 改为 `https://pokeapi.co/api/v2`、`SPRITE_BASE` 改回 jsDelivr 即可），但那样无服务端缓存、且部分地区可能访问不畅。

## 说明

- 服务端两级缓存：内存(Map) + 磁盘(`.cache/`)；并发请求去重，避免缓存击穿。
- 仅允许代理到 `pokeapi.co` 与精灵图 CDN，避免成为开放代理。
- 首次访问会拉取一次全量索引（约 1300 条）并缓存 7 天，详情页按需请求并做内存缓存。
- 中文名来自 PokéAPI 的 `zh-Hans` 名称，列表加载后会异步补全中文名。
- 本项目为学习用途的粉丝作品，宝可梦相关版权归 Nintendo / Creatures / GAME FREAK 所有。

## 功能

- **图鉴列表**：滚动无限加载，卡片展示编号、形象、属性徽章
- **搜索**：支持英文名、中文名（已加载过的）与编号，如 `pikachu`、`25`、`#0025`
- **属性筛选**：18 种属性快捷筛选，卡片配色随属性变化
- **排序**：编号 / 名称 / 随机，另有「🎲 随机一只」
- **收藏**：点击卡片右上角星标收藏，可切换「只看收藏」，数据存于 localStorage
- **描述搜索**：搜索框旁切到「描述」模式，输入自然语言描述（如「会放电的小老鼠」「喷火的龙」「草系乌龟」），系统会先联网建立一次本地索引（约 1300 条图鉴说明 + 分类 + 属性，之后离线可用），再按「属性同义词 / 分类动物词 / 中文名 / 图鉴文本」加权匹配并排序返回最相关的宝可梦
- **详情页**：图鉴说明、身高体重、种族值条形图 + 六维雷达图、特性、进化链（含进化条件）、属性相克（弱点 ×2/×4 与抗性）
- **其他**：深浅色主题切换、键盘 ←/→ 切换宝可梦、Esc 关闭、`#/pokemon/25` 可直接深链到某只宝可梦

## 性能优化

- **流式渲染**：先用 CSS 骨架屏占位，每只宝可梦数据返回后即刻 `replaceChild` 替换占位，DOM 写入经 `requestAnimationFrame` 合批，不再「等满 24 只再一次性插入」
- **并发控制**：单页请求并发限制为 6，避免瞬时几十个请求打满连接
- **轻量图源**：卡片与详情优先加载 dream-world 矢量图（体积远小于 PNG），失败自动回退官方 PNG / 像素图，图片 `loading="lazy"` + `decoding="async"`
- **跳过离屏渲染**：卡片使用 `content-visibility: auto` + `contain`，视口外卡片不参与布局绘制
- **中文名懒加载**：只有滚动进入视口（含 240px 预取）的卡片才请求 species 中文名
- **渲染令牌**：筛选/搜索变化时 `renderToken++`，作废在途请求结果，避免错序与重复插入

## 文件结构

| 文件 | 说明 |
| --- | --- |
| `index.html` | 页面结构（顶栏、工具栏、属性栏、卡片网格、详情弹窗） |
| `styles.css` | 主题变量、响应式布局、属性配色 |
| `app.js` | 数据请求、筛选/分页、渲染、雷达图、收藏与主题逻辑 |

## 说明

- 首次访问会拉取一次全量索引（约 1300 条）并缓存 7 天，详情页按需请求并做内存缓存。
- 中文名来自 PokéAPI 的 `zh-Hans` 名称，列表加载后会异步补全中文名。
- 本项目为学习用途的粉丝作品，宝可梦相关版权归 Nintendo / Creatures / GAME FREAK 所有。
