import { Context, Result, notPass } from "../index";
import { Rule } from "../rule";

export class AmpImgAmpPixelPreferred extends Rule {
  async run(context: Context) {
    const $ = context.$;
    return (await Promise.all($("amp-img[width=1][height=1]")
      .map((_, e) => {
        const layout = $(e).attr("layout");
        if (layout === "responsive") {
          // see comment at AmpImgHeightWidthIsOk
          return this.pass();
        }
        const s = $(e).toString();
        return this.warn(
          `[${s}] has width=1, height=1; <amp-pixel> may be a better choice`
        );
      })
      .get() as Array<Promise<Result>>)).filter(notPass);
  }
}
