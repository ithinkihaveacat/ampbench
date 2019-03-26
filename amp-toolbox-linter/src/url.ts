const CONCURRENCY = 8;
const UA_GOOGLEBOT_MOBILE = [
  "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36",
  "(KHTML, like Gecko) Chrome/41.0.2272.96 Mobile Safari/537.36",
  "(compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
].join(" ");

import throat from "throat";

import { Context } from "./";

import fetch, { Request } from "node-fetch";

import probe from "probe-image-size";
import { resolve } from "url";

export const absoluteUrl = (
  s: string | undefined,
  base: string | undefined
) => {
  if (typeof s !== "string" || typeof base !== "string") {
    return undefined;
  } else {
    return resolve(base, s);
  }
};

export function fetchToCurl(
  url: string,
  init: { headers?: { [k: string]: string } } = { headers: {} }
) {
  const headers = init.headers || {};

  const h = Object.keys(headers)
    .map(k => `-H '${k}: ${headers[k]}'`)
    .join(" ");

  return `curl -i ${h} '${url}'`;
}

export const redirectUrl = throat(
  CONCURRENCY,
  async (context: Context, s: string | Request) => {
    const res = await fetch(s, { headers: context.headers });
    return res.url;
  }
);

export function dimensions(
  context: Context,
  url: string
): Promise<{ width: number; height: number; mime: string; [k: string]: any }> {
  // Try to prevent server from sending us encoded/compressed streams, since
  // probe-image-size can't handle them:
  // https://github.com/nodeca/probe-image-size/issues/28
  const headers = Object.assign({}, context.headers);
  delete headers["accept-encoding"];
  return probe(absoluteUrl(url, context.url), { headers });
}

export const contentLength = throat(
  CONCURRENCY,
  async (context: Context, s: string | Request) => {
    const options = Object.assign(
      {},
      { method: "HEAD" },
      { headers: context.headers }
    );
    const res = await fetch(s, options);
    if (!res.ok) {
      return Promise.reject(res);
    }
    const contentLength = res.headers.get("content-length");
    return contentLength ? contentLength : 0;
  }
);
