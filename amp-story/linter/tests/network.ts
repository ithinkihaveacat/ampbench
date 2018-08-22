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
  testCount: number,
  testName: string,
  actual: T,
  expected: T,
) {
  const res = diff(expected, actual);
  if (res && res.length === 1) {
    console.log(`ok ${testCount} - ${testName}`);
  } else {
    console.log(`not ok ${testCount} - ${testName} actual: ${JSON.stringify(actual)}`);
  }
  return Promise.resolve(res);
}

function assertNotEqual<T extends object>(
  testCount: number,
  testName: string,
  actual: T,
  expected: T,
) {
  const res = diff(expected, actual);
  if (res && res.length === 1) {
    console.log(`not ok ${testCount} - ${testName} actual: ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok ${testCount} - ${testName}`);
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

/**
 * Test helper for functions that take a URL. `url` will be loaded from fixtures
 * if available, otherwise a "real" network request will be made, and the result
 * saved as a fixture.
 *
 * @param fn function to test
 * @param count the test number (needed for TAP)
 * @param url input URL
 * @param expected expected output
 */
function runUrl(
  fn: (url: string) => Promise<any>,
  count: number,
  url: string,
  expected: any,
) {
  withFixture(`${fn.name.toLowerCase()}.json`, async () => {
    const actual = await fn(url);
    const res = diff(expected, actual);
    if (res && res.length === 1) {
      console.log(`ok ${count} - ${fn.name}`);
    } else {
      console.log(`not ok ${count} - ${fn.name} actual: ${JSON.stringify(actual)}`);
    }
  });
}

let COUNT = 0;

withFixture("getschemametadata", async () => assertEqual(
  ++COUNT,
  "getschemametadata",
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
  ++COUNT,
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

withFixture("testthumbnails", async () => assertEqual(
  ++COUNT,
  "testThumbnails",
  await runCheerioFn(
    linter.testThumbnails,
    "https://ampbyexample.com/stories/introduction/amp_story_hello_world/preview/embed/"
  ),
  {
    status: "OKAY",
  },
));

withFixture("testvideosize", async () => assertEqual(
  ++COUNT,
  "testVideoSize",
  await runCheerioFn(
    linter.testVideoSize,
    "https://ampbyexample.com/stories/features/media/preview/embed/"
  ),
  {
    status: "OKAY"
  }
));

withFixture("testvalidity1", async () => assertEqual(
  ++COUNT,
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
  ++COUNT,
  "testValidity - not valid",
  await runCheerioFn(
    linter.testValidity,
    "https://precious-sturgeon.glitch.me/"
  ),
  {
    status: "OKAY"
  }
));

console.log("# dummy"); // https://github.com/scottcorgan/tap-spec/issues/63 (sigh)
console.log(`1..${COUNT}`);
