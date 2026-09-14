// Fetches top AI news and top AI model updates, tags them by practitioner
// relevance, merges + dedupes, and writes data/updates.json.
//
// No external dependencies (Node 18+ global fetch). Every source fetch is
// wrapped so one failing source never breaks the whole build.

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "..", "public", "data", "updates.json");

const MAX_ITEMS_PER_SOURCE = 40;
const TOTAL_ITEM_CAP = 150;

// ---------------------------------------------------------------------------
// Tagging: keyword -> practitioner-facing tag. First match wins per keyword;
// an item can carry multiple tags.
// ---------------------------------------------------------------------------
const TAG_RULES = [
  [/fine-?tun|lora|peft|qlora/i, "fine-tuning"],
  [/quantiz/i, "quantization"],
  [/inference|latency|throughput|serving/i, "inference"],
  [/benchmark/i, "benchmarks"],
  [/\beval(uation)?\b/i, "evaluation"],
  [/\bagent(ic)?\b|tool.?use|tool.?calling/i, "agents"],
  [/retrieval.augmented|\brag\b/i, "RAG"],
  [/reinforcement learning|\brlhf\b|\brlaif\b|reward model/i, "RL/RLHF"],
  [/multimodal|vision-language|image-text|video understanding/i, "multimodal"],
  [/open.?weight|open.?source model|apache 2\.0|open-source/i, "open-weights"],
  [/safety|alignment|jailbreak|red.?team/i, "safety/alignment"],
  [/reasoning|chain.of.thought/i, "reasoning"],
  [/long.context|context window/i, "long-context"],
  [/dataset|corpus/i, "datasets"],
  [/diffusion|text-to-image|text-to-video/i, "generative media"],
  [/embedding|vector search|semantic search/i, "embeddings"],
  [/mixture.of.experts|\bmoe\b/i, "MoE"],
  [/gpu|cuda|kernel|flash.?attention/i, "systems/perf"],
];

function tagFor(text) {
  const tags = new Set();
  for (const [re, tag] of TAG_RULES) {
    if (re.test(text)) tags.add(tag);
  }
  return [...tags];
}

function stripHtml(s = "") {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(s, n = 280) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

async function safeFetch(url, opts = {}) {
  try {
    const res = await fetch(url, { ...opts, headers: { "User-Agent": "ai-updates-digest/1.0", ...opts.headers } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } catch (err) {
    console.warn(`[skip] ${url} -> ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Model updates: Hugging Face models trending in the last month (what's
// actually shipping AND getting practitioner traction — plain "newest" is
// dominated by one-off zero-download uploads, so we sort by trending score
// and then keep only recent ones).
// ---------------------------------------------------------------------------
async function fetchHfModels() {
  const url = `https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=100&full=false`;
  const res = await safeFetch(url);
  if (!res) return [];
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recent = data
    .filter((d) => d.createdAt && new Date(d.createdAt).getTime() >= cutoff)
    .slice(0, MAX_ITEMS_PER_SOURCE);
  return recent.map((d) => {
    const title = d.id || "";
    const pipeline = d.pipeline_tag ? ` · ${d.pipeline_tag}` : "";
    const summary = `New model on Hugging Face${pipeline}. ${d.downloads ?? 0} downloads, ${d.likes ?? 0} likes.`;
    const extraTags = d.pipeline_tag ? [d.pipeline_tag.replace(/-/g, " ")] : [];
    return {
      title,
      url: title ? `https://huggingface.co/${title}` : null,
      source: "Hugging Face Models",
      category: "model",
      date: d.createdAt ? new Date(d.createdAt).toISOString() : null,
      summary,
      tags: [...new Set([...tagFor(title), ...extraTags, "new-model"])],
    };
  }).filter((i) => i.url && i.date);
}

// ---------------------------------------------------------------------------
// News: generic RSS 2.0 reader (used for OpenAI + Google DeepMind blogs)
// ---------------------------------------------------------------------------
function parseRss(xml, source) {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  return items.map((item) => {
    const title = stripHtml((item.match(/<title>([\s\S]*?)<\/title>/) || [, ""])[1]);
    const link = stripHtml((item.match(/<link>([\s\S]*?)<\/link>/) || [, ""])[1]);
    const desc = stripHtml((item.match(/<description>([\s\S]*?)<\/description>/) || [, ""])[1]);
    const pubDate = (item.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [, ""])[1];
    return {
      title,
      url: link,
      source,
      category: "news",
      date: pubDate ? new Date(pubDate).toISOString() : null,
      summary: truncate(desc),
      tags: tagFor(`${title} ${desc}`),
    };
  }).filter((i) => i.url && i.date);
}

async function fetchBlog(url, source) {
  const res = await safeFetch(url);
  if (!res) return [];
  const xml = await res.text();
  return parseRss(xml, source).slice(0, MAX_ITEMS_PER_SOURCE);
}

// Algolia's search has typo-tolerant fuzzy matching that occasionally lets
// an unrelated title through (e.g. "LLM" loosely matching "lamps"). Require
// the title itself to plainly reference AI, as a deterministic safety net.
const HN_RELEVANCE_RE =
  /\b(AI|LLMs?|GPT|OpenAI|Anthropic|Claude|Gemini|Mistral|Llama|DeepSeek|Qwen|Grok|GLM|transformer|diffusion model|neural network|machine learning|deep learning|chatbot|agentic|fine-?tun|inference|open.?weight)\b/i;

// ---------------------------------------------------------------------------
// News: Hacker News (Algolia), restricted to title matches on AI terms and
// a points floor so only genuinely "top" stories make it in.
// ---------------------------------------------------------------------------
async function fetchHackerNews() {
  const queries = ["LLM", "AI model", "OpenAI", "Anthropic Claude", "Gemini", "open weights"];
  const seen = new Map();
  for (const q of queries) {
    const url =
      "https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=25&numericFilters=points%3E50&restrictSearchableAttributes=title&query=" +
      encodeURIComponent(q);
    const res = await safeFetch(url);
    if (!res) continue;
    const data = await res.json();
    for (const hit of data.hits || []) {
      if (!hit.url || !hit.objectID) continue;
      if (seen.has(hit.objectID)) continue;
      const title = hit.title || "";
      if (!HN_RELEVANCE_RE.test(title)) continue;
      seen.set(hit.objectID, {
        title,
        url: hit.url,
        source: "Hacker News",
        category: "news",
        date: hit.created_at ? new Date(hit.created_at).toISOString() : null,
        summary: `${hit.points} points, ${hit.num_comments ?? 0} comments — discuss: https://news.ycombinator.com/item?id=${hit.objectID}`,
        tags: tagFor(title),
      });
    }
  }
  return [...seen.values()].filter((i) => i.date);
}

// ---------------------------------------------------------------------------
// Merge, dedupe, sort, cap, write
// ---------------------------------------------------------------------------
function dedupe(items) {
  const byUrl = new Map();
  for (const item of items) {
    const key = item.url.replace(/\/$/, "");
    if (!byUrl.has(key)) byUrl.set(key, item);
  }
  return [...byUrl.values()];
}

async function main() {
  console.log("Fetching top AI news and model updates...");
  const results = await Promise.all([
    fetchHfModels(),
    fetchBlog("https://openai.com/blog/rss.xml", "OpenAI"),
    fetchBlog("https://deepmind.google/blog/rss.xml", "Google DeepMind"),
    fetchHackerNews(),
  ]);

  const [hfModels, openai, deepmind, hn] = results;
  console.log(
    `Hugging Face models: ${hfModels.length}, OpenAI: ${openai.length}, ` +
    `Google DeepMind: ${deepmind.length}, Hacker News: ${hn.length}`
  );

  let items = dedupe(results.flat());
  items.sort((a, b) => new Date(b.date) - new Date(a.date));
  items = items.slice(0, TOTAL_ITEM_CAP);
  items = items.map((item, i) => ({ id: i + 1, ...item }));

  const payload = {
    generatedAt: new Date().toISOString(),
    count: items.length,
    sources: [
      { name: "Hugging Face Models", category: "model", note: "trending models, last 30 days" },
      { name: "OpenAI", category: "news", note: "official blog" },
      { name: "Google DeepMind", category: "news", note: "official blog" },
      { name: "Hacker News", category: "news", note: "top AI stories, 50+ points" },
    ],
    items,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(payload, null, 2), "utf-8");
  console.log(`Wrote ${items.length} items to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
