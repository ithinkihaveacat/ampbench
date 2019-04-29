import { absoluteUrl } from "../url";
import { corsEndpoints } from "../helper";
import { Context, canXhrSameOrigin, notPass } from "../index";
import { Rule } from "../Rule";

export class EndpointsAreAccessibleFromOrigin extends Rule {
  async run(context: Context) {
    const e = corsEndpoints(context.$);
    return (await Promise.all(
      e.map(url =>
        canXhrSameOrigin.call(
          this,
          context,
          absoluteUrl(url, context.url) || ""
        )
      )
    )).filter(notPass);
  }
}
