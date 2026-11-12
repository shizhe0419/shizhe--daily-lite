const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const POLL_MS = 30 * 60 * 1000;
const MAX_PER_BOARD = 30;
const DATA_DIR = process.env.AIHOT_DATA_DIR || path.join(__dirname, "data");
const CACHE_FILE = path.join(DATA_DIR, "model-ranks.json");
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const LIVEBENCH = "https://livebench.ai";
const AA_BOARD = "https://artificialanalysis.ai/leaderboards/models";
const AA_MODEL = "https://artificialanalysis.ai/models";
const LMARENA = "https://lmarena.ai/leaderboard";
const OPENROUTER = "https://openrouter.ai/api/v1/models";
const FX_URL = "https://api.frankfurter.app/latest?from=USD&to=CNY";

const BOARDS = [
  { id: "overall", label: "综合" },
  { id: "coding", label: "编程" },
  { id: "reasoning", label: "推理" },
  { id: "professional", label: "专业办公" }
];

const LIVEBENCH_BOARD_CATS = {
  overall: ["Reasoning", "Coding", "Agentic Coding", "Mathematics", "Data Analysis", "Language", "IF"],
  coding: ["Coding", "Agentic Coding"],
  reasoning: ["Reasoning", "Mathematics"],
  professional: ["Data Analysis", "Language", "IF"]
};

const AA_CAPABILITY = [
  { key: "intelligenceIndex", label: "Intelligence Index", scale: "index" },
  { key: "gpqa", label: "GPQA", scale: "ratio" },
  { key: "hle", label: "Humanity's Last Exam", scale: "ratio" },
  { key: "ifbench", label: "IFBench", scale: "ratio" },
  { key: "tau2", label: "τ²-bench", scale: "ratio" },
  { key: "terminalbenchHard", label: "Terminal-Bench Hard", scale: "ratio" },
  { key: "scicode", label: "SciCode", scale: "ratio" },
  { key: "lcr", label: "LCR", scale: "ratio" }
];

let timer = null;

function emptyCache() {
  return {
    source: LIVEBENCH,
    fetchedAt: null,
    revision: "",
    ok: false,
    lastError: null,
    etags: {},
    payload: null
  };
}

function readCache() {
  try {
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    if (data && typeof data === "object") {
      return data;
    }
  } catch (_error) {
    // keep going with an empty cache
  }
  return emptyCache();
}

function writeCache(data) {
  const tmp = `${CACHE_FILE}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data)}\n`);
  fs.renameSync(tmp, CACHE_FILE);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function curl(url, extra = {}) {
  const seconds = Number(extra.maxTime || "35");
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      accept: extra.accept || "text/html,application/json;q=0.9,*/*;q=0.8",
      "user-agent": USER_AGENT,
      ...(extra.headers || {})
    },
    signal: AbortSignal.timeout((Number.isFinite(seconds) ? seconds : 35) * 1000)
  });
  return await res.text();
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (_error) {
    throw new Error(`${label} 不是可解析的 JSON`);
  }
}

function numberOrNull(value) {
  if (value == null || value === "") {
    return null;
  }
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

function mean(values) {
  const nums = values.filter((value) => Number.isFinite(value));
  if (!nums.length) {
    return null;
  }
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function roundScore(value, digits = 1) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function roundPrice(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.round(value * 100) / 100;
}

function usdToCny(usd, fx) {
  if (!Number.isFinite(usd) || !Number.isFinite(fx) || fx <= 0) {
    return null;
  }
  return roundPrice(usd * fx);
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[+]/g, "plus")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const LOCAL_LOGOS = {
  claude: "/images/models/claude-color.svg",
  gpt: "/images/models/openai.svg",
  gemini: "/images/models/gemini-color.svg",
  grok: "/images/models/grok.svg",
  qwen: "/images/models/qwen-color.svg",
  deepseek: "/images/models/deepseek-color.svg",
  kimi: "/images/models/kimi-color.svg",
  glm: "/images/models/chatglm.svg",
  spark: "/images/models/spark.svg"
};

const ORG_LABELS = {
  claude: "Anthropic",
  gpt: "OpenAI",
  gemini: "Google",
  grok: "xAI",
  qwen: "Alibaba",
  deepseek: "DeepSeek",
  kimi: "Moonshot AI",
  glm: "Z.AI",
  spark: "Meta"
};

function modelKey(name, slug) {
  const hay = `${name || ""} ${slug || ""}`;
  if (/claude/i.test(hay)) {
    return "claude";
  }
  if (/\bgpt\b|chatgpt|^gpt[-.\s]?\d/i.test(hay)) {
    return "gpt";
  }
  if (/gemini/i.test(hay)) {
    return "gemini";
  }
  if (/grok/i.test(hay)) {
    return "grok";
  }
  if (/qwen/i.test(hay)) {
    return "qwen";
  }
  if (/deepseek/i.test(hay)) {
    return "deepseek";
  }
  if (/kimi/i.test(hay)) {
    return "kimi";
  }
  if (/\bglm\b/i.test(hay)) {
    return "glm";
  }
  if (/muse\s*spark/i.test(hay)) {
    return "spark";
  }
  return "";
}

function inferOrg(org, name, slug) {
  if (org) {
    return org;
  }
  return ORG_LABELS[modelKey(name, slug)] || "";
}

function localLogo(org, name, slug) {
  return LOCAL_LOGOS[modelKey(name, slug)] || "";
}

function familyKey(value) {
  let text = String(value || "").toLowerCase();
  text = text.replace(/[_/]/g, "-");
  text = text.replace(/\d{8}/g, "");
  text = text.replace(/-?(thinking|reasoner|reasoning)(?=-|$)/g, "");
  text = text.replace(/-(auto|high|xhigh|max|medium|low)-effort(?=-|$)/g, "");
  text = text.replace(/-(64k|128k|256k|1m)(?=-|$)/g, "");
  text = text.replace(/[^a-z0-9.]+/g, "-").replace(/\./g, "-");
  text = text.replace(/-+/g, "-").replace(/^-|-$/g, "");
  return text;
}

function tokensOf(value) {
  return familyKey(value).split("-").filter((part) => part && part.length > 1 || /^\d/.test(part));
}

function versionHint(value) {
  const nums = tokensOf(value).filter((part) => /\d/.test(part));
  return nums.join("-");
}

function matchScore(left, right) {
  const a = tokensOf(left);
  const b = tokensOf(right);
  if (!a.length || !b.length) {
    return 0;
  }
  const versionA = versionHint(left);
  const versionB = versionHint(right);
  if (versionA && versionB && versionA !== versionB) {
    return 0;
  }
  const setA = new Set(a);
  const setB = new Set(b);
  let overlap = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(setA.size, setB.size);
}

function bestMatch(needle, haystack, getter) {
  let best = null;
  let score = 0.72;
  const key = familyKey(needle);
  for (const item of haystack) {
    const hay = getter(item);
    const hayKey = familyKey(hay);
    if (key && hayKey && key === hayKey) {
      return item;
    }
    const next = matchScore(needle, hay);
    if (next > score) {
      score = next;
      best = item;
    }
  }
  return best;
}

function parseCsv(text) {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    return [];
  }
  const headers = lines[0].split(",").map((item) => item.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] == null ? "" : cells[index].trim();
    });
    return row;
  });
}

function isIsoDate(value) {
  const iso = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return false;
  }
  const time = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === iso;
}

function extractLiveBenchDates(js) {
  const found = [];
  for (const match of String(js || "").matchAll(/(?:table|categories|cost)_(\d{4})_(\d{2})_(\d{2})/g)) {
    const iso = `${match[1]}-${match[2]}-${match[3]}`;
    if (isIsoDate(iso)) {
      found.push(iso);
    }
  }
  return [...new Set(found)].sort();
}

function recentLiveBenchDates(floor) {
  const dates = [];
  const today = new Date();
  for (let index = 0; index < 16; index += 1) {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - index * 7));
    dates.push(date.toISOString().slice(0, 10));
  }
  if (isIsoDate(floor) && !dates.includes(floor)) {
    dates.push(floor);
  }
  return dates;
}

function liveBenchTryOrder(listed, scriptDates, previousDate) {
  const order = [];
  const push = (value) => {
    if (isIsoDate(value) && !order.includes(value)) {
      order.push(value);
    }
  };
  const listedSorted = (listed || []).filter(isIsoDate).sort();
  if (listedSorted.length) {
    push(listedSorted[listedSorted.length - 1]);
    push(previousDate);
    if (listedSorted.length > 1) {
      push(listedSorted[listedSorted.length - 2]);
    }
    return order.slice(0, 3);
  }
  push(previousDate);
  for (const date of [...(scriptDates || [])].filter(isIsoDate).sort().reverse()) {
    push(date);
  }
  for (const date of recentLiveBenchDates(previousDate).slice().reverse()) {
    push(date);
  }
  return order.slice(0, 6);
}

function liveBenchFileUrls(name) {
  return [
    {
      url: `https://api.github.com/repos/LiveBench/livebench.github.io/contents/public/${name}`,
      accept: "application/vnd.github.raw",
      headers: { "X-GitHub-Api-Version": "2022-11-28" }
    },
    { url: `${LIVEBENCH}/${name}?v=1` },
    { url: `https://raw.githubusercontent.com/LiveBench/livebench.github.io/main/public/${name}` }
  ];
}

async function tryLiveBenchTable(date) {
  const stamp = date.replace(/-/g, "_");
  for (const source of liveBenchFileUrls(`table_${stamp}.csv`)) {
    try {
      const tableText = await curl(source.url, { maxTime: "15", accept: source.accept, headers: source.headers });
      if (tableText.includes("model,") && !tableText.startsWith("<") && !tableText.startsWith("{")) {
        return { date, stamp, tableText, url: source.url };
      }
    } catch (_error) {
      // try next url
    }
  }
  return null;
}

function extractLiveBenchMeta(js) {
  const meta = {};
  const pattern = /"([^"]+)":\{url:"(https?:\/\/[^"]+)",(?:huggingface:"[^"]+",)?organization:"([^"]+)",displayName:"([^"]+)"(?:,version:"([^"]+)")?/g;
  for (const match of String(js || "").matchAll(pattern)) {
    meta[match[1]] = {
      url: match[2],
      org: match[3],
      name: match[4],
      version: match[5] || ""
    };
  }
  return meta;
}

function liveBenchMetaFor(rawName, meta) {
  if (meta[rawName]) {
    return meta[rawName];
  }
  const key = Object.keys(meta).find((item) => rawName.startsWith(item) || item.startsWith(rawName));
  return key ? meta[key] : null;
}

function categoryScores(row, categories, categoryMap) {
  const scores = {};
  for (const [label, tasks] of Object.entries(categoryMap || {})) {
    const values = (tasks || []).map((task) => numberOrNull(row[task]));
    const score = mean(values);
    if (score != null) {
      scores[label] = roundScore(score);
    }
  }
  return scores;
}

function boardScoreFromLiveBench(cats, boardId) {
  const labels = LIVEBENCH_BOARD_CATS[boardId] || [];
  return roundScore(mean(labels.map((label) => cats[label])));
}

function fieldNumber(chunk, key) {
  const match = String(chunk || "").match(new RegExp(`"${key}":(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?|null)`));
  if (!match || match[1] === "null") {
    return null;
  }
  return numberOrNull(match[1]);
}

function fieldString(chunk, key) {
  const match = String(chunk || "").match(new RegExp(`"${key}":"([^"]*)"`));
  return match ? match[1] : "";
}

function fieldBool(chunk, key) {
  const match = String(chunk || "").match(new RegExp(`"${key}":(true|false)`));
  return match ? match[1] === "true" : null;
}

function parseAaModels(html) {
  const text = String(html || "").replace(/\\"/g, '"').replace(/\\u0026/g, "&");
  const bySlug = new Map();
  const pattern = /\{"slug":"([a-z0-9][a-z0-9._-]*)","name":"([^"]+)"/g;
  let match;
  while ((match = pattern.exec(text))) {
    const slug = match[1];
    const name = match[2];
    const chunk = text.slice(match.index, match.index + 4500);
    const current = bySlug.get(slug) || { slug, name, rawNames: [] };
    current.rawNames.push(name);
    if (!current.name || current.name.length > name.length) {
      current.name = name;
    }
    const shortName = fieldString(chunk, "shortName");
    if (shortName) {
      current.shortName = shortName;
    }
    const logo = fieldString(chunk, "modelCreatorLogo") || (chunk.match(/"logo":"(\/img\/logos\/[^"]+)"/) || [])[1] || "";
    if (logo) {
      current.logo = logo.startsWith("http") ? logo : `https://artificialanalysis.ai${logo}`;
    }
    const creator = fieldString(chunk, "modelCreatorName") || fieldString(chunk, "name");
    const creatorBlock = chunk.match(/"creator":\{[^}]*"name":"([^"]+)"/);
    if (creatorBlock) {
      current.org = creatorBlock[1];
    } else if (fieldString(chunk, "modelCreatorName")) {
      current.org = fieldString(chunk, "modelCreatorName");
    } else if (!current.org && creator && creator !== name && creator !== shortName) {
      current.org = creator;
    }
    const releaseName = chunk.match(/"release":\{"slug":"([^"]+)","name":"([^"]+)"\}/);
    if (releaseName) {
      current.releaseSlug = releaseName[1];
      current.releaseName = releaseName[2];
    }
    const releasedOn = fieldString(chunk, "releaseDate");
    if (/^\d{4}-\d{2}-\d{2}$/.test(releasedOn)) {
      current.releasedOn = releasedOn;
    }
    const deprecated = fieldBool(chunk, "deprecated");
    if (deprecated != null) {
      current.deprecated = current.deprecated || deprecated;
    }
    const intel = fieldNumber(chunk, "intelligenceIndex");
    if (intel != null) {
      current.intelligenceIndex = intel;
      current.intelligenceIndexIsEstimated = fieldBool(chunk, "intelligenceIndexIsEstimated") === true;
    }
    const input = fieldNumber(chunk, "price1mInputTokens");
    const output = fieldNumber(chunk, "price1mOutputTokens");
    const cache = fieldNumber(chunk, "cacheHitPrice");
    if (input != null || output != null || cache != null) {
      current.usdPrices = {
        cache,
        input,
        output
      };
    }
    for (const item of AA_CAPABILITY) {
      const value = fieldNumber(chunk, item.key);
      if (value != null) {
        current[item.key] = value;
      }
    }
    bySlug.set(slug, current);
  }
  return [...bySlug.values()];
}

function collapseAaFamilies(records) {
  const groups = new Map();
  for (const record of records) {
    const key = record.releaseSlug || familyKey(record.slug);
    if (!key) {
      continue;
    }
    const list = groups.get(key) || [];
    list.push(record);
    groups.set(key, list);
  }
  const models = [];
  for (const [key, list] of groups) {
    const scored = list.filter((item) => Number.isFinite(item.intelligenceIndex));
    const pool = scored.length ? scored : list;
    const fresh = pool.filter((item) => item.deprecated !== true);
    const candidates = fresh.length ? fresh : pool;
    candidates.sort((left, right) => (right.intelligenceIndex || -1) - (left.intelligenceIndex || -1));
    const picked = candidates[0];
    if (!picked || !Number.isFinite(picked.intelligenceIndex)) {
      continue;
    }
    const priced = [picked, ...list].find((item) => item.usdPrices);
    models.push({
      slug: key,
      name: picked.releaseName || picked.shortName || picked.name,
      org: picked.org || "",
      releasedOn: picked.releasedOn || "",
      officialUrl: `${AA_MODEL}/${encodeURIComponent(picked.releaseSlug || picked.slug)}`,
      officialLabel: "Artificial Analysis 模型页",
      logo: picked.logo || "",
      aa: picked,
      usdPrices: (priced && priced.usdPrices) || null
    });
  }
  return models;
}

function parseOpenRouter(payload) {
  return (payload && payload.data ? payload.data : []).map((item) => {
    const pricing = item.pricing || {};
    return {
      id: item.id,
      name: item.name || item.id,
      created: item.created,
      usdPrices: {
        cache: numberOrNull(pricing.input_cache_read) != null ? numberOrNull(pricing.input_cache_read) * 1e6 : null,
        input: numberOrNull(pricing.prompt) != null ? numberOrNull(pricing.prompt) * 1e6 : null,
        output: numberOrNull(pricing.completion) != null ? numberOrNull(pricing.completion) * 1e6 : null
      }
    };
  });
}

function liveBenchRows(table, categories, meta) {
  return table.map((row) => {
    const raw = row.model;
    const info = liveBenchMetaFor(raw, meta) || {};
    const cats = categoryScores(row, categories, categories);
    return {
      raw,
      family: familyKey(info.name || raw),
      name: info.name || raw,
      org: inferOrg(info.org, info.name || raw, familyKey(info.name || raw)),
      releasedOn: /^\d{4}-\d{2}-\d{2}$/.test(info.version) ? info.version : "",
      officialUrl: info.url || LIVEBENCH,
      officialLabel: info.url ? "厂商介绍" : "LiveBench",
      categories: cats,
      scores: {
        overall: boardScoreFromLiveBench(cats, "overall"),
        coding: boardScoreFromLiveBench(cats, "coding"),
        reasoning: boardScoreFromLiveBench(cats, "reasoning"),
        professional: boardScoreFromLiveBench(cats, "professional")
      }
    };
  });
}

function collapseLiveBench(rows, boardId) {
  const groups = new Map();
  for (const row of rows) {
    const score = row.scores[boardId];
    if (!Number.isFinite(score)) {
      continue;
    }
    const key = row.family || slugify(row.name);
    const current = groups.get(key);
    if (!current || score > current.scores[boardId]) {
      groups.set(key, row);
    }
  }
  return [...groups.values()].sort((left, right) => right.scores[boardId] - left.scores[boardId]);
}

function attachPrices(model, fx, openrouter, liveCost) {
  const fromUsd = (usd) => ({
    cache: usdToCny(usd && usd.cache, fx),
    input: usdToCny(usd && usd.input, fx),
    output: usdToCny(usd && usd.output, fx)
  });
  if (model.usdPrices && (model.usdPrices.input != null || model.usdPrices.output != null || model.usdPrices.cache != null)) {
    return { prices: fromUsd(model.usdPrices), priceSource: "Artificial Analysis 美元报价" };
  }
  const cost = liveCost && liveCost[model.liveRaw];
  if (cost && (cost.input != null || cost.output != null)) {
    return { prices: fromUsd(cost), priceSource: "LiveBench 成本表美元报价" };
  }
  const matched = bestMatch(`${model.name} ${model.slug}`, openrouter, (item) => `${item.name} ${item.id}`);
  if (matched && matched.usdPrices) {
    return { prices: fromUsd(matched.usdPrices), priceSource: "OpenRouter 公开美元报价" };
  }
  return { prices: { cache: null, input: null, output: null }, priceSource: "" };
}

function capabilityFromLiveBench(row) {
  return Object.entries(row.categories || {}).map(([label, score]) => ({
    label,
    href: LIVEBENCH,
    rankLabel: "LiveBench",
    score,
    note: "该分类下已公示任务的等权平均。",
    unmeasured: !Number.isFinite(score)
  }));
}

function capabilityFromAa(aa) {
  if (!aa) {
    return [];
  }
  return AA_CAPABILITY.map((item) => {
    const raw = aa[item.key];
    if (!Number.isFinite(raw)) {
      return {
        label: item.label,
        href: AA_BOARD,
        rankLabel: "Artificial Analysis",
        score: null,
        note: "没有足够的实测，已留空。",
        unmeasured: true
      };
    }
    const score = item.scale === "ratio" && raw >= 0 && raw <= 1.0001 ? roundScore(raw * 100) : roundScore(raw);
    const note = item.scale === "ratio"
      ? `官方为比例 ${raw}，这里乘 100 便于对照。`
      : aa.intelligenceIndexIsEstimated && item.key === "intelligenceIndex"
        ? "页面标明该指数为估计值。"
        : "Artificial Analysis 页面公示值。";
    return {
      label: item.label,
      href: AA_BOARD,
      rankLabel: "Artificial Analysis",
      score,
      note,
      unmeasured: false
    };
  });
}

function evidenceGroups(model) {
  const groups = [];
  if (model.liveRow) {
    groups.push({
      title: `LiveBench 分项 ${Object.keys(model.liveRow.categories || {}).length} 项`,
      records: Object.entries(model.liveRow.categories).map(([name, score]) => ({
        name,
        role: "分类平均",
        raw: Number.isFinite(score) ? String(score) : "—",
        setup: [{ label: "算法", value: "该分类下已公示任务等权平均" }],
        note: "",
        provenance: `快照 ${model.liveSnapshot || ""}`.trim(),
        links: [{ url: LIVEBENCH, label: "LiveBench" }]
      }))
    });
  }
  if (model.aa) {
    groups.push({
      title: "Artificial Analysis 公示成绩",
      records: AA_CAPABILITY.map((item) => {
        const raw = model.aa[item.key];
        return {
          name: item.label,
          role: "机构综合或单项",
          raw: raw == null ? "—" : String(roundScore(raw, 4)),
          setup: item.key === "intelligenceIndex" && model.aa.intelligenceIndexIsEstimated
            ? [{ label: "备注", value: "估计值" }]
            : [],
          note: "",
          provenance: "artificialanalysis.ai/leaderboards/models",
          links: [
            { url: model.officialUrl || AA_BOARD, label: "模型页" },
            { url: AA_BOARD, label: "总榜" }
          ]
        };
      }).filter((record) => record.raw !== "—")
    });
  }
  if (model.priceSource) {
    groups.push({
      title: "价格",
      records: [{
        name: model.priceSource,
        role: "美元报价按当日汇率折人民币",
        raw: "",
        setup: [
          { label: "缓存", value: model.prices.cache == null ? "—" : String(model.prices.cache) },
          { label: "输入", value: model.prices.input == null ? "—" : String(model.prices.input) },
          { label: "输出", value: model.prices.output == null ? "—" : String(model.prices.output) }
        ],
        note: "不是厂商官网人民币价。缓存写入、存储和订阅另计。",
        provenance: model.priceSource,
        links: model.officialUrl ? [{ url: model.officialUrl, label: "价格来源页" }] : []
      }]
    });
  }
  return groups;
}

function rankUnderstanding(boardId, slug, catalog) {
  const labels = LIVEBENCH_BOARD_CATS[boardId] || [];
  const rows = catalog.filter((item) => item.liveRow && Number.isFinite(item.scores[boardId]));
  const self = rows.find((item) => item.slug === slug);
  if (!self || labels.length < 2) {
    return {
      title: "名次有多稳？",
      summary: "综合榜按 Artificial Analysis Intelligence Index 排序；其余榜按 LiveBench 已公示分项等权平均。只有一家机构的分数时，做不了去源重排。",
      rangeLabel: "",
      range: "",
      note: "没有足够的对照分数，名次范围留空。",
      pairs: []
    };
  }
  const fullRank = rows
    .slice()
    .sort((left, right) => right.scores[boardId] - left.scores[boardId])
    .findIndex((item) => item.slug === slug) + 1;
  const ranks = [fullRank];
  for (const drop of labels) {
    const scored = rows.map((item) => {
      const used = labels.filter((label) => label !== drop).map((label) => item.liveRow.categories[label]);
      return { slug: item.slug, score: mean(used) };
    }).filter((item) => Number.isFinite(item.score));
    scored.sort((left, right) => right.score - left.score);
    const rank = scored.findIndex((item) => item.slug === slug) + 1;
    if (rank > 0) {
      ranks.push(rank);
    }
  }
  const low = Math.min(...ranks);
  const high = Math.max(...ranks);
  const neighbors = rows
    .slice()
    .sort((left, right) => right.scores[boardId] - left.scores[boardId])
    .filter((item) => item.slug !== slug)
    .slice(0, 2);
  const pairs = neighbors.map((other) => {
    const overlap = labels.filter((label) => (
      Number.isFinite(self.liveRow.categories[label]) && Number.isFinite(other.liveRow.categories[label])
    ));
    const selfMean = mean(overlap.map((label) => self.liveRow.categories[label]));
    const otherMean = mean(overlap.map((label) => other.liveRow.categories[label]));
    let verdict = "对照不足";
    if (selfMean != null && otherMean != null) {
      verdict = selfMean === otherMean ? "持平" : selfMean > otherMean ? "领先" : "落后";
    }
    return {
      opponent: other.name,
      overlap: overlap.length ? `${overlap.length} 类共同分项` : "无共同分项",
      verdict,
      note: "只比较 LiveBench 已公示、双方都有的分类平均，等权。不是官方对战结果。",
      scores: overlap.map((label) => ({
        name: label,
        url: LIVEBENCH,
        self: String(self.liveRow.categories[label]),
        other: String(other.liveRow.categories[label]),
        weight: "等权"
      }))
    };
  });
  return {
    title: "名次有多稳？",
    summary: "按 LiveBench 已公示分项等权重算，依次去掉一类后看名次变化。这是本地对照，不是 LiveBench 或 Artificial Analysis 的官方名次。",
    rangeLabel: "去类后的名次范围",
    range: low === high ? `第 ${low} 名` : `第 ${low}–${high} 名`,
    note: `完整分项时是第 ${fullRank} 名。数字请回 LiveBench 核对。`,
    pairs
  };
}

function consensusFor(model, boardId) {
  const scores = [];
  if (boardId === "overall" && Number.isFinite(model.liveRow && model.liveRow.scores.overall) && Number.isFinite(model.aa && model.aa.intelligenceIndex)) {
    return null;
  }
  if (Number.isFinite(model.liveRow && model.liveRow.scores[boardId])) {
    scores.push(model.liveRow.scores[boardId]);
  }
  return scores.length >= 2 ? roundScore(mean(scores)) : null;
}

function evidenceCount(model) {
  let count = 0;
  if (model.liveRow) {
    count += 1;
  }
  if (model.aa && Number.isFinite(model.aa.intelligenceIndex)) {
    count += 1;
  }
  return count || null;
}

function evidenceLabel(model) {
  const parts = [];
  if (model.liveRow) {
    parts.push("LiveBench");
  }
  if (model.aa && Number.isFinite(model.aa.intelligenceIndex)) {
    parts.push("Artificial Analysis");
  }
  return parts.join(" + ");
}

function revisionOf(payload) {
  return crypto.createHash("sha256").update(JSON.stringify({
    checkedAt: payload.checkedAt,
    fxDate: payload.fxDate,
    boards: payload.boards,
    models: payload.models
  })).digest("hex").slice(0, 16);
}

function liveBenchDatesIn(text) {
  const dates = [];
  for (const match of String(text || "").matchAll(/table_(\d{4})_(\d{2})_(\d{2})\.csv/g)) {
    const iso = `${match[1]}-${match[2]}-${match[3]}`;
    if (isIsoDate(iso)) {
      dates.push(iso);
    }
  }
  return [...new Set(dates)].sort();
}

async function listLiveBenchDates() {
  try {
    const text = await curl("https://api.github.com/repos/LiveBench/livebench.github.io/git/trees/main?recursive=1", {
      accept: "application/vnd.github+json",
      headers: { "X-GitHub-Api-Version": "2022-11-28" },
      maxTime: "20"
    });
    const data = parseJson(text, "LiveBench 文件列表");
    if (data && !data.truncated && Array.isArray(data.tree)) {
      const dates = [];
      for (const item of data.tree) {
        const match = String(item.path || "").match(/(?:^|\/)table_(\d{4})_(\d{2})_(\d{2})\.csv$/);
        if (!match) {
          continue;
        }
        const iso = `${match[1]}-${match[2]}-${match[3]}`;
        if (isIsoDate(iso)) {
          dates.push(iso);
        }
      }
      const unique = [...new Set(dates)].sort();
      if (unique.length) {
        return unique;
      }
    }
  } catch (_error) {
    // The contents API shares an unauthenticated quota. The public file page below does not.
  }
  try {
    const page = await curl("https://github.com/LiveBench/livebench.github.io/tree/main/public", {
      accept: "text/html",
      maxTime: "20"
    });
    return liveBenchDatesIn(page);
  } catch (_error) {
    return [];
  }
}

async function fetchLiveBench(previousDate) {
  let js = "";
  try {
    const home = await curl(`${LIVEBENCH}/`, { maxTime: "20" });
    const script = (home.match(/src="(\.\/static\/js\/main\.[A-Za-z0-9._-]+\.js)"/) || [])[1];
    if (script && /^\.\/static\/js\/main\.[A-Za-z0-9._-]+\.js$/.test(script)) {
      js = await curl(`${LIVEBENCH}/${script.slice(2)}`, { accept: "*/*", maxTime: "20" });
    }
  } catch (_error) {
    js = "";
  }
  const listed = await listLiveBenchDates();
  const dates = liveBenchTryOrder(listed, extractLiveBenchDates(js), previousDate);
  let hit = null;
  for (const date of dates) {
    hit = await tryLiveBenchTable(date);
    if (hit) {
      break;
    }
  }
  if (!hit) {
    throw new Error("LiveBench 没有核到可解析的公示快照");
  }
  const stamp = hit.stamp;
  const tableText = hit.tableText;
  let catText = "";
  for (const source of liveBenchFileUrls(`categories_${stamp}.json`)) {
    try {
      const text = await curl(source.url, { maxTime: "15", accept: source.accept, headers: source.headers });
      if ((text.trim().startsWith("{") || text.trim().startsWith("[")) && !/"message"\s*:/.test(text.slice(0, 120))) {
        catText = text;
        break;
      }
    } catch (_error) {
      // try next url
    }
  }
  let costText = "";
  for (const source of liveBenchFileUrls(`cost_${stamp}.csv`)) {
    try {
      const text = await curl(source.url, { maxTime: "15", accept: source.accept, headers: source.headers });
      if (text.includes("input_price_per_million") && !text.startsWith("<") && !text.startsWith("{")) {
        costText = text;
        break;
      }
    } catch (_error) {
      // 报价缺失时价格留空，不挡住分数。
    }
  }
  if (!catText) {
    throw new Error("LiveBench 分类没有核到");
  }
  const categories = parseJson(catText, "LiveBench 分类");
  const table = parseCsv(tableText);
  if (!table.length) {
    throw new Error("LiveBench 表格是空的");
  }
  const costRows = costText.includes("input_price_per_million") ? parseCsv(costText) : [];
  const costMap = {};
  for (const row of costRows) {
    costMap[row.model] = {
      cache: null,
      input: numberOrNull(row.input_price_per_million),
      output: numberOrNull(row.output_price_per_million)
    };
  }
  return {
    snapshot: hit.date,
    categories,
    rows: liveBenchRows(table, categories, extractLiveBenchMeta(js)),
    costMap
  };
}

async function fetchAaOnce() {
  const html = await curl(AA_BOARD, { maxBuffer: 12 * 1024 * 1024, maxTime: "70" });
  if (!html.includes("intelligenceIndex") || html.length < 20000) {
    throw new Error("Artificial Analysis 榜页没有拿到可解析内容");
  }
  const records = parseAaModels(html);
  const models = collapseAaFamilies(records);
  if (!models.length) {
    throw new Error("Artificial Analysis 没有解析到综合分");
  }
  return models;
}

async function fetchAa() {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetchAaOnce();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Artificial Analysis 榜页没有拿到可解析内容");
}

async function fetchFx() {
  const data = parseJson(await curl(FX_URL, { accept: "application/json" }), "汇率");
  const rate = numberOrNull(data && data.rates && data.rates.CNY);
  if (!rate) {
    throw new Error("没有拿到美元兑人民币汇率");
  }
  return { date: data.date || "", rate };
}

async function fetchOpenRouter() {
  try {
    const data = parseJson(await curl(OPENROUTER, { accept: "application/json" }), "OpenRouter");
    return parseOpenRouter(data);
  } catch (_error) {
    return [];
  }
}

async function fetchLmArena() {
  try {
    const html = await curl(LMARENA, { maxTime: "12" });
    if (html && html.length > 2000 && !/just a moment|cf-browser/i.test(html)) {
      return { ok: true };
    }
  } catch (_error) {
    // 站点经常超时，不编造 Elo
  }
  return { ok: false };
}

function mergeModel(base) {
  return {
    slug: base.slug,
    name: base.name,
    org: inferOrg(base.org, base.name, base.slug),
    releasedOn: base.releasedOn || "",
    url: base.officialUrl || "",
    officialUrl: base.officialUrl || "",
    officialLabel: base.officialLabel || "",
    logo: localLogo(base.org, base.name, base.slug),
    prices: base.prices || { cache: null, input: null, output: null },
    priceSource: base.priceSource || "",
    evidenceCount: base.evidenceCount,
    evidenceLabel: base.evidenceLabel || "",
    evidenceConfidence: base.evidenceCount >= 2 ? "multi" : "single",
    evidenceNote: base.evidenceCount >= 2
      ? "两家以上机构有公示分，共识指数只在量纲相同且不少于两项时计算。"
      : "目前只有一家机构的可核对分数。",
    scores: base.scores || {},
    ranks: base.ranks || {},
    capabilityProfile: base.capabilityProfile || [],
    rankUnderstanding: base.rankUnderstanding || null,
    rankUnderstandings: base.rankUnderstandings || {},
    behindTheScore: base.behindTheScore || [],
    liveSnapshot: base.liveSnapshot || "",
    liveRaw: base.liveRaw || ""
  };
}

async function refresh() {
  const previous = readCache();
  try {
    let live = null;
    let aaModels = [];
    let fx = { date: "", rate: null };
    const errors = [];

    try {
      live = await fetchLiveBench(previous && previous.payload && previous.payload.sourceDates && previous.payload.sourceDates.livebench);
    } catch (error) {
      errors.push(error.message);
    }
    await sleep(200);
    try {
      aaModels = await fetchAa();
    } catch (error) {
      errors.push(error.message);
    }
    try {
      fx = await fetchFx();
    } catch (error) {
      errors.push(error.message);
    }
    const openrouter = await fetchOpenRouter();
    const arena = await fetchLmArena();
    if (!live && !aaModels.length) {
      throw new Error(errors.join("；") || "主流测评站都没有拿到可解析数据");
    }

    const catalog = new Map();

    function upsert(partial) {
      const current = catalog.get(partial.slug) || {
        slug: partial.slug,
        name: partial.name,
        org: "",
        releasedOn: "",
        officialUrl: "",
        officialLabel: "",
        logo: "",
        scores: {},
        liveRow: null,
        aa: null,
        usdPrices: null
      };
      current.name = current.name || partial.name;
      current.org = inferOrg(current.org || partial.org, current.name, current.slug);
      current.releasedOn = current.releasedOn || partial.releasedOn || "";
      current.officialUrl = partial.officialUrl || current.officialUrl;
      current.officialLabel = partial.officialLabel || current.officialLabel;
      current.logo = localLogo(current.org, current.name, current.slug);
      if (partial.liveRow) {
        current.liveRow = partial.liveRow;
        current.liveRaw = partial.liveRow.raw;
        current.liveSnapshot = live ? live.snapshot : "";
      }
      if (partial.aa) {
        current.aa = partial.aa;
        current.usdPrices = partial.usdPrices || current.usdPrices;
      }
      if (partial.usdPrices) {
        current.usdPrices = current.usdPrices || partial.usdPrices;
      }
      catalog.set(partial.slug, current);
      return current;
    }

    for (const item of aaModels) {
      upsert({
        slug: item.slug,
        name: item.name,
        org: item.org,
        releasedOn: item.releasedOn,
        officialUrl: item.officialUrl,
        officialLabel: item.officialLabel,
        logo: item.logo,
        aa: item.aa,
        usdPrices: item.usdPrices
      });
    }

    if (live) {
      for (const row of live.rows) {
        const matched = bestMatch(`${row.family} ${row.name}`, [...catalog.values()], (item) => `${item.slug} ${item.name}`);
        const slug = matched ? matched.slug : row.family || slugify(row.name);
        upsert({
          slug,
          name: (matched && matched.name) || row.name,
          org: (matched && matched.org) || row.org,
          releasedOn: (matched && matched.releasedOn) || row.releasedOn,
          officialUrl: (matched && matched.officialUrl) || row.officialUrl,
          officialLabel: (matched && matched.officialLabel) || row.officialLabel,
          liveRow: row
        });
      }
    }

    for (const model of catalog.values()) {
      const priced = attachPrices(model, fx.rate, openrouter, live ? live.costMap : {});
      model.prices = priced.prices;
      model.priceSource = priced.priceSource;
      model.evidenceCount = evidenceCount(model);
      model.evidenceLabel = evidenceLabel(model);
      model.scores = {
        overall: Number.isFinite(model.aa && model.aa.intelligenceIndex)
          ? roundScore(model.aa.intelligenceIndex)
          : null,
        coding: model.liveRow ? model.liveRow.scores.coding : null,
        reasoning: model.liveRow ? model.liveRow.scores.reasoning : null,
        professional: model.liveRow ? model.liveRow.scores.professional : null
      };
      model.consensus = {
        overall: consensusFor(model, "overall"),
        coding: consensusFor(model, "coding"),
        reasoning: consensusFor(model, "reasoning"),
        professional: consensusFor(model, "professional")
      };
      const liveCards = model.liveRow ? capabilityFromLiveBench(model.liveRow) : [];
      const aaCards = capabilityFromAa(model.aa).filter((card) => !card.unmeasured);
      model.capabilityProfile = [...aaCards, ...liveCards];
      model.behindTheScore = evidenceGroups(model);
    }

    const list = [...catalog.values()];
    const boards = BOARDS.map((board) => {
      let ranked;
      if (board.id === "overall") {
        ranked = list
          .filter((item) => Number.isFinite(item.scores.overall))
          .sort((left, right) => {
            const aaLeft = Number.isFinite(left.aa && left.aa.intelligenceIndex);
            const aaRight = Number.isFinite(right.aa && right.aa.intelligenceIndex);
            if (aaLeft !== aaRight) {
              return aaLeft ? -1 : 1;
            }
            return right.scores.overall - left.scores.overall;
          });
      } else {
        ranked = list
          .filter((item) => Number.isFinite(item.scores[board.id]))
          .sort((left, right) => right.scores[board.id] - left.scores[board.id]);
      }
      ranked = ranked.slice(0, MAX_PER_BOARD);
      ranked.forEach((item, index) => {
        item.ranks = item.ranks || {};
        item.ranks[board.id] = index + 1;
      });
      return {
        id: board.id,
        label: board.label,
        url: board.id === "overall" ? AA_BOARD : LIVEBENCH,
        models: ranked.map((item) => item.slug)
      };
    });

    for (const model of list) {
      model.rankUnderstandings = {};
      for (const board of boards) {
        if (board.models.includes(model.slug) || Number.isFinite(model.scores[board.id])) {
          model.rankUnderstandings[board.id] = rankUnderstanding(board.id, model.slug, list);
        }
      }
      const firstBoard = boards.find((board) => board.models.includes(model.slug));
      model.rankUnderstanding = model.rankUnderstandings[firstBoard ? firstBoard.id : "overall"]
        || rankUnderstanding("overall", model.slug, list);
    }

    const liveNote = live
      ? `LiveBench 官方最新核到的公示快照 ${live.snapshot}`
      : "LiveBench 本次未核到";
    const aaNote = aaModels.length ? `Artificial Analysis 核到 ${aaModels.length} 个模型族` : "Artificial Analysis 本次未核到";
    const arenaNote = arena.ok ? "LMArena 页面可打开" : "LMArena 本次超时，未写入分数";
    const fxNote = fx.rate
      ? `美元报价按 Frankfurter ${fx.date || "当日"} 汇率 1 美元 = ${fx.rate} 元人民币折算。`
      : "没有核到汇率，价格留空。";

    const payload = {
      timezone: "Asia/Shanghai",
      checkedAt: new Date().toISOString(),
      fxDate: fx.date || "",
      fxRate: fx.rate,
      footnote: [
        "综合榜按 Artificial Analysis Intelligence Index 排序；编程、推理、专业办公按 LiveBench 对应分类的已公示任务等权平均。",
        "共识指数只在两家机构都给出可直接对照的 0–100 分时才等权计算，否则留空。",
        `${liveNote}。${aaNote}。${arenaNote}。`,
        fxNote,
        "价格来自测评站或 OpenRouter 的公开美元报价，不是厂商官网人民币价。没有核到的字段留空。"
      ].join(""),
      sourceDates: {
        aa: aaModels.length ? new Date().toISOString() : "",
        livebench: live ? live.snapshot : "",
        lmarena: arena.ok ? new Date().toISOString() : ""
      },
      arenaOk: Boolean(arena.ok),
      sources: [
        { label: "Artificial Analysis", url: AA_BOARD },
        { label: "LiveBench", url: LIVEBENCH },
        ...(arena.ok ? [{ label: "LMArena", url: LMARENA }] : [])
      ],
      boards,
      models: Object.fromEntries(list.filter((item) => boards.some((board) => board.models.includes(item.slug))).map((item) => {
        const model = mergeModel(item);
        model.scores = {
          overall: item.scores.overall,
          coding: item.scores.coding,
          reasoning: item.scores.reasoning,
          professional: item.scores.professional
        };
        model.rankScores = item.scores;
        model.consensus = item.consensus;
        return [item.slug, model];
      }))
    };

    const next = {
      source: AA_BOARD,
      fetchedAt: new Date().toISOString(),
      revision: revisionOf(payload),
      ok: true,
      lastError: errors.length ? { at: new Date().toISOString(), message: errors.join("；") } : null,
      etags: {},
      payload
    };
    writeCache(next);
    return next;
  } catch (error) {
    const failed = {
      ...previous,
      ok: false,
      lastError: {
        at: new Date().toISOString(),
        message: error.message || "核验失败"
      }
    };
    writeCache(failed);
    console.error("模型榜核验失败，已保留上次记录：", failed.lastError.message);
    return failed;
  }
}

function decorateCache(cache) {
  const payload = cache && cache.payload;
  const models = payload && payload.models;
  if (!models) {
    return false;
  }
  let changed = false;
  const aaMissing = /Artificial Analysis 本次未核到/.test(payload.footnote || "");
  if (aaMissing) {
    const overall = (payload.boards || []).find((board) => board.id === "overall");
    if (overall && overall.models.length) {
      overall.models = [];
      changed = true;
    }
  }
  for (const model of Object.values(models)) {
    const org = inferOrg(model.org, model.name, model.slug);
    const logo = localLogo(org, model.name, model.slug);
    if (org !== (model.org || "") || logo !== (model.logo || "")) {
      model.org = org;
      model.logo = logo;
      changed = true;
    }
    if (aaMissing && model.scores && model.scores.overall != null && !String(model.evidenceLabel || "").includes("Artificial Analysis")) {
      model.scores.overall = null;
      if (model.ranks) {
        model.ranks.overall = null;
      }
      changed = true;
    }
  }
  return changed;
}

function start() {
  const cache = readCache();
  if (decorateCache(cache)) {
    writeCache(cache);
  }
  refresh();
  if (timer) {
    clearInterval(timer);
  }
  timer = setInterval(() => {
    refresh();
  }, POLL_MS);
  if (timer.unref) {
    timer.unref();
  }
}

function repair() {
  const previous = readCache();
  if (decorateCache(previous)) {
    writeCache(previous);
  }
  return previous;
}

module.exports = {
  ORIGIN: LIVEBENCH,
  POLL_MS,
  CACHE_FILE,
  BOARDS,
  readCache,
  refresh,
  repair,
  start,
  inferOrg,
  localLogo,
  modelKey,
  decorateCache
};
