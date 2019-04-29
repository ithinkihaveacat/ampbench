import { absoluteUrl } from "../url";
import { Context, canXhrCache } from "../index";
import { Rule } from "../Rule";

export class BookendAppearsOnCache extends Rule {
  run(context: Context) {
    const { $, url } = context;
    const s1 = $("amp-story amp-story-bookend").attr("src");
    const s2 = $("amp-story").attr("bookend-config-src");
    const bookendSrc = s1 || s2;
    if (!bookendSrc) {
      return this.warn("<amp-story-bookend> not found");
    }
    const bookendUrl = absoluteUrl(bookendSrc, url);
    return canXhrCache.call(this, context, bookendUrl!, "cdn.ampproject.org");
  }
}
