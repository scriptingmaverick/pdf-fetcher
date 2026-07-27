import { writeFileSync } from "node:fs";

const SEARCH_TEXT = process.argv[2] || "machine learning research papers";
const MAX_RESULTS = parseInt(process.env.MAX_RESULTS || "30", 10);

async function fetchPage(url, timeoutMs = 15000) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

function extractPdfUrls(text) {
  const urlRegex = /https?:\/\/[^\s<>"]+\.pdf(?:[?#][^\s<>"]*)?/gi;
  const urls = text.match(urlRegex) || [];
  const normalized = urls.map(u => {
    const cleaned = u.replace(/['")\\]$/, "").replace(/^['"\(]/, "");
    return cleaned.replace(/\s+/g, "");
  });
  return [...new Set(normalized)].filter(url => url.length > 20 && url.endsWith('.pdf'));
}

async function searchArxiv(query) {
  const searchUrl = `https://arxiv.org/search/query?q=${encodeURIComponent(query)}&searchtype=all&size=100`;
  const html = await fetchPage(searchUrl);
  if (!html) return [];

  const pdfUrls = html.match(/https?:\/\/arxiv\.org\/pdf\/[a-zA-Z0-9.\-_]+\.pdf/g) || [];
  return pdfUrls;
}

async function searchSemanticScholar(query) {
  const searchUrl = `https://www.semanticscholar.org/search?q=${encodeURIComponent(query)}`;
  const html = await fetchPage(searchUrl);
  if (!html) return [];

  const pdfUrls = html.match(/https?:\/\/pdfs?\.semanticscholar\.org\/[^\s\]]+\.pdf/g) || [];
  return pdfUrls;
}

async function main() {
  console.log("[pdf-scraper] Starting web scraping for: \"" + SEARCH_TEXT + "\"");
  console.log("[pdf-scraper] Max results: " + MAX_RESULTS);

  const allUrls = [];

  console.log("[pdf-scraper] Searching ArXiv for: \"" + SEARCH_TEXT + "\"");
  const arxivUrls = await searchArxiv(SEARCH_TEXT);
  console.log("[pdf-scraper] Found " + arxivUrls.length + " PDFs on ArXiv");
  allUrls.push(...arxivUrls);

  console.log("[pdf-scraper] Searching Semantic Scholar for: \"" + SEARCH_TEXT + "\"");
  const scholarUrls = await searchSemanticScholar(SEARCH_TEXT);
  console.log("[pdf-scraper] Found " + scholarUrls.length + " PDFs on Semantic Scholar");
  allUrls.push(...scholarUrls);

  const finalUniqueUrls = [...new Set(allUrls)].filter(url => url.endsWith('.pdf') && url.length > 20).slice(0, MAX_RESULTS);

  console.log("[pdf-scraper] Discovered " + finalUniqueUrls.length + " unique PDF URLs.");

  const output = finalUniqueUrls.map((url, i) => (i + 1) + ". " + url).join("\n");

  writeFileSync("pdf-links.txt", "PDF links for: " + SEARCH_TEXT + "\nTotal found: " + finalUniqueUrls.length + "\nSources searched: ArXiv, Semantic Scholar\n\n" + output + "\n", "utf8");

  console.log("[pdf-scraper] Wrote " + finalUniqueUrls.length + " PDF links to pdf-links.txt");
}

main().catch((err) => {
  console.error("[pdf-scraper] Error:", err.message);
  console.error("[pdf-scraper] Stack:", err.stack);
  process.exit(1);
});
