// Note: this should only be used for local testing; the package binary is
// constructed by @pika/plugin-simple-bin; see
// https://github.com/pikapkg/builders/tree/master/packages/plugin-simple-bin.

import { cli } from ".";

cli(process.argv).catch(function(error: any) {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
