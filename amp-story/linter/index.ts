import {resolve} from "url";
// tslint:disable-next-line:no-var-requires
const validator = require("amphtml-validator").newInstance(
  // Let's not fetch over the network on every run.
  // Use `yarn run update-validator` to update.
  // tslint:disable-next-line:no-var-requires
  require("fs").readFileSync(`${__dirname}/validator.js`).toString(),
);
import * as cheerio from "cheerio";
import throat = require("throat");

import {default as fetch, Request, RequestInit, Response} from "node-fetch";
import {basename} from "path";
import * as punycode from "punycode";
import * as readline from "readline";

const CONCURRENCY = 8;
const UA_GOOGLEBOT_MOBILE = [
  "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36",
  "(KHTML, like Gecko) Chrome/41.0.2272.96 Mobile Safari/537.36",
  "(compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
].join(" ");

interface ActualExpected {
  actual: string,
  expected: string,
}

interface Message {
  status: string,
  message?: string|ActualExpected,
};

const PASS = (): Promise<Message> => Promise.resolve({status: "OKAY"});
const FAIL = (s: string|ActualExpected): Promise<Message> => {
  return Promise.resolve({status: "FAIL", message: s});
};
const WARNING = (s: string|ActualExpected) => {
  return Promise.resolve({status: "WARNING", message: s});
};

const getBody = throat(CONCURRENCY,
  (s: string|Request, init = {}) => {
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
  async (s: string|Request, init?: {}) => {
    const res = await fetch(s, init);
    return res.url;
  },
);

const getContentLength = throat(CONCURRENCY,
  async (s: string|Request) => {
    const options = {
      method: "HEAD",
    };
    const res = await fetch(s, options);
    if (!res.ok) { return Promise.reject(res); }
    const contentLength = res.headers.get("content-length");
    return contentLength ? contentLength : 0;
  },
);

const absoluteUrl = (s: string, base: string) => {
  return resolve(base, s);
  // return new URL(s, base).toString();
};

function getMetadata($: CheerioStatic) {
  const metadata = JSON.parse($('script[type="application/ld+json"]').html() as string);
  return metadata ? metadata : {};
}

function testValidity($: CheerioStatic, url: string) {
  const res = validator.validateString($.html());
  return res.status === "PASS" ? PASS() : res;
}

function testCanonical($: CheerioStatic, url: string) {
  const canonical = $('link[rel="canonical"]').attr("href");
  if (url !== canonical) {
    return FAIL({
      actual: canonical,
      expected: url,
    });
  }
  return getUrl(canonical).then((s) => {
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
}

function testMetadataArticle($: CheerioStatic, url: string) {
  const metadata = getMetadata($);
  const type = metadata["@type"];
  if (type !== "Article" && type !== "NewsArticle" && type !== "ReportageNewsArticle") {
    return WARNING(`@type is not 'Article' or 'NewsArticle' or 'ReportageNewsArticle'`);
  } else {
    return PASS();
  }
}

function testMetadataRecent($: CheerioStatic, url: string) {
  const inLastMonth = (time: number) => {
    return  (time > Date.now() - (30 * 24 * 60 * 60 * 1000)) && (time < Date.now());
  };
  const metadata = getMetadata($);
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
    return WARNING(`datePublished [${datePublished}] or dateModified [${dateModified}] is old or in the future`);
  }
}

function testAmpStory($: CheerioStatic, url: string) {
  if ($("body amp-story[standalone]").length === 1) {
    return PASS();
  } else {
    return FAIL(`couldn't find <amp-story standalone> component`);
  }
}

function testVideoSize($: CheerioStatic, base: string) {
  return Promise.all($(`amp-video source[type="video/mp4"][src], amp-video[src]`).map(async (i, e) => {
    const url = absoluteUrl($(e).attr("src"), base);
    const length = await getContentLength(url);
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
}

function addSourceOrigin(url: string, sourceOrigin: string) {
  const {parse, format} = require("url"); // use old API to work with node 6+
  const obj = parse(url, true);
  obj.query.__amp_source_origin = sourceOrigin;
  obj.search = require("querystring").stringify(obj.query);
  return format(obj);
}

function buildCacheOrigin(cacheSuffix: string, url: string): string {
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
    if (!res.headers) return "";
    const contentType = res.headers.get("content-type") || "";
    return contentType.toLowerCase().split(";")[0];
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

function canXhrSameOrigin(url: string, xhrUrl: string) {
  const sourceOrigin = buildSourceOrigin(url);

  const headers = {
    "amp-same-origin": "true",
  };

  const curl = `curl -i -H 'amp-same-origin: true' '${addSourceOrigin(xhrUrl, sourceOrigin)}'`;

  return fetch(addSourceOrigin(xhrUrl, sourceOrigin), {headers})
    .then(isStatusOk)
    .then(isJson)
    .then(PASS, (e) => FAIL(`can't retrieve bookend: ${e.message} [debug: ${curl}]`));
}

function canXhrCache(url: string, xhrUrl: string, cacheSuffix: string) {
  const sourceOrigin = buildSourceOrigin(url);
  const origin = buildCacheOrigin(cacheSuffix, url);

  const headers = {
    origin,
  };

  const curl = `curl -i -H 'origin: ${origin}' '${addSourceOrigin(xhrUrl, sourceOrigin)}'`;

  return fetch(addSourceOrigin(xhrUrl, sourceOrigin), {headers})
    .then(isStatusOk)
    .then(isAccessControlHeaders(origin, sourceOrigin))
    .then(isJson)
    .then(PASS, (e) => FAIL(`can't retrieve bookend: ${e.message} [debug: ${curl}]`));
}

function testBookendSameOrigin($: CheerioStatic, url: string) {
  const bookendConfigSrc = $("amp-story").attr("bookend-config-src");
  if (!bookendConfigSrc) { return WARNING("bookend-config-src missing"); }
  const bookendUrl = absoluteUrl(bookendConfigSrc, url);
  // if (bookendUrl !== bookendConfigSrc) return WARNING('bookend-config-src not absolute');

  return canXhrSameOrigin(url, bookendUrl);
}

function testBookendCache($: CheerioStatic, url: string) {
  const bookendConfigSrc = $("amp-story").attr("bookend-config-src");
  if (!bookendConfigSrc) { return WARNING("bookend-config-src missing"); }
  const bookendUrl = absoluteUrl(bookendConfigSrc, url);
  // if (bookendUrl !== bookendConfigSrc) return WARNING('bookend-config-src not absolute');

  return canXhrCache(url, bookendUrl, "cdn.ampproject.org");
}

function testVideoSource($: CheerioStatic, url: string) {
  if ($("amp-video[src]").length > 0) {
    return FAIL("<amp-video src> used instead of <amp-video><source/></amp-video>");
  } else {
    return PASS();
  }
}

function testMostlyText($: CheerioStatic, url: string) {
  const text = $("amp-story").text();
  if (text.length > 100) {
    return PASS();
  } else {
    return WARNING(`minimal text in the story [${text}]`);
  }
}

async function testAll($: CheerioStatic, url: string) {
  const tests = [
    testValidity,
    testCanonical,
    testAmpStory,
    testMetadataRecent,
    testMetadataArticle,
    testBookendSameOrigin,
    testBookendCache,
    testVideoSource,
    testVideoSize,
    testMostlyText,
  ];
  const res = await Promise.all(tests.map((f) => f($, url).then((v: any) => [
    f.name.substring("test".length).toLowerCase(), // key
    v, // value
  ]))) as Array<[string, any]>; // not sure why this cast is necessary, but...
  // new Map(res) will return a map but that doesn't play well with JSON
  return res.reduce((a: {[key: string]: any}, kv) => {
    a[kv[0]] = kv[1];
    return a;
  }, {});
}

export {
  testAll,
  testAmpStory,
  testBookendCache,
  testBookendSameOrigin,
  testCanonical,
  testMetadataArticle,
  testMetadataRecent,
  testMostlyText,
  testValidity,
  testVideoSize,
  testVideoSource,
};

if (require.main === module) { // invoked directly?

  if (process.argv.length !== 3) {
    console.error(`usage: ${basename(process.argv[0])} ${basename(process.argv[1])} URL`);
    process.exit(1);
  }

  const url = process.argv[2];

  getBody(url)
    .then(r => r.ok ? r.text() : Promise.reject(`couldn't load [${url}]`))
    .then(b => cheerio.load(b))
    .then($ => testAll($, url))
    .then(console.log)
    .then(() => process.exit(0))
    .catch((e) => console.error(`error: ${e}`))

}
