import { parse, format } from "url";
import { stringify } from "querystring";

import { createCacheUrl } from "amp-toolbox-cache-url";
import { default as fetch } from "node-fetch";

import { isStatusOk, isJson, isAccessControlHeaders } from "./filter";
import { absoluteUrl, fetchToCurl } from "./url";
import { ampType } from "./helper";
import { cli } from "./cli";
import { SchemaMetadataIsNews } from "./rules/SchemaMetadataIsNews";
import { LinkRelCanonicalIsOk } from "./rules/LinkRelCanonicalIsOk";
import { AmpVideoIsSmall } from "./rules/AmpVideoIsSmall";
import { BookendExists } from "./rules/BookendExists";
import { AmpVideoIsSpecifiedByAttribute } from "./rules/AmpVideoIsSpecifiedByAttribute";
import { StoryRuntimeIsV1 } from "./rules/StoryRuntimeIsV1";
import { StoryMetadataIsV1 } from "./rules/StoryMetadataIsV1";
import { MetaCharsetIsFirst } from "./rules/MetaCharsetIsFirst";
import { RuntimeIsPreloaded } from "./rules/RuntimeIsPreloaded";
import { StoryIsMostlyText } from "./rules/StoryIsMostlyText";
import { StoryMetadataThumbnailsAreOk } from "./rules/StoryMetadataThumbnailsAreOk";
import { AmpImgHeightWidthIsOk } from "./rules/AmpImgHeightWidthIsOk";
import { AmpImgAmpPixelPreferred } from "./rules/AmpImgAmpPixelPreferred";
import { EndpointsAreAccessibleFromOrigin } from "./rules/EndpointsAreAccessibleFromOrigin";
import { EndpointsAreAccessibleFromCache } from "./rules/EndpointsAreAccessibleFromCache";
import { SxgVaryOnAcceptAct } from "./rules/SxgVaryOnAcceptAct";
import { SxgContentNegotiationIsOk } from "./rules/SxgContentNegotiationIsOk";
import { SxgDumpSignedExchangeVerify } from "./rules/SxgDumpSignedExchangeVerify";
import { SxgAmppkgIsForwarded } from "./rules/SxgAmppkgIsForwarded";
import { RuleConstructor } from "./rule";

export enum LintType {
  Amp,
  AmpStory,
  Amp4Ads,
  Amp4Email,
  Sxg
}

export enum Status {
  PASS = "PASS",
  FAIL = "FAIL",
  WARN = "WARN",
  INFO = "INFO",
  INTERNAL_ERROR = "INTERNAL_ERROR"
}

export interface Result {
  readonly status: Status;
  readonly message?: string;
}

export interface Context {
  readonly url: string;
  readonly $: CheerioStatic;
  readonly raw: { headers: { [key: string]: string }; body: string };
  readonly headers: {
    [key: string]: string;
  };
}

const isPass = (m: Result): boolean => {
  return m.status === Status.PASS;
};

export const notPass = (m: Result): boolean => {
  return m.status !== Status.PASS;
};

/**
 * Adds `__amp_source_origin` query parameter to URL.
 *
 * @param url
 * @param sourceOrigin
 */
function addSourceOrigin(url: string, sourceOrigin: string) {
  const obj = parse(url, true);
  obj.query.__amp_source_origin = sourceOrigin;
  obj.search = stringify(obj.query);
  return format(obj);
}

function buildSourceOrigin(url: string) {
  const obj = parse(url, true);
  return `${obj.protocol}//${obj.host}`;
}

export function canXhrSameOrigin(context: Context, xhrUrl: string) {
  xhrUrl = absoluteUrl(xhrUrl, context.url)!;
  const sourceOrigin = buildSourceOrigin(context.url);

  const headers = Object.assign({ "amp-same-origin": "true" }, context.headers);

  const debug = fetchToCurl(addSourceOrigin(xhrUrl, sourceOrigin), { headers });

  return fetch(addSourceOrigin(xhrUrl, sourceOrigin), { headers })
    .then(isStatusOk)
    .then(isJson)
    .then(
      () => this.pass(),
      (e: Error) =>
        this.fail(`can't XHR [${xhrUrl}]: ${e.message} [debug: ${debug}]`)
    );
}

export async function canXhrCache(
  context: Context,
  xhrUrl: string,
  cacheSuffix: string
) {
  const sourceOrigin = buildSourceOrigin(context.url);
  const url = await createCacheUrl(cacheSuffix, context.url);
  const obj = parse(url);
  const origin = `${obj.protocol}//${obj.host}`;

  const headers = Object.assign({}, { origin }, context.headers);

  const curl = fetchToCurl(addSourceOrigin(xhrUrl, sourceOrigin), { headers });

  return fetch(addSourceOrigin(xhrUrl, sourceOrigin), { headers })
    .then(isStatusOk)
    .then(isAccessControlHeaders(origin, sourceOrigin))
    .then(isJson)
    .then(
      () => this.pass(),
      e => this.fail(`can't XHR [${xhrUrl}]: ${e.message} [debug: ${curl}]`)
    );
}

export function testsForType(type: string, $: CheerioStatic) {
  const tests: Map<LintType, Array<RuleConstructor>> = new Map();
  tests.set(LintType.Sxg, [
    SxgAmppkgIsForwarded,
    SxgContentNegotiationIsOk,
    SxgVaryOnAcceptAct,
    SxgDumpSignedExchangeVerify
  ]);
  tests.set(LintType.Amp, [
    LinkRelCanonicalIsOk,
    AmpVideoIsSmall,
    AmpVideoIsSpecifiedByAttribute,
    MetaCharsetIsFirst,
    RuntimeIsPreloaded,
    AmpImgHeightWidthIsOk,
    AmpImgAmpPixelPreferred,
    EndpointsAreAccessibleFromOrigin,
    EndpointsAreAccessibleFromCache
  ]);
  tests.set(
    LintType.AmpStory,
    (tests.get(LintType.Amp) || []).concat([
      BookendExists,
      SchemaMetadataIsNews,
      StoryRuntimeIsV1,
      StoryMetadataIsV1,
      StoryIsMostlyText,
      StoryMetadataThumbnailsAreOk
    ])
  );
  switch (type) {
    case "sxg":
      return tests.get(LintType.Sxg) || [];
    case "amp":
      return tests.get(LintType.Amp) || [];
    case "ampstory":
      return tests.get(LintType.AmpStory) || [];
    case "auto":
    default:
      return tests.get(ampType($)) || [];
  }
}

export async function lint(
  tcs: Array<RuleConstructor>,
  context: Context
): Promise<{ [key: string]: Result | Result[] }> {
  const res = await Promise.all(
    tcs.map(async tc => {
      const t = new tc();
      try {
        const r = await t.run(context);
        return [t.constructor.name, r];
      } catch (e) {
        return [
          t.constructor.name,
          {
            status: Status.INTERNAL_ERROR,
            message: JSON.stringify(e)
          } as Result
        ];
      }
    })
  );
  return res.reduce(
    (
      a: { [key: string]: Result | Result[] },
      kv: [string, Result | Result[]]
    ) => {
      a[kv[0].toLowerCase()] = kv[1];
      return a;
    },
    {}
  );
}

export { ampType as getAmpType };

export { cli };
