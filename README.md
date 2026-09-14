# Signal — AI updates for practitioners

A small static site that surfaces top AI news and top AI model releases,
tagged by practitioner-relevant topics (fine-tuning, inference, agents, RAG,
evaluation, etc).

## Sources

- **News**: OpenAI blog, Google DeepMind blog, Hacker News (AI stories with 50+ points)
- **Model updates**: Hugging Face trending models, last 30 days

Anthropic, Meta, and Mistral don't publish a working RSS feed at the moment,
so their major announcements currently only show up if they get picked up on
Hacker News. See `scripts/fetch-updates.mjs` — the `fetchBlog()` helper can
be pointed at any RSS/Atom feed if you find working ones.

## Usage

```bash
npm run fetch   # pulls fresh data into public/data/updates.json
npm run serve   # serves the site at http://localhost:5173
```

`public/` is fully self-contained (HTML/CSS/JS + `data/updates.json`) so it
can be deployed as-is to any static host.

## Keeping it fresh

`.github/workflows/update.yml` refreshes the data twice a day (07:00 and
19:00 UTC) via GitHub Actions, commits the updated `public/data/updates.json`,
and deploys `public/` to GitHub Pages. To use it:

1. Push this repo to GitHub.
2. In the repo's Settings → Pages, set Source to "GitHub Actions".
3. The workflow runs automatically on the schedule (and on every push to `main`).

## Tuning relevance

- `TAG_RULES` in `scripts/fetch-updates.mjs` controls the practitioner tags
  (fine-tuning, inference, agents, RAG, evaluation, MoE, …).
- `HN_RELEVANCE_RE` is a safety net that keeps Hacker News stories to ones
  whose title plainly references AI, since Algolia's fuzzy search
  occasionally lets an unrelated story through.
- Hugging Face models are sorted by trending score and filtered to the last
  30 days, rather than "newest", since newest is dominated by one-off
  zero-download uploads.
