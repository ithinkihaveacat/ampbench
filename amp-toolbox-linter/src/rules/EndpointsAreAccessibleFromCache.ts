import { caches } from "../caches";
import { absoluteUrl } from "../url";
import { corsEndpoints } from "../helper";
import { Context, canXhrCache, notPass } from "../index";
import { Rule } from "../rule";

export class EndpointsAreAccessibleFromCache extends Rule {
  async run(context: Context) {
    // Cartesian product from https://stackoverflow.com/a/43053803/11543
    const cartesian = (a: any, b: any) =>
      [].concat(...a.map((d: any) => b.map((e: any) => [].concat(d, e))));
    const e = corsEndpoints(context.$);
    const product = cartesian(e, (await caches()).map(c => c.cacheDomain));
    return (await Promise.all(
      product.map(([xhrUrl, cacheSuffix]) =>
        canXhrCache.call(
          this,
          context,
          absoluteUrl(xhrUrl, context.url) || "",
          cacheSuffix
        )
      )
    )).filter(notPass);
  }
}
