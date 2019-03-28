# AMP Linter

[![npm
version](https://badge.fury.io/js/amp-toolbox-linter.svg)](https://badge.fury.io/js/amp-toolbox-linter)

## Overview

A [linter](<https://en.wikipedia.org/wiki/Lint_(software)>) for AMP documents:
reports errors and suspicious constructions such as images missing or
incorrectly sized, missing CORS headers, or invalid metadata.

## Status

This code is alpha quality.

## Usage

Command-line (local build):

```sh
$ npm install
$ npm run build # generates src/cli.js from src/cli.ts
$ node src/cli.js https://www.ampproject.org/
```

Command-line (from npm):

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

linter.MetaCharsetIsFirst(context).then(console.log);
```

## Development

### Commands

#### `npm install`

Installs dependencies. Run this first.

#### `npm run build`

Builds `*.js` from `*.ts`.

#### `npm test`

Runs the tests.

#### `npm run lint`

Checks the code for lint errors.

#### `npm run watch`

Automatically rebuild `*.js` whenever `*.ts` changes.

#### `npm run package`

Generates npm-installable version of the package in `pkg/`. From another
directory install via `npm install amp-toolbox-linter/pkg`.

#### `npm run publish`

Uses @pika's `pack publish` to publish to npm.

### Suggested Test-Creation Workflow

1. Create stub function in `index.ts`, that always "fails". e.g. it always
   returns `qqqqqq`. It should implement either the `Test` or `TestList`
   interface.
1. Write tests in `tests/network.ts`. (If HTTP requests are required; if not
   then create a directory in `tests/local/MyNewTest-1` that contains a
   `source.html` (AMP HTML source) and `expected.json` (expected JSON output),
   and `tests/local.js` will automatically execute your "test".)
1. Run the test using `npm test`. If the fixtures can't be found, they will be
   generated automatically (via real network requests). Hopefully your test will
   fail.
1. Fix the implementation, and re-run the test.
1. Use `npm run publish` to publish the new version to npm. (If you have
   two-factor auto turned on, this might not work, even though no errors are
   reported. To actually publish (or at least see the errors), run `npm publish`
   from the `pkg` directory.)
