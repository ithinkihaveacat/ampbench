const FIXTURES = "network";

import { existsSync } from "fs";

import * as cheerio from "cheerio";
import * as debug from "debug";
import { diffJson as diff } from "diff";
import { back as nockBack } from "nock";
import { default as fetch } from "node-fetch";

import { _getBody as getBody } from "..";
import { _getSchemaMetadata as getSchemaMetadata } from "..";
import { _getInlineMetadata as getInlineMetadata } from "..";
import { _getImageSize as getImageSize } from "..";
import * as linter from "..";

import throat = require("throat");

const log = debug("linter");

nockBack.fixtures = `${__dirname}/${FIXTURES}`;

// Need to throttle to one run at a time because nock() works by monkey patching
// the (global) http.* object, which means it can't run in parallel.
const withFixture = throat(1,
  async <T>(fixtureName: string, fn: () => Promise<T>): Promise<T> => {
    const fixturePath = `${fixtureName}.json`;
    if (existsSync(`${nockBack.fixtures}/${fixturePath}`)) {
      log(`nocking HTTP requests with fixture [${fixturePath}]`);
      nockBack.setMode("lockdown");
      const { nockDone } = await nockBack(fixturePath);
      const res = await fn();
      nockDone();
      return res;
    } else {
      log(`recording HTTP requests to fixture [${fixturePath}] ...`);
      nockBack.setMode("record");
      const { nockDone } = await nockBack(fixturePath);
      const res = await fn();
      return new Promise<T>((resolve) => {
        setTimeout(() => { // wait for probe-image-size's aborts to settle
          nockDone();
          log(`... created fixture [${fixturePath}]`);
          resolve(res);
        }, 2000);
      });
    }
  }
) as <T>(fixtureName: string, fn: () => Promise<T>) => Promise<T>;

function assertEqual<T extends object>(
  testName: string,
  actual: T,
  expected: T,
) {
  COUNT++;
  const res = diff(expected, actual);
  if (res && res.length === 1) {
    console.log(`ok ${COUNT} - ${testName}`);
  } else {
    console.log(`not ok ${COUNT} - ${testName} actual: ${JSON.stringify(actual)}`);
  }
  return Promise.resolve(res);
}

function assertNotEqual<T extends object>(
  testName: string,
  actual: T,
  expected: T,
) {
  COUNT++;
  const res = diff(expected, actual);
  if (res && res.length === 1) {
    console.log(`not ok ${COUNT} - ${testName} actual: ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok ${COUNT} - ${testName}`);
  }
  return Promise.resolve(res);
}

async function runCheerioFn<T>(fn: ($: CheerioStatic, url?: string) => T, url: string) {
  const res = await getBody(url);
  const body = await res.text();
  const $ = cheerio.load(body);
  return Promise.resolve(fn($, url));
}

async function runUrlFn<T>(fn: (url: string) => T, url: string) {
  return Promise.resolve(fn(url));
}

let COUNT = 0;

withFixture("getschemametadata", async () => assertEqual(
  "getSchemaMetadata",
  await runCheerioFn(
    getSchemaMetadata,
    "https://ampbyexample.com/stories/introduction/amp_story_hello_world/preview/embed/"
  ),
  {
    "@context": "http://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      {
        "@type": "ListItem",
        "item": {
          "@id": "https://ampbyexample.com/#/stories#stories/introduction",
          "name": "Introduction",
        },
        "position": 1,
      },
      {
        "@type": "ListItem",
        "item": {
          "@id":
            "https://ampbyexample.com/stories/introduction/amp_story_hello_world/",
          "name": " AMP Story Hello World",
        },
        "position": 2,
      }
    ]
  },
));

withFixture("getinlinemetadata", async () => assertEqual(
  "getInlineMetadata",
  await runCheerioFn(
    getInlineMetadata,
    "https://ithinkihaveacat.github.io/hello-world-amp-story/"
  ),
  {
    "poster-portrait-src":
      [
        "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ee/",
        "Cantilever_bridge_human_model.jpg/",
        "627px-Cantilever_bridge_human_model.jpg"
      ].join(""),
    "publisher": "Michael Stillwell",
    "publisher-logo-src":
      "https://s.gravatar.com/avatar/3928085cafc1e496fb3d990a9959f233?s=150",
    "title": "Hello, Ken Burns",
    },
));

withFixture("thumbnails1", async () => assertEqual(
  "testThumbnails - correctly sized",
  await runCheerioFn(
    linter.testThumbnails,
    "https://ampbyexample.com/stories/introduction/amp_story_hello_world/preview/embed/"
  ),
  {
    status: "OKAY",
  },
));

withFixture("thumbnails2", async () => assertNotEqual(
  "testThumbnails - publisher-logo-src missing",
  await runCheerioFn(
    linter.testThumbnails,
    "https://regular-biology.glitch.me/"
  ),
  {
    status: "OKAY"
  }
));

withFixture("testvalidity1", async () => assertEqual(
  "testValidity - valid",
  await runCheerioFn(
    linter.testValidity,
    "https://www.ampproject.org/"
  ),
  {
    status: "OKAY"
  }
));

withFixture("testvalidity2", async () => assertNotEqual(
  "testValidity - not valid",
  await runCheerioFn(
    linter.testValidity,
    "https://precious-sturgeon.glitch.me/"
  ),
  {
    status: "OKAY"
  }
));

withFixture("testcanonical1", async () => assertEqual(
  "testCanonical - canonical",
  await runCheerioFn(
    linter.testCanonical,
    "https://regular-biology.glitch.me/"
  ),
  {
    status: "OKAY"
  }
));

withFixture("testcanonical2", async () => assertNotEqual(
  "testCanonical - not canonical",
  await runCheerioFn(
    linter.testCanonical,
    "https://regular-biology.glitch.me/"
  ),
  {
    status: "OKAY"
  }
));

withFixture("testvideosize1", async () => assertEqual(
  "testVideoSize - too big",
  await runCheerioFn(
    linter.testVideoSize,
    "https://regular-biology.glitch.me/"
  ),
  {
    message: "videos over 4MB: [https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4]",
    status: "FAIL"
  }
));

withFixture("testvideosize2", async () => assertEqual(
  "testVideoSize - good size #1",
  await runCheerioFn(
    linter.testVideoSize,
    "https://regular-biology.glitch.me/"
  ),
  {
    status: "OKAY"
  }
));

withFixture("testvideosize3", async () => assertEqual(
  "testVideoSize - good size #2",
  await runCheerioFn(
    linter.testVideoSize,
    "https://ampbyexample.com/stories/features/media/preview/embed/"
  ),
  {
    status: "OKAY"
  }
));

withFixture("bookendsameorigin1", async () => assertEqual(
  "testBookendSameOrigin - configured correctly",
  await runCheerioFn(
    linter.testBookendSameOrigin,
    "https://ampbyexample.com/stories/introduction/amp_story_hello_world/preview/embed/"
  ),
  {
    status: "OKAY"
  }
));

withFixture("bookendsameorigin2", async () => assertNotEqual(
  "testBookendSameOrigin - bookend not application/json",
  await runCheerioFn(
    linter.testBookendSameOrigin,
    "https://ampbyexample.com/stories/introduction/amp_story_hello_world/preview/embed/"
  ),
  {
    status: "OKAY"
  }
));

withFixture("bookendsameorigin3", async () => assertNotEqual(
  "testBookendSameOrigin - bookend not JSON",
  await runCheerioFn(
    linter.testBookendSameOrigin,
    "https://ampbyexample.com/stories/introduction/amp_story_hello_world/preview/embed/"
  ),
  {
    status: "OKAY"
  }
));

withFixture("bookendcache1", async () => assertEqual(
  "testBookendCache - configured correctly",
  await runCheerioFn(
    linter.testBookendCache,
    "https://ampbyexample.com/stories/introduction/amp_story_hello_world/preview/embed/"
  ),
  {
    status: "OKAY"
  }
));

withFixture("bookendcache2", async () => assertNotEqual(
  "testBookendCache - incorrect headers",
  await runCheerioFn(
    linter.testBookendCache,
    "https://ampbyexample.com/stories/introduction/amp_story_hello_world/preview/embed/"
  ),
  {
    status: "OKAY"
  }
));

console.log("# dummy"); // https://github.com/scottcorgan/tap-spec/issues/63 (sigh)
console.log(`1..16`);
