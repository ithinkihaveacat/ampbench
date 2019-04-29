import { Context } from "../index";
import { Rule } from "../Rule";

export class RuntimeIsPreloaded extends Rule {
  run({ $ }: Context) {
    const attr = [
      "href='https://cdn.ampproject.org/v0.js'",
      "rel='preload'",
      "as='script'"
    ]
      .map(s => `[${s}]`)
      .join("");
    const isPreloaded = $(`link${attr}`).length > 0;
    return isPreloaded
      ? this.pass()
      : this.warn(
          "<link href=https://cdn.ampproject.org/v0.js rel=preload> is missing"
        );
  }
}
