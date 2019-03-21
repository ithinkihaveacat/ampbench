module.exports = function(config) {
  config.set({
    mutator: "typescript",
    packageManager: "npm",
    reporters: ["clear-text", "progress", "html"],
    testRunner: "command",
    transpilers: ["typescript"],
    coverageAnalysis: "all",
    tsconfigFile: "tsconfig.json",
    mutate: ["src/index.ts"]
  });
};
