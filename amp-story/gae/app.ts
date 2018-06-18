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

import express = require("express");
import {compile} from "handlebars";

import ampCors from "./amp-cors.js";
import * as validate from "./amp-story-linter";

const ORIGIN = process.env.ORIGIN || `https://${process.env.PROJECT_ID}.appspot.com`;

const INDEX = (() => {
  const template = compile(fs.readFileSync("index.hbs").toString());
  return template({
    canonical: ORIGIN,
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

app.get("/", (req, res) => {
  res.status(200);
  res.setHeader("content-type", "text/html");
  // res.send(JSON.stringify(req.query));
  res.send(INDEX);
  res.end();
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`);
  console.log("Press Ctrl+C to quit.");
});
