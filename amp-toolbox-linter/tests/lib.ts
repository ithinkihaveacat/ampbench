const FIXTURES = "fixtures";

import { existsSync } from "fs";

import * as cheerio from "cheerio";
import debug from "debug";
import { diffJson as diff } from "diff";
import { back as nockBack } from "nock";
import { default as fetch } from "node-fetch";

import * as linter from "../src";

import throat from "throat";

const log = debug("linter");

nockBack.fixtures = `${__dirname}/${FIXTURES}`;

export let COUNT = 0;

// Need to throttle to one run at a time because nock() works by monkey patching
// the (global) http.* object, which means it can't run in parallel.
export const withFixture = throat(
  1,
  async <T>(fixtureName: string, fn: () => Promise<T>): Promise<T> => {
    const fixturePath = `${fixtureName}.json`;
    if (existsSync(`${nockBack.fixtures}/${fixturePath}`)) {
      log(`nocking HTTP requests with fixture [${fixturePath}]`);
      nockBack.setMode("lockdown");
      const { nockDone } = await nockBack(fixturePath);
      const res = await fn();
      nockDone();
      return res;
    } else {
      log(`recording HTTP requests to fixture [${fixturePath}] ...`);
      nockBack.setMode("record");
      const { nockDone } = await nockBack(fixturePath);
      const res = await fn();
      return new Promise<T>(resolve => {
        setTimeout(() => {
          // wait for probe-image-size's aborts to settle
          nockDone();
          log(`... created fixture [${fixturePath}]`);
          resolve(res);
        }, 2000);
      });
    }
  }
) as <T>(fixtureName: string, fn: () => Promise<T>) => Promise<T>;

export async function assertEqual<T extends object>(
  testName: string,
  actual: T | Promise<T>,
  expected: T | Promise<T>
) {
  COUNT++;
  const res = diff(
    await Promise.resolve(expected),
    await Promise.resolve(actual)
  );
  if (res && res.length === 1) {
    console.log(`ok ${COUNT} - ${testName}`);
  } else {
    const as = JSON.stringify(await Promise.resolve(actual));
    const es = JSON.stringify(await Promise.resolve(expected));
    console.log(`not ok ${COUNT} - ${testName} actual: ${as}, expected: ${es}`);
  }
  return res;
}

export async function assertNotEqual<T extends object>(
  testName: string,
  actual: T | Promise<T>,
  expected: T | Promise<T>
) {
  COUNT++;
  const res = diff(
    await Promise.resolve(expected),
    await Promise.resolve(actual)
  );
  if (res && res.length === 1) {
    const as = JSON.stringify(await Promise.resolve(actual));
    const es = JSON.stringify(await Promise.resolve(expected));
    console.log(
      `not ok ${COUNT} - ${testName} actual: ${as}, not expected: ${es}`
    );
  } else {
    console.log(`ok ${COUNT} - ${testName}`);
  }
  return res;
}

export async function assertMatch<T extends object>(
  testName: string,
  actual: T | Promise<T>,
  expected: RegExp | string
) {
  COUNT++;
  const s = JSON.stringify(await Promise.resolve(actual));
  if (s.match(expected)) {
    console.log(`ok ${COUNT} - ${testName}`);
  } else {
    console.log(
      `not ok ${COUNT} - ${testName} actual: ${s}, expected regexp match: ${expected.toString()}`
    );
  }
}

export async function assertFn<T extends object>(
  testName: string,
  actual: T | Promise<T>,
  expectedFn: (actual: T) => string
) {
  COUNT++;
  const res = expectedFn(await actual);
  if (!res) {
    console.log(`ok ${COUNT} - ${testName}`);
  } else {
    console.log(`not ok ${COUNT} - ${testName} [${res}]`);
  }
  return res;
}

export async function runTest<T>(fn: linter.Test, url: string) {
  const res = await fetch(url);
  const body = await res.text();
  const $ = cheerio.load(body);
  const context = {
    $,
    headers: {},
    url,
    raw: { body, headers: {} }
  };
  return Promise.resolve(fn(context));
}

export async function runTestList<T>(fn: linter.TestList, url: string) {
  const res = await fetch(url);
  const body = await res.text();
  const $ = cheerio.load(body);
  const context = {
    $,
    headers: {},
    url,
    raw: { body, headers: {} }
  };
  return Promise.resolve(fn(context));
}

export async function runCheerioFn<T>(
  fn: ($: CheerioStatic, url?: string) => T | Promise<T>,
  url: string
) {
  const res = await fetch(url);
  const body = await res.text();
  const $ = cheerio.load(body);
  return Promise.resolve(fn($, url));
}

export async function runUrlFn<T>(fn: (url: string) => T, url: string) {
  return Promise.resolve(fn(url));
}
