import { writeFileSync } from "node:fs";

async function fetchPage(url) {
  const response = await fetch(url);
  return await response.text();
}

async function main() {
  const html = await fetchPage("https://html.duckduckgo.com/html/?q=example");
  const titleMatches = html.match(/<a[^>]*class="result__title[^"]*"[^>]*>([^<]+)<\/a>/g) || [];
  const urlMatches = html.match(/<a[^>]*class="result__url[^"]*"[^>]*href="([^"]+)"/g) || [];
  console.log("Title matches:", titleMatches.length);
  console.log("URL matches:", urlMatches.length);
}

main();
