// @ts-check

import * as fs from 'fs';
import * as cheerio from 'cheerio';
import * as diff from 'diff';

const validate = require('./index.js');

const DIR = 'test';

fs.readdirSync(DIR).forEach(d => {

  const prefix = `${DIR}/${d}`;

  const $ = (() => {
    try {
      return cheerio.load(fs.readFileSync(`${prefix}/source.html`).toString());
    } catch (e) {
      console.error(`error: can't read/parse ${prefix}/source.html, skipping test ${d}`);
      return null;
    }
  })();

  const expected = (() => {
    try {
      return JSON.parse(fs.readFileSync(`${prefix}/expected.json`).toString());
    } catch (e) {
      console.error(`error: can't read/parse ${prefix}/expected.json, skipping test ${d}`);
      return null;
    }
  })();

  if (!$ || !expected) return;

  const url = expected._url;

  const tests = Object.keys(expected).filter(s => s.startsWith('is'));

  const actual = Promise.all(tests.map(t => validate[t]($, url).then(v => [t, v]))).then(args => {
    return args.reduce((a, v) => {
      a[v[0]] = v[1];
      return a;
    }, {});
  });

  const res = diff.diffJson(expected, actual);

  console.log(res);

  console.log({actual, expected});

});