import { createAgentSession, SessionManager, DefaultResourceLoader, defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const SEARCH_TEXT = process.env.SEARCH_TEXT || process.argv[2] || "machine learning research papers";
const MAX_RESULTS = parseInt(process.env.MAX_RESULTS || "20", 10);

function extractPdfUrls(text) {
  if (!text) return [];
  const urlRegex = /https?:\/\/[^\s<>"]+\.pdf(?:[?#][^\s<>"]*)?/gi;
  const urls = text.match(urlRegex) || [];
  const normalized = urls.map(u => {
    const cleaned = u.replace(/['")\\]$/, "").replace(/^['"\(]/, "");
    return cleaned.replace(/\s+/g, "");
  });
  return [...new Set(normalized)];
}

const searchWebTool = defineTool({
  name: "search_web",
  label: "Search Web for PDFs",
  description: "Search the web for PDF documents matching a query. Returns PDF URLs from ArXiv, Semantic Scholar, and general web sources.",
  parameters: Type.Object({
    query: Type.String({ description: "Search query to find PDF documents" }),
    source: Type.Optional(Type.String({ description: "Source to search: arxiv, semantic-scholar, or web", enum: ["arxiv", "semantic-scholar", "web"] })),
  }),
  async execute(_toolCallId, { query, source = "web" }, _signal, _onUpdate, _ctx) {
    const urls = [];

    if (source === "arxiv" || source === "web") {
      try {
        const arxivUrl = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=20`;
        const response = await fetch(arxivUrl, { signal: AbortSignal.timeout(15000) });
        const body = await response.text();
        const pdfMatches = body.match(/https?:\/\/[^\s\"<>]+\.pdf/gi) || [];
        urls.push(...pdfMatches);
      } catch {
        // ArXiv search failed, continue to other sources
      }
    }

    if (source === "semantic-scholar" || source === "web") {
      try {
        const scholarUrl = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=20&fields=pdfUrl,title`;
        const response = await fetch(scholarUrl, { signal: AbortSignal.timeout(15000) });
        const data = await response.json();
        if (data.data) {
          for (const paper of data.data) {
            if (paper.pdfUrl && paper.pdfUrl.endsWith(".pdf")) {
              urls.push(paper.pdfUrl);
            }
          }
        }
      } catch {
        // Scholar search failed, continue
      }
    }

    if (source === "web") {
      try {
        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}+filetype:pdf`;
        const response = await fetch(searchUrl, { signal: AbortSignal.timeout(15000) });
        const body = await response.text();
        const linkMatches = body.match(/https?:\/\/[^\s\"<>]+\.pdf/gi) || [];
        urls.push(...linkMatches);
      } catch {
        // Web search failed
      }
    }

    const unique = [...new Set(urls)].slice(0, MAX_RESULTS);
    return {
      content: [{
        type: "text",
        text: `Found ${unique.length} PDF URLs for "${query}":\n${unique.map((u, i) => `${i + 1}. ${u}`).join("\n")}`,
      }],
    };
  },
});

async function main() {
  console.log(`[pi-agent] Starting PDF search for: "${SEARCH_TEXT}"`);
  console.log(`[pi-agent] Max results: ${MAX_RESULTS}`);

  const piDir = join(process.cwd(), ".pi");
  if (!existsSync(piDir)) {
    mkdirSync(piDir, { recursive: true });
  }

  const modelsJson = join(piDir, "models.json");
  if (!existsSync(modelsJson)) {
    const modelConfig = {
      providers: {
        ollama: {
          baseUrl: process.env.MODEL_SERVER_BASE_URL || "http://localhost:11434/v1",
          api: "openai-completions",
          models: [
            {
              id: process.env.MODEL_NAME || "qwen3.5:9b",
              name: process.env.MODEL_NAME || "qwen3.5:9b",
              api: "openai-completions",
              reasoning: false,
              thinkingLevelMap: {},
              input: ["text"],
              cost: { input: 0, output: 0 },
              contextWindow: 128000,
              maxTokens: 4096,
            },
          ],
        },
      },
    };
    writeFileSync(modelsJson, JSON.stringify(modelConfig, null, 2), "utf8");
    console.log(`[pi-agent] Created models.json at ${modelsJson}`);
  }

  const authJson = join(piDir, "auth.json");
  if (!existsSync(authJson)) {
    writeFileSync(authJson, JSON.stringify({}, null, 2), "utf8");
  }

  const { session } = await createAgentSession({
    resourceLoader: new DefaultResourceLoader({cwd: process.cwd(), agentDir: process.cwd()}),
    sessionManager: SessionManager.create(process.cwd()),
    customTools: [searchWebTool],
  });

  const prompt = `Search the internet for PDF documents related to: "${SEARCH_TEXT}". Use the search_web tool to find as many PDF links as possible from ArXiv, Semantic Scholar, and general web sources. Return all unique PDF URLs you find. Be thorough - search multiple sources and queries. Output the full list of PDF URLs found.`;

  console.log(`[pi-agent] Sending prompt to model...`);
  await session.prompt(prompt);

  const lastMessage = session.state.messages[session.state.messages.length - 1];
  const responseText = lastMessage.content.map((c) => c.text || "").join("\n");
  console.log(`[pi-agent] Agent response received.`);

  const pdfUrls = extractPdfUrls(responseText);
  console.log(`[pi-agent] Extracted ${pdfUrls.length} PDF URLs from response.`);

  if (pdfUrls.length === 0) {
    const fallbackText = session.state.messages.map(m => m.content.map(c => c.text || "").join("\n")).join("\n");
    const fallbackUrls = extractPdfUrls(fallbackText);
    console.log(`[pi-agent] Checking full conversation history for PDF URLs... got ${fallbackUrls.length}`);
    if (fallbackUrls.length > 0) {
      pdfUrls.push(...fallbackUrls);
    }
  }

  const uniqueUrls = [...new Set(pdfUrls)].slice(0, MAX_RESULTS);
  const output = uniqueUrls.map((url, i) => `${i + 1}. ${url}`).join("\n");

  writeFileSync("pdf-links.txt", `PDF links for: ${SEARCH_TEXT}\nTotal found: ${uniqueUrls.length}\n\n${output}\n`, "utf8");

  console.log(`[pi-agent] Wrote ${uniqueUrls.length} PDF links to pdf-links.txt`);
  console.log(`[pi-agent] Agent harness: pi.dev (pi-coding-agent SDK)`);
}

main().catch((err) => {
  console.error("[pi-agent] Error:", err.message);
  console.error("[pi-agent] Stack:", err.stack);
  process.exit(1);
});
