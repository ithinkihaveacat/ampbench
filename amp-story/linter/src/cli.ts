const cli = require(".");

const run = cli.run || cli.cli || cli.default;
run(process.argv).catch(function(error: any) {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
