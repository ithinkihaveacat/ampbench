import { default as fetch } from "node-fetch";
import * as cheerio from "cheerio";
import * as nock from "nock";
import {diffJson as diff} from 'diff';

import { _getBody as getBody } from "../index";
import { _getSchemaMetadata as getSchemaMetadata } from "../index";
import { _getInlineMetadata as getInlineMetadata } from "../index";

import { back as nockBack } from "nock";

nockBack.fixtures = __dirname + "/nock";
nockBack.setMode("record");

function run(fn: ($: CheerioStatic) => any, count: number, url: string, expected: any) {
  nockBack(`${fn.name.toLowerCase()}.json`, nockDone => {
    getBody(url)
      .then(res => res.text())
      .then(body => {
        const $ = cheerio.load(body);
        const actual = fn($);
        const res = diff(expected, actual);
        if (res && res.length === 1) {
          console.log(`ok ${count} - ${fn.name}`);
        } else {
          console.log(`not ok ${count} - ${fn.name} # actual: ${JSON.stringify(actual)}`);
        }
      })
      .then(nockDone);
  });
}

let count = 0;

run(
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

run(
  getInlineMetadata,
  ++count,
  "https://ithinkihaveacat.github.io/hello-world-amp-story/",
  {
    "title": "Hello, Ken Burns",
    "publisher": "Michael Stillwell",
    "publisher-logo-src": "https://s.gravatar.com/avatar/3928085cafc1e496fb3d990a9959f233?s=150",
    "poster-portrait-src": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ee/Cantilever_bridge_human_model.jpg/627px-Cantilever_bridge_human_model.jpg"
  }
);

console.log(`1..${count}`);
