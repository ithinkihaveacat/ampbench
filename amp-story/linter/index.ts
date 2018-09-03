/// <reference path="probe-image-size.d.ts" />

import {readFileSync} from "fs";
import {resolve, URL} from "url";
// tslint:disable-next-line:no-var-requires
const validator = require("amphtml-validator").newInstance(
  // Let's not fetch over the network on every run.
  // Use `yarn run update-validator` to update.
  // tslint:disable-next-line:no-var-requires
  readFileSync(`${__dirname}/validator.js`).toString(),
);
import * as cheerio from "cheerio";
import throat = require("throat");

import {default as fetch, Request, RequestInit, Response} from "node-fetch";
import {basename} from "path";
import * as probe from "probe-image-size";
import * as punycode from "punycode";
import * as readline from "readline";

const CONCURRENCY = 8;
const UA_GOOGLEBOT_MOBILE = [
  "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36",
  "(KHTML, like Gecko) Chrome/41.0.2272.96 Mobile Safari/537.36",
  "(compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
].join(" ");

export interface ActualExpected {
  readonly actual: string;
  readonly expected: string;
}

export interface Message {
  readonly status: string;
  readonly message?: string|ActualExpected;
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

interface InlineMetadata {
  "title": string;
  "publisher": string;
  "publisher-logo-src": string;
  "poster-portrait-src": string;
  "poster-square-src"?: string;
  "poster-landscape-src"?: string;
}

export const PASS = (): Promise<Message> => Promise.resolve({status: "PASS"});
export const FAIL = (s: string|ActualExpected) => {
  return Promise.resolve({status: "FAIL", message: s});
};
export const WARN = (s: string|ActualExpected) => {
  return Promise.resolve({status: "WARN", message: s});
};
export const INFO = (s: string|ActualExpected) => {
  return Promise.resolve({status: "INFO", message: s});
};

const getBody = throat(CONCURRENCY,
  (context: Context, s: string|Request, init = {}) => {
    if (!("headers" in init)) {
      init.headers = {};
    }
    // Might be able to use type guards to avoid the cast somehow...
    (init.headers as {[key: string]: string})["user-agent"] = UA_GOOGLEBOT_MOBILE;
    return fetch(s, init);
    // return res.ok ? res.text() : new Error(res);
  },
);

const getUrl = throat(CONCURRENCY,
  async (context: Context, s: string|Request) => {
    const res = await fetch(s, {headers: context.headers });
    return res.url;
  },
);

const getContentLength = throat(CONCURRENCY,
  async (context: Context, s: string|Request) => {
    const options = Object.assign(
      {},
      { method: "HEAD" },
      { headers: context.headers }
    );
    const res = await fetch(s, options);
    if (!res.ok) { return Promise.reject(res); }
    const contentLength = res.headers.get("content-length");
    return contentLength ? contentLength : 0;
  },
);

const absoluteUrl = (s: string, base: string) => {
  if (typeof s !== "string" || typeof base !== "string") {
    return "";
  } else {
    return resolve(base, s);
  }
};

const getSchemaMetadata = ($: CheerioStatic) => {
  const metadata = JSON.parse($('script[type="application/ld+json"]').html() as string);
  return metadata ? metadata : {};
};

function getInlineMetadata($: CheerioStatic) {
  const e = $("amp-story");
  const inlineMetadata: InlineMetadata = {
    "poster-landscape-src": e.attr("poster-landscape-src"), // optional
    "poster-portrait-src": e.attr("poster-portrait-src"),
    "poster-square-src": e.attr("poster-square-src"), // optional
    "publisher": e.attr("publisher"),
    "publisher-logo-src": e.attr("publisher-logo-src"),
    "title": e.attr("title"),
  };
  return inlineMetadata;
}

function getImageSize(url: string): Promise<{width: number, height: number, [k: string]: any}> {
  return probe(url);
}

const testValidity: Test = ({$}) => {
  const res = validator.validateString($.html());
  return Promise.resolve(res.status === "PASS" ? PASS() : res);
};

const testCanonical: Test = (context) => {
  const {$, url} = context;
  const href = $('link[rel="canonical"]').attr("href");
  if (!href) {
    return FAIL("<link rel=canonical> not specified");
  }
  const canonical = absoluteUrl(href, url);
  if (url !== canonical) {
    return FAIL({
      actual: canonical,
      expected: url,
    });
  }
  return getUrl(context, canonical).then((s) => {
    if (s === canonical) {
      return PASS();
     } else {
       return FAIL({
         actual: s,
         expected: canonical,
       });
      }
    },
  ).catch(() => {
    return FAIL(`couldn't retrieve canonical ${canonical}`);
  });
};

const testSchemaMetadataType: Test = ({$}) => {
  const metadata = getSchemaMetadata($);
  const type = metadata["@type"];
  if (type !== "Article" && type !== "NewsArticle" && type !== "ReportageNewsArticle") {
    return WARN(`@type is not 'Article' or 'NewsArticle' or 'ReportageNewsArticle'`);
  } else {
    return PASS();
  }
};

const testSchemaMetadataRecent: Test = ({$}) => {
  const inLastMonth = (time: number) => {
    return  (time > Date.now() - (30 * 24 * 60 * 60 * 1000)) && (time < Date.now());
  };
  const metadata = getSchemaMetadata($);
  const datePublished = metadata.datePublished;
  const dateModified = metadata.dateModified;
  if (!datePublished || !dateModified) {
    return FAIL(`datePublished or dateModified not found`);
  }
  const timePublished = Date.parse(datePublished);
  const timeModified = Date.parse(dateModified);
  if (isNaN(timePublished) || isNaN(timeModified)) {
    return FAIL(`couldn't parse datePublished [${datePublished}] or dateModified [${dateModified}]`);
  }
  if (timeModified < timePublished) {
    return FAIL(`dateModified [${dateModified}] is earlier than datePublished [${datePublished}]`);
  }
  if (inLastMonth(timePublished) && inLastMonth(timeModified)) {
    return PASS();
  } else {
    return WARN(`datePublished [${datePublished}] or dateModified [${dateModified}] is old or in the future`);
  }
};

const testAmpStory: Test = ({$}) => {
  if ($("body amp-story[standalone]").length === 1) {
    return PASS();
  } else {
    return FAIL(`couldn't find <amp-story standalone> component`);
  }
};

const testVideoSize: Test = (context) => {
  const {$} = context;
  return Promise.all($(`amp-video source[type="video/mp4"][src], amp-video[src]`).map(async (i, e) => {
    const url = absoluteUrl($(e).attr("src"), context.url);
    const length = await getContentLength(context, url);
    return { url, length };
  }).get() as any as Array<Promise<{ url: string, length: number }>>).then((args) => { // TODO(stillers): switch to Map
    return args.reduce((a, v) => {
      a[v.url] = v.length;
      return a;
    }, {} as {[url: string]: number});
  }).then((videos) => {
    const large = Object.keys(videos).filter((v) => videos[v] > 4000000);
    if (large.length > 0) {
      return FAIL(`videos over 4MB: [${large.join(",")}]`);
    } else {
      return PASS();
    }
  });
};

function addSourceOrigin(url: string, sourceOrigin: string) {
  const {parse, format} = require("url"); // use old API to work with node 6+
  const obj = parse(url, true);
  obj.query.__amp_source_origin = sourceOrigin;
  obj.search = require("querystring").stringify(obj.query);
  return format(obj);
}

function buildCacheOrigin(cacheSuffix: string, url: string): string {
  // console.log({cacheSuffix, url});
  function convertHost(hostname: string) {
    return punycode
      .toASCII(hostname)
      .replace(/\-/g, "--")
      .replace(/\./g, "-");
  }
  const {parse, format} = require("url"); // use old API to work with node 6+
  const obj = parse(url);
  const cacheHost = `${convertHost(obj.host)}.${cacheSuffix}`;
  return `https://${cacheHost}`;
}

function isJson(res: Response): Promise<Response> {
  const contentType = (() => {
    if (!res.headers) {
      return "";
    }
    const s = res.headers.get("content-type") || "";
    return s.toLowerCase().split(";")[0];
  })();
  if (contentType !== "application/json") {
    throw new Error(`expected content-type: [application/json]; actual: [${contentType}]`);
  }
  return res.text().then((text) => {
    try {
      JSON.parse(text);
    } catch (e) {
      throw new Error(`couldn't parse body as JSON: ${text.substring(0, 100)}`);
    }
    return res;
  });
}

function isStatusNotOk(res: Response) {
  if (!res.ok) {
    return res;
   } else {
     throw new Error(`expected status code: [1xx, 3xx, 4xx, 5xx], actual [${res.status}]`);
   }
}

function isStatusOk(res: Response) {
  if (res.ok) {
    return res;
   } else {
     throw new Error(`expected status code: [2xx], actual [${res.status}]`);
   }
}

function isAccessControlHeaders(origin: string, sourceOrigin: string): (res: Response) => Response {
  return (res) => {
    const h1 = res.headers.get("access-control-allow-origin") || "";
    if ((h1 !== origin) && (h1 !== "*")) { throw new Error(
      `access-control-allow-origin header is [${h1}], expected [${origin}]`,
    );
    }
    // The AMP docs specify that the AMP-Access-Control-Allow-Source-Origin and
    // Access-Control-Expose-Headers headers must be returned, but this is not
    // in true: the runtime does check this header, but only if the
    // requireAmpResponseSourceOrigin flag is true, and amp-story sets this to
    // false.
    //
    // https://www.ampproject.org/docs/fundamentals/amp-cors-requests#ensuring-secure-responses
    /*
    const h2 = res.headers.get('amp-access-control-allow-source-origin') || '';
    if (h2 !== sourceOrigin) throw new Error(
      `amp-access-control-allow-source-origin header is [${h2}], expected [${sourceOrigin}]`
    );
    const h3 = res.headers.get('access-control-expose-headers') || '';
    if (h3 !== 'AMP-Access-Control-Allow-Source-Origin') throw new Error(
      `access-control-expose-headers is [${h3}], expected [AMP-Access-Control-Allow-Source-Origin]`
    );
    */
    return res;
  };
}

function buildSourceOrigin(url: string) {
  const {parse} = require("url"); // use old API to work with node 6+
  const obj = parse(url, true);
  return `${obj.protocol}//${obj.host}`;
}

function canXhrSameOrigin(context: Context, xhrUrl: string) {
  const sourceOrigin = buildSourceOrigin(context.url);

  const headers = Object.assign(
    {},
    {"amp-same-origin": "true"},
    {headers: context.headers}
  );

  const curl = `curl -i -H 'amp-same-origin: true' '${addSourceOrigin(xhrUrl, sourceOrigin)}'`;

  return fetch(addSourceOrigin(xhrUrl, sourceOrigin), {headers})
    .then(isStatusOk)
    .then(isJson)
    .then(PASS, (e: Error) => FAIL(`can't retrieve bookend: ${e.message} [debug: ${curl}]`));
}

function canXhrCache(context: Context, xhrUrl: string, cacheSuffix: string) {
  const sourceOrigin = buildSourceOrigin(context.url);
  const origin = buildCacheOrigin(cacheSuffix, context.url);

  const headers = Object.assign(
    {},
    {origin},
    {headers: context.headers}
  );

  const curl = `curl -i -H 'origin: ${origin}' '${addSourceOrigin(xhrUrl, sourceOrigin)}'`;

  return fetch(addSourceOrigin(xhrUrl, sourceOrigin), {headers})
    .then(isStatusOk)
    .then(isAccessControlHeaders(origin, sourceOrigin))
    .then(isJson)
    .then(PASS, (e) => FAIL(`can't retrieve bookend: ${e.message} [debug: ${curl}]`));
}

const testBookendSameOrigin: Test = (context) => {
  const {$, url} = context;
  const bookendConfigSrc = $("amp-story amp-story-bookend").attr("src");
  if (!bookendConfigSrc) { return WARN("amp-story-bookend missing"); }
  const bookendUrl = absoluteUrl(bookendConfigSrc, url);
  // if (bookendUrl !== bookendConfigSrc) return WARNING('bookend-config-src not absolute');

  return canXhrSameOrigin(context, bookendUrl);
};

const testBookendCache: Test = (context) => {
  const {$, url} = context;
  const bookendConfigSrc = $("amp-story amp-story-bookend").attr("src");
  if (!bookendConfigSrc) { return WARN("bookend-story-bookend missing"); }
  const bookendUrl = absoluteUrl(bookendConfigSrc, url);
  // if (bookendUrl !== bookendConfigSrc) return WARNING('bookend-config-src not absolute');

  return canXhrCache(context, bookendUrl, "cdn.ampproject.org");
};

const testVideoSource: Test = ({$}) => {
  if ($("amp-video[src]").length > 0) {
    return FAIL("<amp-video src> used instead of <amp-video><source/></amp-video>");
  } else {
    return PASS();
  }
};

const testAmpStoryV1: Test = ({$}) => {
  const isV1 = $("script[src='https://cdn.ampproject.org/v0/amp-story-1.0.js']").length > 0;
  return isV1 ? PASS() : WARN("amp-story-1.0.js not used (probably 0.1?)");
};

const testAmpStoryV1Metadata: Test = ({$}) => {
  const isV1 = $("script[src='https://cdn.ampproject.org/v0/amp-story-1.0.js']").length > 0;
  if (!isV1) { return PASS(); }
  const attr: string[] = [ "title", "publisher", "publisher-logo-src", "poster-portrait-src" ]
    .map(a => $(`amp-story[${a}]`).length > 0 ? false : a)
    .filter(Boolean) as string[];
  if (attr.length > 0) {
    return WARN(`<amp-story> is missing attribute(s) that will soon be mandatory: [${attr.join(", ")}]`);
  } else {
    return PASS();
  }
};

const testMetaCharsetFirst: Test = ({$}) => {
  const firstChild = $("head *:first-child");
  const charset = firstChild.attr("charset");
  return !charset ? FAIL(`<meta charset> not the first <meta> tag`) : PASS();
};

const testMostlyText: Test = ({$}) => {
  const text = $("amp-story").text();
  if (text.length > 100) {
    return PASS();
  } else {
    return WARN(`minimal text in the story [${text}]`);
  }
};

const testThumbnails: Test = async ({$}) => {
  async function isSquare(url: string) {
    const {width, height} = await getImageSize(url);
    return width === height;
  }
  async function isPortrait(url: string) {
    const {width, height} = await getImageSize(url);
    return (width > (0.74 * height)) && (width < (0.76 * height));
  }
  async function isLandscape(url: string) {
    const {width, height} = await getImageSize(url);
    return (height > (0.74 * width)) && (height < (0.76 * width));
  }
  const inlineMetadata = getInlineMetadata($);

  let k: keyof InlineMetadata;
  let v: string|undefined;
  const errors = [];

  k = "publisher-logo-src";
  v = inlineMetadata[k];
  if (!v || !(await isSquare(v))) {
    errors.push(`[${k}] (${v}) is missing or not square (1:1)`);
  }

  k = "poster-portrait-src";
  v = inlineMetadata[k];
  if (!v || !(await isPortrait(v))) {
    errors.push(`[${k}] (${v}) is missing or not portrait (3:4)`);
  }

  k = "poster-square-src";
  v = inlineMetadata[k];
  if (v && !(await isSquare(v))) {
    errors.push(`[${k}] (${v}) is not square (1x1)`);
  }

  k = "poster-landscape-src";
  v = inlineMetadata[k];
  if (v && !(await isLandscape(v))) {
    errors.push(`[${k}] ($v) is not landscape (4:3)`);
  }

  return (errors.length > 0) ? FAIL(errors.join(",")) : PASS();
};

const testAll = async (context: Context): Promise<{[key: string]: Message}> => {
  const tests = [
    testValidity,
    testCanonical,
    testAmpStory,
    testAmpStoryV1,
    testAmpStoryV1Metadata,
    testSchemaMetadataRecent,
    testSchemaMetadataType,
    testBookendSameOrigin,
    testBookendCache,
    testVideoSource,
    testVideoSize,
    testMostlyText,
    testThumbnails,
    testMetaCharsetFirst,
  ];
  const res = await Promise.all(tests.map(async (testFn) => {
    const v = await testFn(context);
    return [
      testFn.name.substring("test".length).toLowerCase(), // key
      v, // value
    ];
  })) as Array<[string, Message]>; // not sure why this cast is necessary, but...
  return res.reduce((a: {[key: string]: Message}, kv: [string, Message]) => {
    a[kv[0]] = kv[1];
    return a;
  }, {});
};

export {
  testAll,
  testAmpStory,
  testAmpStoryV1,
  testAmpStoryV1Metadata,
  testBookendCache,
  testBookendSameOrigin,
  testCanonical,
  testSchemaMetadataType,
  testSchemaMetadataRecent,
  testMostlyText,
  testValidity,
  testVideoSize,
  testVideoSource,
  testMetaCharsetFirst,
  testThumbnails,
  // "private" functions get prefixed
  getBody as _getBody,
  getSchemaMetadata as _getSchemaMetadata,
  getInlineMetadata as _getInlineMetadata,
  getImageSize as _getImageSize,
};

if (require.main === module) { // invoked directly?

  if (process.argv.length <= 2) {
    console.error(`usage: ${basename(process.argv[0])} ${basename(process.argv[1])} URL [copy_as_cURL]`);
    process.exit(1);
  }

  const url = process.argv[2];

  function seq(first: number, last: number): number[] {
    if (first < last) {
      return [first].concat(seq(first + 1, last));
    } else if (first > last) {
      return [last].concat(seq(first, last - 1));
    } else {
      return [first];
    }
  }

  const headers = seq(2, process.argv.length - 1)
    .filter(n => process.argv[n] === "-H")
    .map(n => process.argv[n + 1])
    .map(s => {
      const [h, ...v] = s.split(": ");
      return [h, v.join("")];
    })
    .reduce((a: {[key: string]: any}, kv) => {
      a[kv[0]] = kv[1];
      return a;
    }, {});

  // console.log(headers);

  const body = (() => {
    if (url === "-") {
      return Promise.resolve(readFileSync("/dev/stdin").toString());
    } else {
      return fetch(url, { headers }).then(
        r => r.ok ? r.text() : Promise.reject(`couldn't load [${url}]: ${r.statusText}`)
      );
    }
  })();

  body
    .then(b => cheerio.load(b))
    .then($ => testAll({$, headers, url}))
    .then(console.log)
    .then(() => process.exit(0))
    .catch((e) => console.error(`error: ${e}`));

}
