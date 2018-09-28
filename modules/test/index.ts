import { existsSync } from "fs";

import * as cheerio from "cheerio";
import * as debug from "debug";
import { back as nockBack } from "nock";
import { diffJson as diff } from "diff";

import throat = require("throat");

import * as core from "ampbench-core";

const log = debug(require("package.json").name);

export let FIXTURE_DIR = `${__dirname}/fixtures`;
export let COUNT = 0;

// Need to throttle to one run at a time because nock() works by monkey patching
// the (global) http.* object, which means it can't run in parallel.
export const withFixture = throat(1,
  async <T>(fixtureName: string, fn: () => Promise<T>): Promise<T> => {
    const fixturePath = `${fixtureName}.json`;
    if (existsSync(`${nockBack.fixtures}/${fixturePath}`)) {
      log(`nocking HTTP requests with fixture [${fixturePath}]`);
      nockBack.fixtures = FIXTURE_DIR;
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
      return new Promise<T>((resolve) => {
        setTimeout(() => { // wait for any aborts to settle…
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
  actual: T|Promise<T>,
  expected: T|Promise<T>
) {
  COUNT++;
  const res = diff(
    await Promise.resolve(expected),
    await Promise.resolve(actual)
  );
  if (res && res.length === 1) {
    console.log(`ok ${COUNT} - ${testName}`);
  } else {
    const s = JSON.stringify(await Promise.resolve(actual));
    console.log(`not ok ${COUNT} - ${testName} actual: ${s}`);
  }
  return res;
}

export async function assertNotEqual<T extends object>(
  testName: string,
  actual: T|Promise<T>,
  expected: T|Promise<T>
) {
  COUNT++;
  const res = diff(
    await Promise.resolve(expected),
    await Promise.resolve(actual)
  );
  if (res && res.length === 1) {
    const s = JSON.stringify(await Promise.resolve(actual));
    console.log(`not ok ${COUNT} - ${testName} actual: ${s}`);
  } else {
    console.log(`ok ${COUNT} - ${testName}`);
  }
  return res;
}

export async function assertMatch<T extends object>(
  testName: string,
  actual: T|Promise<T>,
  expected: string
) {
  COUNT++;
  const s = JSON.stringify(await Promise.resolve(actual));
  if (s.match(expected)) {
    console.log(`ok ${COUNT} - ${testName}`);
  } else {
    console.log(`not ok ${COUNT} - ${testName} actual: ${s}`);
  }
}

export async function assertFn<T extends object>(
  testName: string,
  actual: T|Promise<T>,
  expectedFn: (expected: T) => string,
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

export async function runTest<T>(fn: core.Test, url: string) {
  const res = await fetch(url);
  const body = await res.text();
  const $ = cheerio.load(body);
  const context = {
    $,
    headers: {},
    url
  };
  return Promise.resolve(fn(context));
}

export async function runTestList<T>(fn: core.TestList, url: string) {
  const res = await fetch(url);
  const body = await res.text();
  const $ = cheerio.load(body);
  const context = {
    $,
    headers: {},
    url
  };
  return Promise.resolve(fn(context));
}

export async function runCheerioFn<T>(fn: ($: CheerioStatic, url?: string) => T|Promise<T>, url: string) {
  const res = await fetch(url);
  const body = await res.text();
  const $ = cheerio.load(body);
  return Promise.resolve(fn($, url));
}

export async function runUrlFn<T>(fn: (url: string) => T, url: string) {
  return Promise.resolve(fn(url));
}

