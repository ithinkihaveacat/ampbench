import * as cheerio from "cheerio";
import { diffJson as diff } from "diff";
import * as nock from "nock";
import { default as fetch } from "node-fetch";

import { _getBody as getBody } from "../index";
import { _getSchemaMetadata as getSchemaMetadata } from "../index";
import { _getInlineMetadata as getInlineMetadata } from "../index";
import { _getImageSize as getImageSize } from "../index";
import { testThumbnails } from "../index";

import { back as nockBack } from "nock";

nockBack.fixtures = __dirname + "/nock";

// "record" to record HTTP request (when writing new tests)
// "lockdown" to use fixtures only
nockBack.setMode("lockdown");

const TIMEOUT = (nockBack as any).currentMode === "record" ? 2000 : 0;

/**
 * Test helper for functions that take a Cheerio object.  `url` will be loaded
 * from fixtures if available, otherwise a "real" network request will be made,
 * and the result saved as a fixture.
 *
 * Approximate pseudo-code translation:
 *
 * @example
 * const $ = cheerio.load(fetch(url));
 * const actual = fn($);
 * return actual === expected;
 *
 * @param fn function to test
 * @param count the test number (needed for TAP)
 * @param url input URL
 * @param expected expected output
 */
function runCheerio(
  fn: ($: CheerioStatic) => any,
  count: number,
  url: string,
  expected: any,
) {
  nockBack(`${fn.name.toLowerCase()}.json`, nockDone => {
    getBody(url)
      .then(res => res.text())
      .then(async body => {
        const $ = cheerio.load(body);
        const actual = await Promise.resolve(fn($));
        const res = diff(expected, actual);
        if (res && res.length === 1) {
          console.log(`ok ${count} - ${fn.name}`);
        } else {
          console.log(
            `not ok ${count} - ${fn.name} # actual: ${JSON.stringify(actual)}`,
          );
        }
      })
      .then(() => setTimeout(nockDone, TIMEOUT)); // wait for probe-image-size's aborts to settle
  });
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
  nockBack(`${fn.name.toLowerCase()}.json`, nockDone => {
    fn(url)
      .then((actual: any) => {
        const res = diff(expected, actual);
        if (res && res.length === 1) {
          console.log(`ok ${count} - ${fn.name}`);
        } else {
          console.log(
            `not ok ${count} - ${fn.name} # actual: ${JSON.stringify(actual)}`,
          );
        }
      })
      .then(() => setTimeout(nockDone, TIMEOUT));
  });
}

let COUNT = 0;

runCheerio(
  getSchemaMetadata,
  ++COUNT,
  "https://ampbyexample.com/stories/introduction/amp_story_hello_world/preview/embed/",
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
);

runCheerio(
  getInlineMetadata,
  ++COUNT,
  "https://ithinkihaveacat.github.io/hello-world-amp-story/",
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
);

runCheerio(
  testThumbnails,
  ++COUNT,
  // "https://ithinkihaveacat.github.io/hello-world-amp-story/",
  "https://ampbyexample.com/stories/introduction/amp_story_hello_world/preview/embed/",
  {
    status: "OKAY",
  },
);

runUrl(
  getImageSize,
  ++COUNT,
  "https://s.gravatar.com/avatar/3928085cafc1e496fb3d990a9959f233?s=150",
  {
    hUnits: "px",
    height: 150,
    length: 8654,
    mime: "image/jpeg",
    type: "jpg",
    url: "https://s.gravatar.com/avatar/3928085cafc1e496fb3d990a9959f233?s=150",
    wUnits: "px",
    width: 150,
  },
);

console.log(`1..${COUNT}`);
