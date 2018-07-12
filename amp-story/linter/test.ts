// @ts-check

import {basename} from "path";

import * as fs from 'fs';
import * as cheerio from 'cheerio';
import {diffJson as diff} from 'diff';

import * as validate from "./index";

const DIR = 'test';

async function run(prefix: string) {

  const match = prefix.match(/\/(.*)\-/);

  if (!match) {
    console.warn(`skipping ${prefix}`);
    return;
  }

  const name = match[1];

  if (!(name in validate)) {
    console.warn(`${name}() not found`);
    return;
  }

  const $ = (() => {
    try {
      return cheerio.load(fs.readFileSync(`${prefix}/source.html`).toString());
    } catch (e) {
      console.error(`error: can't read/parse ${prefix}/source.html, skipping ${prefix}`);
      return null;
    }
  })();

  const expected = (() => {
    try {
      return JSON.parse(fs.readFileSync(`${prefix}/expected.json`).toString());
    } catch (e) {
      console.error(`error: can't read/parse ${prefix}/expected.json, skipping ${prefix}`);
      return null;
    }
  })();

  if (!$ || !expected) return;

  const url = expected._url || "https://example.com/";

  const fn = (validate as any)[name] as (($: CheerioStatic, url: string) => Promise<validate.Message>);
  const actual = await fn($, url);

  return diff(expected, actual);
}

if (process.argv.length === 3) {

  const prefix = process.argv[2];

  run(prefix).then(res => {
    if (!res) return;
    res.forEach(part => {
      var color = part.added ? 'green' :
        part.removed ? 'red' : 'grey';
      process.stdout.write((part.value as any)[color]);
    });
    process.stdout.write("\n");
  });

} else {

  let count = 0;

  fs.readdirSync(DIR).forEach(async d => {
    count++;
    const prefix = `${DIR}/${d}`;
    const res = await run(prefix);
    if (res && res.length === 1) {
      console.log(`ok ${count} - ${prefix}`);
    } else {
      console.log(`no ok ${count} - ${prefix} # more info: ${basename(process.argv[0])} ${basename(process.argv[1])} ${prefix}`);
    }
  });

  console.log(`1..${count}`);

}