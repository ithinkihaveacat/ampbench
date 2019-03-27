import { LintType } from ".";

interface InlineMetadata {
  title: string;
  publisher: string;
  "publisher-logo-src": string;
  "poster-portrait-src": string;
  "poster-square-src"?: string;
  "poster-landscape-src"?: string;
}

export function schemaMetadata($: CheerioStatic) {
  const metadata = JSON.parse($(
    'script[type="application/ld+json"]'
  ).html() as string);
  return metadata ? metadata : {};
}

export function inlineMetadata($: CheerioStatic) {
  const e = $("amp-story");
  const metadata: InlineMetadata = {
    "poster-landscape-src": e.attr("poster-landscape-src"), // optional
    "poster-portrait-src": e.attr("poster-portrait-src"),
    "poster-square-src": e.attr("poster-square-src"), // optional
    publisher: e.attr("publisher"),
    "publisher-logo-src": e.attr("publisher-logo-src"),
    title: e.attr("title")
  };
  return metadata;
}

export function corsEndpoints($: CheerioStatic) {
  return ([] as string[])
    .concat(
      $("amp-list[src]")
        .map((_, e) => $(e).attr("src"))
        .get(),
      $("amp-story amp-story-bookend").attr("src"),
      $("amp-story").attr("bookend-config-src")
    )
    .filter(s => !!s);
}

export function ampType($: CheerioStatic): LintType {
  if ($("body amp-story[standalone]").length === 1) {
    return LintType.AmpStory;
  }
  // TODO Add tests for the other types
  return LintType.Amp;
}
