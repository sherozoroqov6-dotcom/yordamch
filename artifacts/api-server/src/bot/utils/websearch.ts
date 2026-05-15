import { logger } from "../../lib/logger";

const FETCH_TIMEOUT = 12000;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,*/*",
        "Accept-Language": "uz,ru;q=0.9,en;q=0.8",
      },
    });
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, " ")
    .trim();
}

export async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const html = await fetchHtml(url);

    const results: SearchResult[] = [];
    const linkRe = /class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)/g;
    const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    const urlRe = /class="result__url"[^>]*>([\s\S]*?)<\/a>/g;

    const links = [...html.matchAll(linkRe)].slice(0, 8);
    const snippets = [...html.matchAll(snippetRe)].slice(0, 8);
    const urls = [...html.matchAll(urlRe)].slice(0, 8);

    for (let i = 0; i < Math.min(links.length, 5); i++) {
      const rawUrl = urls[i]?.[1]?.trim() || links[i]?.[1] || "";
      const cleanUrl = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl.trim()}`;
      const snippet = snippetRe ? stripHtml(snippets[i]?.[1] || "").slice(0, 300) : "";
      results.push({
        title: stripHtml(links[i]?.[2] || "").trim(),
        url: cleanUrl,
        snippet,
      });
    }

    return results;
  } catch (err) {
    logger.warn({ err }, "DuckDuckGo qidiruv xato");
    return [];
  }
}

export async function fetchPageContent(url: string, maxChars = 4000): Promise<string> {
  try {
    const html = await fetchHtml(url);
    const text = stripHtml(html);
    return text.slice(0, maxChars);
  } catch (err) {
    logger.warn({ err, url }, "Sahifa yuklanmadi");
    return "";
  }
}

export async function searchLexUz(query: string): Promise<string> {
  try {
    const searchUrl = `https://lex.uz/ru/search/?q=${encodeURIComponent(query)}`;
    const html = await fetchHtml(searchUrl);

    const docLinks = [...html.matchAll(/href="(\/docs\/[^"]+)"/g)]
      .map((m) => `https://lex.uz${m[1]}`)
      .slice(0, 2);

    const parts: string[] = [`[lex.uz qidiruv natijalari: "${query}"]`];

    for (const link of docLinks) {
      const content = await fetchPageContent(link, 2000);
      if (content.length > 100) {
        parts.push(`📄 ${link}:\n${content}`);
      }
    }

    return parts.join("\n\n");
  } catch (err) {
    logger.warn({ err }, "lex.uz qidiruv xato");
    return "";
  }
}

export async function performWebSearch(query: string, includePages = true): Promise<string> {
  const isLegalQuery =
    /qonun|kodeks|farmon|qaror|nizom|modda|huquq|sud|jarima|shartnoma|mehnat|soliq|lex\.uz/i.test(
      query
    );

  const parts: string[] = [];

  const [ddgResults, lexContent] = await Promise.all([
    searchDuckDuckGo(query),
    isLegalQuery ? searchLexUz(query) : Promise.resolve(""),
  ]);

  if (ddgResults.length > 0) {
    parts.push(
      `🔍 Web qidiruv natijalari:\n` +
        ddgResults
          .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`)
          .join("\n\n")
    );
  }

  if (includePages && ddgResults.length > 0) {
    const topUrls = ddgResults
      .filter(
        (r) =>
          r.url.startsWith("https://") &&
          !r.url.includes("youtube") &&
          !r.url.includes("facebook") &&
          !r.url.includes("instagram")
      )
      .slice(0, 2);

    const pageContents = await Promise.allSettled(
      topUrls.map((r) => fetchPageContent(r.url, 2500))
    );

    for (let i = 0; i < topUrls.length; i++) {
      const result = pageContents[i];
      if (result.status === "fulfilled" && result.value.length > 200) {
        parts.push(`📄 ${topUrls[i].url}:\n${result.value}`);
      }
    }
  }

  if (lexContent) {
    parts.push(lexContent);
  }

  return parts.join("\n\n---\n\n");
}
