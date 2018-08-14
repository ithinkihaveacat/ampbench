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
nockBack.setMode("record");

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
      .then(nockDone);
  });
}

/**
 * Test helper for functions that take a URL. `url` will be loaded from fixtures
 * if available, otherwise a "real" network request will be made, and the result
 * saved as a fixture.
 *
 * @param {(url: string) => any} fn
 * @param {number} count
 * @param {string} url
 * @param {*} expected
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
      .then(nockDone);
  });
}

let COUNT = 0;

/*

runCheerio(
  getSchemaMetadata,
  ++count,
  "https://ampbyexample.com/stories/introduction/amp_story_hello_world/preview/embed/",
  {
    "@context": "http://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        item: {
          "@id": "https://ampbyexample.com/#/stories#stories/introduction",
          name: "Introduction"
        }
      },
      {
        "@type": "ListItem",
        position: 2,
        item: {
          "@id":
            "https://ampbyexample.com/stories/introduction/amp_story_hello_world/",
          name: " AMP Story Hello World"
        }
      }
    ]
  }
);

runCheerio(
  getInlineMetadata,
  ++count,
  "https://ithinkihaveacat.github.io/hello-world-amp-story/",
  {
    title: "Hello, Ken Burns",
    publisher: "Michael Stillwell",
    "publisher-logo-src":
      "https://s.gravatar.com/avatar/3928085cafc1e496fb3d990a9959f233?s=150",
    "poster-portrait-src":
      "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ee/Cantilever_bridge_human_model.jpg/627px-Cantilever_bridge_human_model.jpg"
  }
);

runUrl(
  getImageSize,
  ++count,
  "https://s.gravatar.com/avatar/3928085cafc1e496fb3d990a9959f233?s=150",
  {
    width: 150,
    height: 150,
    type: "jpg",
    mime: "image/jpeg",
    wUnits: "px",
    hUnits: "px",
    length: 8654,
    url: "https://s.gravatar.com/avatar/3928085cafc1e496fb3d990a9959f233?s=150"
  }
);

*/

runCheerio(
  testThumbnails,
  ++COUNT,
  "https://ithinkihaveacat.github.io/hello-world-amp-story/",
  {
  },
);

console.log(`1..${COUNT}`);
