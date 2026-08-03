// lib/news/hinduRss.js
//
// Headline-only reader for one real, publicly available daily newspaper
// (explicit request) -- The Hindu, the most commonly used UPSC current-
// affairs source, and one with long-standing public RSS feeds (verified
// live before wiring this in). Pulls title/link/pubDate from each section's
// public RSS feed at request time -- deliberately headline + link only,
// never full article text: a student reads the real story on the origin
// site, this app doesn't reproduce it. No new npm dependency -- RSS items
// are a small, regular enough shape that a couple of regexes are simpler
// than pulling in an XML parser for this one use.

const SECTIONS = [
  { id: "national", label: "National", url: "https://www.thehindu.com/news/national/feeder/default.rss" },
  { id: "international", label: "International", url: "https://www.thehindu.com/news/international/feeder/default.rss" },
  { id: "business", label: "Business & Economy", url: "https://www.thehindu.com/business/feeder/default.rss" },
  { id: "sci-tech", label: "Science & Technology", url: "https://www.thehindu.com/sci-tech/feeder/default.rss" },
  { id: "editorial", label: "Editorial (Opinion)", url: "https://www.thehindu.com/opinion/editorial/feeder/default.rss" },
];

const MAX_ITEMS_PER_SECTION = 15;
const FETCH_TIMEOUT_MS = 8000;

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function tagValue(itemXml, tag) {
  const m = itemXml.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`));
  return m ? decodeEntities(m[1].trim()) : "";
}

async function fetchSection(section) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(section.url, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; VidhiOS/1.0)" } });
    if (!res.ok) return { id: section.id, label: section.label, items: [], error: `HTTP ${res.status}` };
    const xml = await res.text();
    const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
    const items = itemBlocks
      .slice(0, MAX_ITEMS_PER_SECTION)
      .map((block) => ({
        title: tagValue(block, "title"),
        link: tagValue(block, "link"),
        pubDate: tagValue(block, "pubDate"),
        category: tagValue(block, "category"),
      }))
      .filter((it) => it.title && it.link);
    return { id: section.id, label: section.label, items };
  } catch (err) {
    return { id: section.id, label: section.label, items: [], error: err.message };
  } finally {
    clearTimeout(timeout);
  }
}

/** Today's headlines from every section, fetched live each call -- the feeds' own TTL is 60 minutes so nothing here needs its own cache/storage. */
export async function fetchDailyNewspaper() {
  const sections = await Promise.all(SECTIONS.map(fetchSection));
  return { source: "The Hindu", sourceUrl: "https://www.thehindu.com/", sections };
}
