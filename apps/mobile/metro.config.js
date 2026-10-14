// Metro in a pnpm monorepo (hoisted node_modules). The contract packages (@thumbcade/protocol,
// swipe-contract, design-tokens) are consumed as TypeScript source from ../../packages.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.unstable_enablePackageExports = true;
// Never bundle other workspaces' build output or native folders.
config.resolver.blockList = [
  /\/apps\/portal\/.*/,
  /\/apps\/simulator\/.*/,
  /\/games\/.*\/node_modules\/.*/,
  /\/\.next\/.*/,
  /\/dist-export\/.*/,
];

// One copy of React / React Native no matter which workspace a file lives in.
const singletons = ["react", "react-native", "react/jsx-runtime", "react/jsx-dev-runtime"];
const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (singletons.includes(moduleName)) {
    return {
      type: "sourceFile",
      filePath: require.resolve(moduleName, { paths: [projectRoot] }),
    };
  }
  return (defaultResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
