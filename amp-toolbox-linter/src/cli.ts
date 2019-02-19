import { cli } from ".";

cli(process.argv).catch(function(error: any) {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
