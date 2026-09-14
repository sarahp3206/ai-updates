const CATEGORY_LABELS = { news: "News", model: "Model updates" };

const state = {
  items: [],
  sources: [],
  activeCategory: null,
  activeSource: null,
  activeTag: null,
  query: "",
};

const el = {
  meta: document.getElementById("meta"),
  search: document.getElementById("search"),
  categoryChips: document.getElementById("category-chips"),
  sourceChips: document.getElementById("source-chips"),
  tagChips: document.getElementById("tag-chips"),
  list: document.getElementById("list"),
  empty: document.getElementById("empty"),
  resultCount: document.getElementById("result-count"),
  clearFilters: document.getElementById("clear-filters"),
};

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function buildChips(container, values, activeKey, onPick, labelFor = (v) => v) {
  container.innerHTML = "";
  const allChip = document.createElement("button");
  allChip.className = "chip" + (activeKey === null ? " active" : "");
  allChip.textContent = "All";
  allChip.onclick = () => onPick(null);
  container.appendChild(allChip);

  for (const v of values) {
    const chip = document.createElement("button");
    chip.className = "chip" + (activeKey === v ? " active" : "");
    chip.textContent = labelFor(v);
    chip.onclick = () => onPick(activeKey === v ? null : v);
    container.appendChild(chip);
  }
}

function matches(item) {
  if (state.activeCategory && item.category !== state.activeCategory) return false;
  if (state.activeSource && item.source !== state.activeSource) return false;
  if (state.activeTag && !item.tags.includes(state.activeTag)) return false;
  if (state.query) {
    const q = state.query.toLowerCase();
    if (!item.title.toLowerCase().includes(q) && !item.summary.toLowerCase().includes(q)) return false;
  }
  return true;
}

function render() {
  const filtered = state.items.filter(matches);

  el.resultCount.textContent = `${filtered.length} update${filtered.length === 1 ? "" : "s"}`;
  const hasFilters = state.activeCategory || state.activeSource || state.activeTag || state.query;
  el.clearFilters.hidden = !hasFilters;

  el.list.innerHTML = "";
  el.empty.hidden = filtered.length !== 0;

  let lastDay = null;
  for (const item of filtered) {
    const day = dayLabel(item.date);
    if (day !== lastDay) {
      const divider = document.createElement("div");
      divider.className = "day-divider";
      divider.textContent = day;
      el.list.appendChild(divider);
      lastDay = day;
    }

    const card = document.createElement("article");
    card.className = "card";

    const top = document.createElement("div");
    top.className = "card-top";
    const badge = document.createElement("span");
    badge.className = "source-badge";
    badge.textContent = item.source;
    const time = document.createElement("span");
    time.className = "card-time";
    time.textContent = timeAgo(item.date);
    top.append(badge, time);

    const h2 = document.createElement("h2");
    const a = document.createElement("a");
    a.href = item.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = item.title;
    h2.appendChild(a);

    const tagRow = document.createElement("div");
    tagRow.className = "card-tags";
    for (const t of item.tags) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = t;
      tag.onclick = () => {
        state.activeTag = state.activeTag === t ? null : t;
        renderChips();
        render();
      };
      tagRow.appendChild(tag);
    }

    card.append(top, h2);
    if (item.summary || item.discussUrl) {
      const p = document.createElement("p");
      p.textContent = item.summary || "";
      if (item.discussUrl) {
        if (item.summary) p.append(" — ");
        const discuss = document.createElement("a");
        discuss.href = item.discussUrl;
        discuss.target = "_blank";
        discuss.rel = "noopener noreferrer";
        discuss.className = "discuss-link";
        discuss.textContent = "discuss on HN";
        p.appendChild(discuss);
      }
      card.appendChild(p);
    }
    card.appendChild(tagRow);
    el.list.appendChild(card);
  }
}

function renderChips() {
  const categories = [...new Set(state.sources.map((s) => s.category))];
  buildChips(
    el.categoryChips,
    categories,
    state.activeCategory,
    (v) => {
      state.activeCategory = v;
      state.activeSource = null;
      render();
      renderChips();
    },
    (v) => CATEGORY_LABELS[v] || v
  );

  const sourceNames = state.sources
    .filter((s) => !state.activeCategory || s.category === state.activeCategory)
    .map((s) => s.name);
  buildChips(el.sourceChips, sourceNames, state.activeSource, (v) => {
    state.activeSource = v;
    render();
    renderChips();
  });

  const tagCounts = new Map();
  for (const item of state.items) {
    if (state.activeCategory && item.category !== state.activeCategory) continue;
    if (state.activeSource && item.source !== state.activeSource) continue;
    for (const t of item.tags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
  }
  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14)
    .map(([t]) => t);
  buildChips(el.tagChips, topTags, state.activeTag, (v) => {
    state.activeTag = v;
    render();
    renderChips();
  });
}

el.search.addEventListener("input", (e) => {
  state.query = e.target.value.trim();
  render();
});

el.clearFilters.addEventListener("click", () => {
  state.activeCategory = null;
  state.activeSource = null;
  state.activeTag = null;
  state.query = "";
  el.search.value = "";
  render();
  renderChips();
});

async function init() {
  const res = await fetch("data/updates.json", { cache: "no-store" });
  const data = await res.json();
  state.items = data.items;
  state.sources = data.sources;
  el.meta.innerHTML = `${data.count} updates · generated <span title="${data.generatedAt}">${timeAgo(data.generatedAt)}</span>`;
  renderChips();
  render();
}

init().catch((err) => {
  el.list.innerHTML = `<p style="color:var(--text-muted)">Couldn't load updates: ${err.message}. Run <code>npm run fetch</code> first.</p>`;
});
