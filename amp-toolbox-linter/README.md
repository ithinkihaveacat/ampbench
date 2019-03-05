# AMP Linter

[![npm
version](https://badge.fury.io/js/amp-toolbox-linter.svg)](https://badge.fury.io/js/amp-toolbox-linter)

## Overview

A [linter](<https://en.wikipedia.org/wiki/Lint_(software)>) for AMP documents:
reports errors and suspicious constructions such as images missing or
incorrectly sized, missing CORS headers, or invalid metadata.

## Status

This code is alpha quality. It works best on [AMP
Stories](https://www.ampproject.org/docs/reference/components/amp-story), and
currently reports unnecessary warnings for valid AMP documents that are not
Stories.

## Usage

Command-line:

```sh
$ npx amp-toolbox-linter https://www.ampproject.org/
```

Node:

```js
const fs = require("fs");
const linter = require("amp-toolbox-linter");
const cheerio = require("cheerio");

const body = fs.readFileSync("ampproject.html");
const context = {
  $: cheerio.load(body),
  headers: {},
  url: "https://www.ampproject.org/"
};

linter.testMetaCharsetFirst(context).then(console.log);
```
