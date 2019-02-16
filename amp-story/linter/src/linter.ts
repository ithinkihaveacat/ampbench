import { basename } from "path";
import { readFileSync } from "fs";

import { testAll } from ".";

if (process.argv.length <= 2) {
  console.error(
    `usage: ${basename(process.argv[0])} ${basename(
      process.argv[1]
    )} URL|copy_as_cURL`
  );
  process.exit(1);
}

const url =
  process.argv[2] === "-" ? "-" : process.argv.filter(s => s.match(/^http/))[0];

function seq(first: number, last: number): number[] {
  if (first < last) {
    return [first].concat(seq(first + 1, last));
  } else if (first > last) {
    return [last].concat(seq(first, last - 1));
  } else {
    return [first];
  }
}

const headers = seq(2, process.argv.length - 1)
  .filter(n => process.argv[n] === "-H")
  .map(n => process.argv[n + 1])
  .map(s => {
    const [h, ...v] = s.split(": ");
    return [h, v.join("")];
  })
  .reduce((a: { [key: string]: any }, kv) => {
    a[kv[0]] = kv[1];
    return a;
  }, {});

const body = (() => {
  if (url === "-") {
    return Promise.resolve(readFileSync("/dev/stdin").toString());
  } else {
    return fetch(url, { headers }).then(r =>
      r.ok
        ? r.text()
        : Promise.reject(`couldn't load [${url}]: ${r.statusText}`)
    );
  }
})();

body
  .then(b => cheerio.load(b))
  .then($ => testAll({ $, headers, url }))
  .then(r => console.log(JSON.stringify(r, null, 2)))
  .then(() => process.exit(0))
  .catch(e => console.error(`error: ${e}`));
