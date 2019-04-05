import { parse, format, URL } from "url";
import { stringify } from "querystring";

import { createCacheUrl } from "amp-toolbox-cache-url";
import { default as fetch } from "node-fetch";
import { ImageSize } from "probe-image-size";

import execa from "execa";

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
  schemaMetadata,
  inlineMetadata,
  corsEndpoints,
  ampType,
  InlineMetadata
} from "./helper";
import { cli } from "./cli";

export enum LintType {
  Amp,
  AmpStory,
  Amp4Ads,
  Amp4Email,
  Sxg
}

const S_PASS = "PASS";
const S_FAIL = "FAIL";
const S_WARN = "WARN";
const S_INFO = "INFO";

export interface ActualExpected {
  readonly actual: string | undefined;
  readonly expected: string;
}

export interface Message {
  readonly status: string;
  readonly message?: string;
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

export const PASS = (s?: string): Promise<Message> =>
  Promise.resolve({ status: S_PASS, message: s });
export const FAIL = (s: string) => {
  return Promise.resolve({ status: S_FAIL, message: s });
};
export const WARN = (s: string) => {
  return Promise.resolve({ status: S_WARN, message: s });
};
export const INFO = (s: string) => {
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
  return res.status === "PASS" ? PASS() : FAIL(JSON.stringify(res.errors));
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
    return FAIL(`actual: ${s1}, expected: ${url}`);
  }
  // does url redirect?
  try {
    const s2 = await redirectUrl(context, url);
    if (s2 === url) {
      return PASS();
    } else {
      return FAIL(`actual: ${s2}, expected: ${url}`);
    }
  } catch (e) {
    return FAIL(`couldn't retrieve canonical ${url}`);
  }
}

export function SchemaMetadataIsNews({ $ }: Context) {
  const metadata = schemaMetadata($);
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
  const metadata = schemaMetadata($);
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

  const headers = Object.assign({ "amp-same-origin": "true" }, context.headers);

  const curl = fetchToCurl(addSourceOrigin(xhrUrl, sourceOrigin), { headers });

  return fetch(addSourceOrigin(xhrUrl, sourceOrigin), { headers })
    .then(isStatusOk)
    .then(isJson)
    .then(
      () => PASS(),
      (e: Error) => FAIL(`can't XHR [${xhrUrl}]: ${e.message} [debug: ${curl}]`)
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
    .then(
      () => PASS(),
      e => FAIL(`can't XHR [${xhrUrl}]: ${e.message} [debug: ${curl}]`)
    );
}
export function BookendExists(context: Context) {
  const { $ } = context;
  const s1 = $("amp-story amp-story-bookend").attr("src");
  const s2 = $("amp-story").attr("bookend-config-src");
  const bookendSrc = s1 || s2;
  return bookendSrc ? PASS() : WARN("<amp-story-bookend> not foundd");
}

export function BookendAppearsOnOrigin(context: Context) {
  const { $, url } = context;
  const s1 = $("amp-story amp-story-bookend").attr("src");
  const s2 = $("amp-story").attr("bookend-config-src");
  const bookendSrc = s1 || s2;
  if (!bookendSrc) {
    return WARN("<amp-story-bookend> not found");
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
    return WARN("<amp-story-bookend> not found");
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
  return isV1 ? PASS() : FAIL("amp-story-1.0.js not used (probably 0.1?)");
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

// Requirements are from
// https://github.com/ampproject/amphtml/blob/master/extensions/amp-story/amp-story.md#new-metadata-requirements.
export async function StoryMetadataThumbnailsAreOk(context: Context) {
  function isSquare({ width, height }: ImageSize) {
    return width === height;
  }
  function isPortrait({ width, height }: ImageSize) {
    return width > 0.74 * height && width < 0.76 * height;
  }
  function isLandscape({ width, height }: ImageSize) {
    return height > 0.74 * width && height < 0.76 * width;
  }
  function isRaster({ mime }: ImageSize) {
    return ["image/jpeg", "image/gif", "image/png"].includes(mime);
  }
  function isAtLeast96x96({ width, height }: ImageSize) {
    return width >= 96 && height >= 96;
  }
  function isAtLeast928x928({ width, height }: ImageSize) {
    return width >= 928 && height >= 928;
  }
  function isAtLeast696x928({ width, height }: ImageSize) {
    return width >= 696 && height >= 928;
  }
  function isAtLeast928x696({ width, height }: ImageSize) {
    return width >= 928 && height >= 696;
  }
  const metadata = inlineMetadata(context.$);

  async function assert(
    attr: keyof InlineMetadata,
    isMandatory: boolean,
    expected: Array<(info: ImageSize) => boolean>
  ): Promise<Message> {
    const url = metadata[attr];
    if (!url) {
      return isMandatory ? FAIL(`[${attr}] is missing`) : PASS();
    }
    try {
      const info = await dimensions(context, url);
      const failed = expected.filter(fn => !fn(info)).map(fn => fn.name);
      return failed.length === 0
        ? PASS()
        : FAIL(
            `[${attr} = ${JSON.stringify({
              url: url,
              width: info.width,
              height: info.height,
              mime: info.mime
            })}] failed [${failed.join(", ")}]`
          );
    } catch (e) {
      const s = absoluteUrl(url, context.url);
      switch (e.message) {
        case "unrecognized file format":
          return FAIL(`[${attr}] (${s}) unrecognized file format`);
        case "bad status code: 404":
          return FAIL(`[${attr}] (${s}) 404 file not found`);
        default:
          return FAIL(`[${attr}] (${s}) error: ${JSON.stringify(e)}`);
      }
    }
  }

  const res = [
    assert("publisher-logo-src", true, [isRaster, isSquare, isAtLeast96x96]),
    assert("poster-portrait-src", true, [
      isRaster,
      isPortrait,
      isAtLeast696x928
    ]),
    assert("poster-square-src", false, [isRaster, isSquare, isAtLeast928x928]),
    assert("poster-landscape-src", false, [
      isRaster,
      isLandscape,
      isAtLeast928x696
    ])
  ];

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
        return WARN(
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
    .filter(
      // filter out <amp-img> elements that are the first child of an
      // <amp-story-grid-layer template="fill"> (for these, height/width is
      // ignored).
      (_, e) =>
        !$(e)
          .parent()
          .is("amp-story-grid-layer[template=fill]")
    )
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
  return (await Promise.all(
    e.map(url => canXhrSameOrigin(context, absoluteUrl(url, context.url) || ""))
  )).filter(notPass);
}

export async function EndpointsAreAccessibleFromCache(context: Context) {
  // Cartesian product from https://stackoverflow.com/a/43053803/11543
  const cartesian = (a: any, b: any) =>
    [].concat(...a.map((d: any) => b.map((e: any) => [].concat(d, e))));
  const e = corsEndpoints(context.$);
  const product = cartesian(e, (await caches()).map(c => c.cacheDomain));
  return (await Promise.all(
    product.map(([xhrUrl, cacheSuffix]) =>
      canXhrCache(context, absoluteUrl(xhrUrl, context.url) || "", cacheSuffix)
    )
  )).filter(notPass);
}

export async function SxgVaryOnAcceptAct({ url, headers }: Context) {
  const res = await fetch(url, { headers });
  const debug = `debug: ${fetchToCurl(url, { headers })}`;
  const vary = ("" + res.headers.get("vary"))
    .split(",")
    .map(s => s.toLowerCase().trim());
  if (vary.length == 0) return FAIL(`[vary] header is missing [${debug}]`);
  if (!vary.includes("amp-cache-transform"))
    return FAIL(
      `[vary] header is missing value [amp-cache-transform] [${debug}]`
    );
  if (!vary.includes("accept"))
    return FAIL(`[vary] header is missing value [accept] [${debug}]`);
  return PASS();
}

export async function SxgContentNegotiationIsOk({ url, headers }: Context) {
  const opt1 = {
    headers: Object.assign({ accept: "text/html" }, headers)
  };
  const res1 = await fetch(url, opt1);
  const hdr1 = res1.headers.get("content-type") || "";
  if (hdr1.indexOf("application/signed-exchange") !== -1) {
    return FAIL(
      `[content-type: application/signed-exchange] incorrectly returned for [accept: text/html] [debug: ${fetchToCurl(
        url,
        opt1
      )}]`
    );
  }

  const opt2 = {
    headers: Object.assign(
      { accept: "application/signed-exchange;v=b3" },
      headers
    )
  };
  const res2 = await fetch(url, opt2);
  const hdr2 = res2.headers.get("content-type") || "";
  if (hdr2.indexOf("application/signed-exchange") !== -1) {
    return FAIL(
      `[content-type: application/signed-exchange] incorrectly returned for [accept: application/signed-exchange;v=b3] [debug: ${fetchToCurl(
        url,
        opt2
      )}]`
    );
  }

  const opt3 = {
    headers: Object.assign(
      {
        accept: "application/signed-exchange;v=b3",
        "amp-cache-transform": `google;v="1"`
      },
      headers
    )
  };
  const res3 = await fetch(url, opt3);
  const hdr3 = res3.headers.get("content-type") || "";
  if (hdr3.indexOf("application/signed-exchange") === -1) {
    return FAIL(
      `[content-type: application/signed-exchange] not returned for [accept: application/signed-exchange;v=b3], [amp-cache-transform: google;v="1"] [debug: ${fetchToCurl(
        url,
        opt3
      )}]`
    );
  }

  return PASS();
}

export async function SxgDumpSignedExchangeVerify({ url, headers }: Context) {
  const opt = {
    headers: Object.assign(
      {
        accept: "application/signed-exchange;v=b3",
        "amp-cache-transform": `google;v="1"`
      },
      headers
    )
  };
  const res = await fetch(url, opt);
  const hdr = res.headers.get("content-type") || "";
  if (hdr.indexOf("application/signed-exchange") === -1) {
    return FAIL(
      `[content-type: application/signed-exchange] not returned for [accept: application/signed-exchange;v=b3], [amp-cache-transform: google;v="1"] [debug: ${fetchToCurl(
        url,
        opt
      )}]`
    );
  }
  const body = await res.buffer();

  const CMD = `dump-signedexchange`;
  const ARGS = [`-verify`];

  let sxg;
  try {
    sxg = await execa(CMD, ARGS, { input: body }).then(spawn => {
      const { stdout } = spawn;
      let m: ReturnType<typeof String.prototype.match>;
      m = stdout.match(/^The exchange has valid signature.$/m);
      const isValid = !!m;
      m = stdout.match(/^format version: (\S+)$/m);
      const version = m && m[1];
      m = stdout.match(/^  uri: (\S+)$/m);
      const uri = m && m[1];
      m = stdout.match(/^  status: (\S+)$/m);
      const status = m && parseInt(m[1], 10);
      return { isValid, version, uri, status };
    });
  } catch (e) {
    if (e.code === "ENOENT") {
      return WARN(
        `not testing: couldn't execute [${e.cmd}] (not installed? not in PATH?)`
      );
    } else {
      const debug = `echo ${body.toString(
        "base64"
      )} | base64 -D | ${CMD} ${ARGS.join(" ")}`;
      return FAIL(`error: [${e.cmd}] returned [${e.stderr}] [debug: ${debug}]`);
    }
  }

  const debug = `${fetchToCurl(url, opt, false)} | ${CMD} ${ARGS.join(" ")}`;

  if (
    !sxg.isValid ||
    (sxg.uri !== url && sxg.version !== "1b3") ||
    sxg.status !== 200
  ) {
    return FAIL(
      `[${url}] is not valid SXG [${JSON.stringify(sxg)}] [debug: ${debug}]`
    );
  } else {
    return PASS();
  }
}

export async function SxgAmppkgIsForwarded({ url, headers }: Context) {
  const validity = (() => {
    const { protocol, host } = new URL(url);
    return `${protocol}//${host}/amppkg/validity`;
  })();
  const res = await fetch(validity, { headers });
  return res.ok && res.headers.get("content-type") === "application/cbor"
    ? PASS()
    : FAIL(
        `/amppkg/ not forwarded to amppackager [debug: ${fetchToCurl(validity, {
          headers
        })}]`
      );
}

export function testsForType(type: string, $: CheerioStatic) {
  const tests: Map<LintType, Array<Test | TestList>> = new Map();
  tests.set(LintType.Sxg, [
    SxgAmppkgIsForwarded,
    SxgContentNegotiationIsOk,
    SxgVaryOnAcceptAct,
    SxgDumpSignedExchangeVerify
  ]);
  tests.set(LintType.Amp, [
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
  ]);
  tests.set(
    LintType.AmpStory,
    (tests.get(LintType.Amp) || []).concat([
      BookendAppearsOnCache,
      BookendAppearsOnOrigin,
      BookendExists,
      SchemaMetadataIsNews,
      StoryRuntimeIsV1,
      StoryMetadataIsV1,
      StoryIsMostlyText,
      StoryMetadataThumbnailsAreOk
    ])
  );
  switch (type) {
    case "sxg":
      return tests.get(LintType.Sxg) || [];
    case "amp":
      return tests.get(LintType.Amp) || [];
    case "ampstory":
      return tests.get(LintType.AmpStory) || [];
    case "auto":
    default:
      return tests.get(ampType($)) || [];
  }
}

export async function lint(
  tests: Array<Test | TestList>,
  context: Context
): Promise<{ [key: string]: Message | Message[] }> {
  const res = await Promise.all(
    // We need to cast f() to the (incorrect) union type (Test & TestList)
    // because typescript cannot "synthesize an intersectional call signature
    // when getting the members of a union type", see
    // https://github.com/Microsoft/TypeScript/issues/7294#issuecomment-190335544
    tests.map((f: Test | TestList) =>
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
}

export { ampType as getAmpType };

export { cli };
