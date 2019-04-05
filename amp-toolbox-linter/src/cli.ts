import { readFileSync } from "fs";
import program from "commander";
import fetch from "node-fetch";
import cheerio from "cheerio";

import { testsForType, lint, Message } from ".";
import { fetchToCurl } from "./url";
import { isArray } from "util";

const UA = {
  googlebot_mobile: [
    "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36",
    "(KHTML, like Gecko) Chrome/41.0.2272.96 Mobile Safari/537.36",
    "(compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
  ].join(" "),
  googlebot_desktop: [
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible;",
    "Googlebot/2.1; +http://www.google.com/bot.html) Safari/537.36"
  ].join(" "),
  chrome_mobile: [
    "Mozilla/5.0 (Linux; Android 8.0; Pixel 2 Build/OPD3.170816.012)",
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.86 Mobile Safari/537.36"
  ].join(" "),
  chrome_desktop: [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_3)",
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.86 Safari/537.36"
  ].join(" ")
};

export function cli(argv: string[]) {
  program
    .version(require("../package.json").version)
    .usage(`amplint [options] URL|copy_as_cURL`)
    .option(
      `-f, --force <string>`,
      "override test type",
      /^(auto|sxg|amp|ampstory)$/i,
      "auto"
    )
    .option(
      `-t, --format <string>`,
      "override output format",
      /^(text|json|tsv|html)$/i,
      "text"
    )
    .option(
      `-A, --user-agent <string>`,
      "user agent string",
      /^(googlebot_desktop|googlebot_mobile|chrome_desktop|chrome_mobile)$/i,
      "googlebot_mobile"
    )
    .on("--help", function() {
      console.log("");
      console.log("Examples:");
      console.log("  $ amplint https://www.ampproject.org/");
      console.log("  $ amplint --force sxg https://www.ampbyexample.org/");
    });

  if (argv.length <= 2) {
    program.help();
  }

  function seq(first: number, last: number): number[] {
    if (first < last) {
      return [first].concat(seq(first + 1, last));
    } else if (first > last) {
      return [last].concat(seq(first, last - 1));
    } else {
      return [first];
    }
  }

  // One reason to support curl-style arguments is to provide cookies that avoid
  // GDPR interstitials.
  const headers: { [k: string]: string } = seq(2, argv.length - 1)
    .filter(n => argv[n] === "-H")
    .map(n => argv[n + 1])
    .map(s => {
      const [h, ...v] = s.split(": ");
      return [h, v.join("")];
    })
    .reduce((a: { [key: string]: any }, kv) => {
      a[kv[0]] = kv[1];
      return a;
    }, {});

  // Options is argv with "curl" and all -H flags removed (to pass to
  // program.parse())
  const options = seq(0, argv.length - 1)
    .filter(n => argv[n] !== "curl" && argv[n] !== "-H" && argv[n - 1] !== "-H")
    .map(n => argv[n]);

  program.parse(options);

  const url = program.args[0];
  if (!url) {
    program.help();
  } else {
    program.url = url;
  }

  program.headers = headers;

  return easyLint((program as unknown) as {
    userAgent: string;
    format: string;
    force: string;
    url: string;
    headers: { [k: string]: string };
  })
    .then(console.log)
    .catch(e => {
      console.error(e.stack || e.message || e);
      process.exitCode = 1;
    });
}

export function easyLint({
  url,
  userAgent,
  format,
  force,
  headers
}: {
  url: string;
  userAgent: string;
  format: string;
  force: string;
  headers: { [k: string]: string };
}) {
  headers["user-agent"] = UA[userAgent as keyof typeof UA];

  const raw = (async () => {
    if (url === "-") {
      return Promise.resolve({
        body: readFileSync("/dev/stdin").toString(),
        headers: {}
      });
    }
    const debug = fetchToCurl(url, { headers });
    try {
      const res = await fetch(url, { headers });
      return res.ok
        ? Promise.resolve({
            headers: res.headers,
            body: await res.text()
          })
        : Promise.reject(
            `couldn't load [${url}]: ${res.statusText} [debug: ${debug}]`
          );
    } catch (e) {
      return Promise.reject(`couldn't load [${url}] [debug: ${debug}]`);
    }
  })();

  return raw
    .then(r => {
      const $ = cheerio.load(r.body);
      const tests = testsForType(force, $);
      return lint(tests, {
        raw: r,
        $,
        headers,
        url
      });
    })
    .then(outputterForType(format));
}

export function outputterForType(
  type: string
): (data: { [key: string]: Message | Message[] }) => string {
  function flatten(data: { [k: string]: Message | Message[] }): string[][] {
    const rows: string[][] = [];
    rows.push(["name", "status", "message"]);
    for (const k of Object.keys(data).sort()) {
      const v = data[k];
      if (!isArray(v)) {
        rows.push([k, v.status, v.message || ""]);
      } else if (v.length == 0) {
        rows.push([k, "PASS", ""]);
      } else {
        for (const vv of v) {
          rows.push([k, vv.status, vv.message || ""]);
        }
      }
    }
    return rows;
  }
  let sep = "\t";
  switch (type) {
    case "tsv":
      return data =>
        flatten(data)
          .map(l => l.join(sep))
          .join("\n");
    case "html":
      return data => {
        const res = flatten(data).splice(1);
        const thead = `<tr><th>Name</th><th>Status</th><th>Message</th><tr>`;
        const tbody = res
          .map(r => r.map(td => `<td>${escape(td)}</td>`).join(""))
          .map(r => `<tr>${r}</tr>`)
          .join("");
        return [
          `<table class="amplint">`,
          `<thead>`,
          thead,
          `</thead>`,
          `<tbody>`,
          tbody,
          `</tbody>`,
          `</table>`
        ].join("\n");
      };
    case "json":
      return (data: any) => JSON.stringify(data, null, 2);
    case "text":
    default:
      return data =>
        flatten(data)
          .splice(1)
          .map(l =>
            l[1] == "PASS"
              ? `${l[0]} (${l[1]})\n`
              : `${l[0]} (${l[1]})\n\n  ${l[2]}\n`
          )
          .join("\n");
  }
}

if (require.main === module) {
  cli(process.argv);
}
