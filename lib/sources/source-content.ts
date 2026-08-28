import { load } from "cheerio";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});
turndown.remove(["script", "style", "noscript", "canvas", "iframe"]);

export function htmlText(value: string) {
  const $ = load(value);
  return $.root().text().replace(/\s+/g, " ").trim();
}

export function htmlToMarkdown(value: string) {
  const $ = load(value);
  $("script,style,noscript,svg,canvas,iframe").remove();
  return turndown.turndown($.html()).trim();
}

export function webpageToDocument(html: string, fallbackTitle: string) {
  const $ = load(html);
  $(
    "script,style,noscript,svg,canvas,iframe,nav,footer,form,[aria-hidden='true']",
  ).remove();
  const title =
    $("main h1, article h1, h1").first().text().trim() ||
    $("title").first().text().trim() ||
    fallbackTitle;
  const content = $("main").first().length
    ? $("main").first().html()
    : $("article").first().length
      ? $("article").first().html()
      : $("body").html();
  return {
    title: title.replace(/\s+/g, " ").slice(0, 200),
    body: htmlToMarkdown(content ?? ""),
  };
}

export function withSourceProvenance(
  body: string,
  input: {
    sourceName: string;
    canonicalUrl: string | null;
    externalId: string;
    remoteUpdatedAt: string | null;
  },
) {
  const metadata = [
    `Source: ${
      input.canonicalUrl
        ? `[${input.sourceName}](${input.canonicalUrl})`
        : input.sourceName
    }`,
    `External ID: \`${input.externalId.replace(/`/g, "")}\``,
    input.remoteUpdatedAt ? `Remote updated: ${input.remoteUpdatedAt}` : null,
    "Managed by Slab Sources. Remote changes replace this mirrored content.",
  ].filter(Boolean);
  return `${body.trim()}\n\n---\n\n${metadata.join("  \n")}`.trim();
}
