import { basename } from "path";
import { parse, format } from "url";
import { readFileSync } from "fs";
import { stringify } from "querystring";

import { createCacheUrl } from "amp-toolbox-cache-url";
import { default as fetch, Request, RequestInit, Response } from "node-fetch";
import cheerio from "cheerio";

import { validate } from "./validate";
import { caches } from "./caches";
import { isStatusOk, isJson, isAccessControlHeaders } from "./filter";
import {
  absoluteUrl,
  redirectUrl,
  contentLength,
  fetchToCurl,
  dimensions
} from "./url";
import {
  metadataSchema,
  metadataInline,
  corsEndpoints,
  ampType
} from "./helper";

export enum AmpType {
  Amp,
  AmpStory,
  Amp4Ads,
  Amp4Email
}

export interface ActualExpected {
  readonly actual: string | undefined;
  readonly expected: string;
}

export interface Message {
  readonly status: string;
  readonly message?: string | ActualExpected;
}

export interface Context {
  readonly url: string;
  readonly $: CheerioStatic;
  readonly headers: {
    [key: string]: string;
  };
}

export interface Test {
  (context: Context): Promise<Message>;
}

export interface TestList {
  (context: Context): Promise<Message[]>;
}

const S_PASS = "PASS";
const S_FAIL = "FAIL";
const S_WARN = "WARN";
const S_INFO = "INFO";

export const PASS = (): Promise<Message> => Promise.resolve({ status: S_PASS });
export const FAIL = (s: string | ActualExpected) => {
  return Promise.resolve({ status: S_FAIL, message: s });
};
export const WARN = (s: string | ActualExpected) => {
  return Promise.resolve({ status: S_WARN, message: s });
};
export const INFO = (s: string | ActualExpected) => {
  return Promise.resolve({ status: S_INFO, message: s });
};

const isPass = (m: Message): boolean => {
  return m.status === S_PASS;
};

const notPass = (m: Message): boolean => {
  return m.status !== S_PASS;
};

export async function IsValid({ $ }: Context) {
  const res = await validate($.html());
  return res.status === "PASS" ? PASS() : res;
}

export async function LinkRelCanonicalIsOk(context: Context) {
  const { $, url } = context;
  const canonical = $('link[rel="canonical"]').attr("href");
  if (!canonical) {
    return FAIL("<link rel=canonical> not specified");
  }
  const s1 = absoluteUrl(canonical, url);
  // does canonical match url?
  if (url !== s1) {
    return FAIL({
      actual: s1,
      expected: url
    });
  }
  // does url redirect?
  try {
    const s2 = await redirectUrl(context, url);
    if (s2 === url) {
      return PASS();
    } else {
      return FAIL({
        actual: s2,
        expected: url
      });
    }
  } catch (e) {
    return FAIL(`couldn't retrieve canonical ${url}`);
  }
}

export function SchemaMetadataIsNews({ $ }: Context) {
  const metadata = metadataSchema($);
  const type = metadata["@type"];
  if (
    type !== "Article" &&
    type !== "NewsArticle" &&
    type !== "ReportageNewsArticle"
  ) {
    return WARN(
      `@type is not 'Article' or 'NewsArticle' or 'ReportageNewsArticle'`
    );
  } else {
    return PASS();
  }
}

export function SchemaMetadataIsRecent({ $ }: Context) {
  const inLastMonth = (time: number) => {
    return time > Date.now() - 30 * 24 * 60 * 60 * 1000 && time < Date.now();
  };
  const metadata = metadataSchema($);
  const datePublished = metadata.datePublished;
  const dateModified = metadata.dateModified;
  if (!datePublished || !dateModified) {
    return FAIL(`datePublished or dateModified not found`);
  }
  const timePublished = Date.parse(datePublished);
  const timeModified = Date.parse(dateModified);
  if (isNaN(timePublished) || isNaN(timeModified)) {
    return FAIL(
      `couldn't parse datePublished [${datePublished}] or dateModified [${dateModified}]`
    );
  }
  if (timeModified < timePublished) {
    return FAIL(
      `dateModified [${dateModified}] is earlier than datePublished [${datePublished}]`
    );
  }
  if (inLastMonth(timePublished) && inLastMonth(timeModified)) {
    return PASS();
  } else {
    return WARN(
      `datePublished [${datePublished}] or dateModified [${dateModified}] is old or in the future`
    );
  }
}

export async function AmpVideoIsSmall(context: Context) {
  const { $ } = context;
  const args = await Promise.all(($(
    `amp-video source[type="video/mp4"][src], amp-video[src]`
  )
    .map(async (i, e) => {
      const url = absoluteUrl($(e).attr("src"), context.url);
      const length = await contentLength(context, url!);
      return { url, length };
    })
    .get() as any) as Array<
    Promise<{
      url: string;
      length: number;
    }>
  >);
  const videos = args.reduce(
    (a, v) => {
      a[v.url] = v.length;
      return a;
    },
    {} as {
      [url_1: string]: number;
    }
  );
  const large = Object.keys(videos).filter(v => videos[v] > 4000000);
  if (large.length > 0) {
    return FAIL(`videos over 4MB: [${large.join(",")}]`);
  } else {
    return PASS();
  }
}

/**
 * Adds `__amp_source_origin` query parameter to URL.
 *
 * @param url
 * @param sourceOrigin
 */
function addSourceOrigin(url: string, sourceOrigin: string) {
  const obj = parse(url, true);
  obj.query.__amp_source_origin = sourceOrigin;
  obj.search = stringify(obj.query);
  return format(obj);
}

function buildSourceOrigin(url: string) {
  const obj = parse(url, true);
  return `${obj.protocol}//${obj.host}`;
}

function canXhrSameOrigin(context: Context, xhrUrl: string) {
  xhrUrl = absoluteUrl(xhrUrl, context.url)!;
  const sourceOrigin = buildSourceOrigin(context.url);

  const headers = Object.assign(
    {},
    { "amp-same-origin": "true" },
    context.headers
  );

  const curl = fetchToCurl(addSourceOrigin(xhrUrl, sourceOrigin), { headers });

  return fetch(addSourceOrigin(xhrUrl, sourceOrigin), { headers })
    .then(isStatusOk)
    .then(isJson)
    .then(PASS, (e: Error) =>
      FAIL(`can't XHR [${xhrUrl}]: ${e.message} [debug: ${curl}]`)
    );
}

async function canXhrCache(
  context: Context,
  xhrUrl: string,
  cacheSuffix: string
) {
  const sourceOrigin = buildSourceOrigin(context.url);
  const url = await createCacheUrl(cacheSuffix, context.url);
  const obj = parse(url);
  const origin = `${obj.protocol}//${obj.host}`;

  const headers = Object.assign({}, { origin }, context.headers);

  const curl = fetchToCurl(addSourceOrigin(xhrUrl, sourceOrigin), { headers });

  return fetch(addSourceOrigin(xhrUrl, sourceOrigin), { headers })
    .then(isStatusOk)
    .then(isAccessControlHeaders(origin, sourceOrigin))
    .then(isJson)
    .then(PASS, e =>
      FAIL(`can't XHR [${xhrUrl}]: ${e.message} [debug: ${curl}]`)
    );
}

export function BookendExists(context: Context) {
  const { $ } = context;
  const s1 = $("amp-story amp-story-bookend").attr("src");
  const s2 = $("amp-story").attr("bookend-config-src");
  const bookendSrc = s1 || s2;
  return bookendSrc ? PASS() : WARN("no bookend found");
}

export function BookendAppearsOnOrigin(context: Context) {
  const { $, url } = context;
  const s1 = $("amp-story amp-story-bookend").attr("src");
  const s2 = $("amp-story").attr("bookend-config-src");
  const bookendSrc = s1 || s2;
  if (!bookendSrc) {
    return WARN("no bookend specified");
  }
  const bookendUrl = absoluteUrl(bookendSrc, url);

  return canXhrSameOrigin(context, bookendUrl!);
}

export function BookendAppearsOnCache(context: Context) {
  const { $, url } = context;
  const s1 = $("amp-story amp-story-bookend").attr("src");
  const s2 = $("amp-story").attr("bookend-config-src");
  const bookendSrc = s1 || s2;
  if (!bookendSrc) {
    return WARN("amp-story-bookend missing");
  }
  const bookendUrl = absoluteUrl(bookendSrc, url);

  return canXhrCache(context, bookendUrl!, "cdn.ampproject.org");
}

export function AmpVideoIsSpecifiedByAttribute({ $ }: Context) {
  if ($("amp-video[src]").length > 0) {
    return WARN(
      "<amp-video src> used instead of <amp-video><source/></amp-video>"
    );
  } else {
    return PASS();
  }
}

export function StoryRuntimeIsV1({ $ }: Context) {
  const isV1 =
    $("script[src='https://cdn.ampproject.org/v0/amp-story-1.0.js']").length >
    0;
  return isV1 ? PASS() : WARN("amp-story-1.0.js not used (probably 0.1?)");
}

export function StoryMetadataIsV1({ $ }: Context) {
  const isV1 =
    $("script[src='https://cdn.ampproject.org/v0/amp-story-1.0.js']").length >
    0;
  if (!isV1) {
    return PASS();
  }
  const attr: string[] = [
    "title",
    "publisher",
    "publisher-logo-src",
    "poster-portrait-src"
  ]
    .map(a => ($(`amp-story[${a}]`).length > 0 ? false : a))
    .filter(Boolean) as string[];
  if (attr.length > 0) {
    return WARN(
      `<amp-story> is missing attribute(s) that will soon be mandatory: [${attr.join(
        ", "
      )}]`
    );
  } else {
    return PASS();
  }
}

export function MetaCharsetIsFirst({ $ }: Context) {
  const firstChild = $("head *:first-child");
  const charset = firstChild.attr("charset");
  return !charset ? FAIL(`<meta charset> not the first <meta> tag`) : PASS();
}

export function RuntimeIsPreloaded({ $ }: Context) {
  const attr = [
    "href='https://cdn.ampproject.org/v0.js'",
    "rel='preload'",
    "as='script'"
  ]
    .map(s => `[${s}]`)
    .join("");
  const isPreloaded = $(`link${attr}`).length > 0;
  return isPreloaded
    ? PASS()
    : WARN(
        "<link href=https://cdn.ampproject.org/v0.js rel=preload> is missing"
      );
}

export function StoryIsMostlyText({ $ }: Context) {
  const text = $("amp-story").text();
  if (text.length > 100) {
    return PASS();
  } else {
    return WARN(`minimal text in the story [${text}]`);
  }
}

export async function StoryMetadataThumbnailsAreOk(context: Context) {
  const $ = context.$;
  async function isSquare(url: string | undefined) {
    if (!url) {
      return false;
    }
    const { width, height } = await dimensions(
      context,
      absoluteUrl(url, context.url)!
    );
    return width === height;
  }
  async function isPortrait(url: string | undefined) {
    if (!url) {
      return false;
    }
    const { width, height } = await dimensions(
      context,
      absoluteUrl(url, context.url)!
    );
    return width > 0.74 * height && width < 0.76 * height;
  }
  async function isLandscape(url: string | undefined) {
    if (!url) {
      return false;
    }
    const { width, height } = await dimensions(
      context,
      absoluteUrl(url, context.url)!
    );
    return height > 0.74 * width && height < 0.76 * width;
  }
  const inlineMetadata = metadataInline($);

  const res: Array<Promise<Message>> = [];

  res.push(
    (async () => {
      const k = "publisher-logo-src";
      const v = inlineMetadata[k];
      try {
        const r = await isSquare(v);
        return r
          ? PASS()
          : FAIL(`[${k}] (${v}) is missing or not square (1:1)`);
      } catch (e) {
        return e.message == "unrecognized file format"
          ? PASS()
          : FAIL(`[${k}] (${v}) status not 200 error: ${JSON.stringify(e)}`);
      }
    })()
  );

  res.push(
    (async () => {
      const k = "poster-portrait-src";
      const v = inlineMetadata[k];
      try {
        const r = await isPortrait(v);
        return r
          ? PASS()
          : FAIL(`[${k}] (${v}) is missing or not portrait (3:4)`);
      } catch (e) {
        return e.message == "unrecognized file format"
          ? PASS()
          : FAIL(`[${k}] (${v}) status not 200`);
      }
    })()
  );

  (() => {
    const k = "poster-square-src";
    const v = inlineMetadata[k];
    if (v) {
      res.push(
        isSquare(v).then(
          r => (r ? PASS() : FAIL(`[${k}] (${v}) is not square (1x1)`)),
          e =>
            e.message == "unrecognized file format"
              ? PASS()
              : FAIL(`[${k}] (${v}) status not 200`)
        )
      );
    }
  })();

  (() => {
    const k = "poster-landscape-src";
    const v = inlineMetadata[k];
    if (v) {
      res.push(
        isLandscape(v).then(
          r => (r ? PASS() : FAIL(`[${k}] (${v}) is not landscape (4:3)`)),
          e =>
            e.message == "unrecognized file format"
              ? PASS()
              : FAIL(`[${k}] (${v}) status not 200`)
        )
      );
    }
  })();

  return (await Promise.all(res)).filter(notPass);
}

export async function AmpImgHeightWidthIsOk(context: Context) {
  const $ = context.$;

  function test(
    src: string,
    expectedWidth: number,
    expectedHeight: number
  ): Promise<Message> {
    const success = ({
      height,
      width
    }: {
      height: number;
      width: number;
    }): Promise<Message> => {
      const actualHeight = height;
      const actualWidth = width;
      const actualRatio = Math.floor((actualWidth * 100) / actualHeight) / 100;
      const expectedRatio =
        Math.floor((expectedWidth * 100) / expectedHeight) / 100;
      if (Math.abs(actualRatio - expectedRatio) > 0.015) {
        const actualString = `${actualWidth}/${actualHeight} = ${actualRatio}`;
        const expectedString = `${expectedWidth}/${expectedHeight} = ${expectedRatio}`;
        return FAIL(
          `[${src}]: actual ratio [${actualString}] does not match specified [${expectedString}]`
        );
      }
      const actualVolume = actualWidth * actualHeight;
      const expectedVolume = expectedWidth * expectedHeight;
      if (expectedVolume < 0.25 * actualVolume) {
        const actualString = `${actualWidth}x${actualHeight}`;
        const expectedString = `${expectedWidth}x${expectedHeight}`;
        return WARN(
          `[${src}]: actual dimensions [${actualString}] are much larger than specified [${expectedString}]`
        );
      }
      if (expectedVolume > 1.5 * actualVolume) {
        const actualString = `${actualWidth}x${actualHeight}`;
        const expectedString = `${expectedWidth}x${expectedHeight}`;
        return WARN(
          `[${src}]: actual dimensions [${actualString}] are much smaller than specified [${expectedString}]`
        );
      }
      return PASS();
    };
    const fail = (e: { statusCode: number }) => {
      if (e.statusCode === undefined) {
        return FAIL(`[${src}] ${JSON.stringify(e)}`);
      } else {
        return FAIL(`[${src}] returned status ${e.statusCode}`);
      }
    };
    return dimensions(context, absoluteUrl(src, context.url)!).then(
      success,
      fail
    );
  }

  return (await Promise.all(($("amp-img")
    .map((_, e) => {
      const src = $(e).attr("src");
      const expectedHeight = parseInt($(e).attr("height"), 10);
      const expectedWidth = parseInt($(e).attr("width"), 10);
      return test(src, expectedWidth, expectedHeight);
    })
    .get() as any) as Array<Promise<Message>>)).filter(notPass);
}

export async function AmpImgAmpPixelPreferred(context: Context) {
  const $ = context.$;
  return await Promise.all($("amp-img[width=1][height=1]")
    .map((_, e) => {
      const s = $(e).toString();
      return WARN(
        `[${s}] has width=1, height=1; <amp-pixel> may be a better choice`
      );
    })
    .get() as Array<Promise<Message>>);
}

export async function EndpointsAreAccessibleFromOrigin(context: Context) {
  const e = corsEndpoints(context.$);
  return (await Promise.all(e.map(s => canXhrSameOrigin(context, s)))).filter(
    notPass
  );
}

export async function EndpointsAreAccessibleFromCache(context: Context) {
  // Cartesian product from https://stackoverflow.com/a/43053803/11543
  const cartesian = (a: any, b: any) =>
    [].concat(...a.map((d: any) => b.map((e: any) => [].concat(d, e))));
  const e = corsEndpoints(context.$);
  const product = cartesian(e, (await caches()).map(c => c.cacheDomain));
  return (await Promise.all(
    product.map(([xhrUrl, cacheSuffix]) =>
      canXhrCache(context, xhrUrl, cacheSuffix)
    )
  )).filter(notPass);
}

export function cli(argv: string[]) {
  if (argv.length <= 2) {
    console.error(
      `usage: ${basename(argv[0])} ${basename(argv[1])} URL|copy_as_cURL`
    );
    process.exit(1);
  }

  const url = argv[2] === "-" ? "-" : argv.filter(s => s.match(/^http/))[0];

  function seq(first: number, last: number): number[] {
    if (first < last) {
      return [first].concat(seq(first + 1, last));
    } else if (first > last) {
      return [last].concat(seq(first, last - 1));
    } else {
      return [first];
    }
  }

  const headers = seq(2, argv.length - 1)
    .filter(n => argv[n] === "-H")
    .map(n => argv[n + 1])
    .map(s => {
      const [h, ...v] = s.split(": ");
      return [h, v.join("")];
    })
    .reduce((a: { [key: string]: any }, kv) => {
      a[kv[0]] = kv[1];
      return a;
    }, {});

  const body = (() => {
    if (url === "-") {
      return Promise.resolve(readFileSync("/dev/stdin").toString());
    } else {
      return fetch(url, { headers }).then(r =>
        r.ok
          ? r.text()
          : Promise.reject(`couldn't load [${url}]: ${r.statusText}`)
      );
    }
  })();

  return (
    body
      .then(b => cheerio.load(b))
      // .then(c => { console.log(c.html()); return c; })
      .then($ => lint({ $, headers, url }))
      .then(r => console.log(JSON.stringify(r, null, 2)))
      // .then(() => process.exit(0))
      .catch(e => console.error(`error: ${e}`))
  );
}

export const lint = async (
  context: Context
): Promise<{ [key: string]: Message }> => {
  const type = ampType(context.$);
  let tests: Array<(Test | TestList)[]> = [];
  tests[AmpType.Amp] = [
    IsValid,
    LinkRelCanonicalIsOk,
    AmpVideoIsSmall,
    AmpVideoIsSpecifiedByAttribute,
    MetaCharsetIsFirst,
    RuntimeIsPreloaded,
    AmpImgHeightWidthIsOk,
    AmpImgAmpPixelPreferred,
    EndpointsAreAccessibleFromOrigin,
    EndpointsAreAccessibleFromCache
  ];
  tests[AmpType.AmpStory] = ([] as (Test | TestList)[]).concat(
    tests[AmpType.Amp],
    [
      BookendAppearsOnCache,
      BookendAppearsOnOrigin,
      BookendExists,
      SchemaMetadataIsNews,
      StoryRuntimeIsV1,
      StoryMetadataIsV1,
      StoryIsMostlyText,
      StoryMetadataThumbnailsAreOk
    ]
  );
  const res = await Promise.all(
    // We need to cast f() to the (incorrect) union type (Test & TestList)
    // because typescript cannot "synthesize an intersectional call signature
    // when getting the members of a union type", see
    // https://github.com/Microsoft/TypeScript/issues/7294#issuecomment-190335544
    tests[type].map((f: Test | TestList) =>
      (f as Test & TestList)(context).then((r: Message | Message[]) => [
        f.name,
        r
      ])
    )
  );
  return res.reduce(
    (
      a: { [key: string]: Message | Message[] },
      kv: [string, Message | Message[]]
    ) => {
      a[kv[0].toLowerCase()] = kv[1];
      return a;
    },
    {}
  );
};

export const testAll = async (
  context: Context
): Promise<{ [key: string]: Message }> => {
  const res = await Promise.all(
    Object.keys(exports as { [k: string]: Test })
      .filter(k => k.startsWith("test") && k !== "testAll")
      .map(k => exports[k](context).then((v: any) => [k, v]))
  );
  return res.reduce((a: { [key: string]: Message }, kv: [string, Message]) => {
    a[kv[0].substring("test".length).toLowerCase()] = kv[1];
    return a;
  }, {});
};
