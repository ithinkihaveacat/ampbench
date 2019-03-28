/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as fs from "fs";
import { URL } from "url";

import * as cheerio from "cheerio";
import * as debug from "debug";
import express = require("express");
import { compile, registerHelper } from "handlebars";
import { default as fetch, Request, RequestInit, Response } from "node-fetch";

import ampCors from "./amp-cors.js";
import {
  lint,
  testsForType,
  outputterForType,
  Message
} from "amp-toolbox-linter";
import { isArray } from "util";

const log = debug("linter");

const UA_GOOGLEBOT_MOBILE = [
  "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36",
  "(KHTML, like Gecko) Chrome/41.0.2272.96 Mobile Safari/537.36",
  "(compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
].join(" ");

const ORIGIN =
  process.env.ORIGIN || `https://${process.env.PROJECT_ID}.appspot.com`;

const PORT = (() => {
  if (process.env.NODE_ENV === "production") {
    return 8080;
  } else {
    return new URL(ORIGIN).port || 80;
  }
})();

const BOILERPLATE = `<style amp-boilerplate>body{-webkit-animation:-amp-start 8s steps(1,end) 0s 1 normal both;-moz-animation:-amp-start 8s steps(1,end) 0s 1 normal both;-ms-animation:-amp-start 8s steps(1,end) 0s 1 normal both;animation:-amp-start 8s steps(1,end) 0s 1 normal both}@-webkit-keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}@-moz-keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}@-ms-keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}@-o-keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}@keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}</style><noscript><style amp-boilerplate>body{-webkit-animation:none;-moz-animation:none;-ms-animation:none;animation:none}</style></noscript>`;

const INDEX = (() => {
  const template = compile(fs.readFileSync("index.hbs").toString());
  return template({
    canonical: ORIGIN,
    boilerplate: BOILERPLATE
  });
})();

const app = express();

app.use((req, res, next) => {
  if (process.env.NODE_ENV === "production") {
    res.setHeader("strict-transport-security", "max-age=31556926");
  }
  next();
});

app.use(ampCors(ORIGIN));

app.use(express.static("public"));

app.get("/", (req, res) => {
  res.status(200);
  res.setHeader("content-type", "text/html");
  res.send(INDEX);
  res.end();
});

app.get("/lint", async (req, res, next) => {
  const url = req.query.url;
  if (!url) {
    res.status(400);
    res.setHeader("content-type", "application/json");
    res.send(
      JSON.stringify({
        message: "no [url] query string parameter provided",
        status: "error"
      })
    );
    res.end();
    return;
  }
  const headers = { "user-agent": UA_GOOGLEBOT_MOBILE };
  const body = (() => {
    return fetch(url, { headers }).then(
      r =>
        r.ok
          ? r.text()
          : Promise.reject(`couldn't load [${url}]: ${r.statusText}`),
      e => Promise.reject(`couldn't load [${url}]`)
    );
  })();
  return body
    .then(b => {
      const $ = cheerio.load(b);
      const tests = testsForType("auto", $);
      return lint(tests, { $, headers, url });
    })
    .then(r => {
      const content = (() => {
        if (req.query.type && req.query.type === "summary") {
          const failures = Object.keys(r).filter(k =>
            isArray(r[k])
              ? (r[k] as Message[]).length > 0
              : (r[k] as Message).status === "FAIL"
          );
          return failures.length === 0 ? "PASS" : "FAIL";
        } else {
          const template = compile(fs.readFileSync("results.hbs").toString());
          const outputter = outputterForType("html");
          return template({ url, body: outputter(r) });
        }
      })();
      res.status(200);
      res.setHeader("content-type", "text/html");
      res.send(content);
      res.end();
    })
    .catch(e => {
      console.error(`error:`, e);
      res.status(e.code === "ENOTFOUND" ? 400 : 500); // probably caller's fault if ENOTFOUND
      res.setHeader("content-type", "application/json");
      res.send(
        JSON.stringify({
          message: `couldn't load [${url}]`,
          status: "error"
        })
      );
    });
});

app.listen(PORT, () => {
  console.log(`App listening at ${ORIGIN}`);
  console.log("Press Ctrl+C to quit.");
});
