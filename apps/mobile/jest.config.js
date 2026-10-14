/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  setupFiles: ["./jest.setup.js"],
  testMatch: ["<rootDir>/test/**/*.test.ts?(x)"],
  resolver: require.resolve("react-native-worklets/jest/resolver.js"),
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|expo-.*|react-navigation|@react-navigation/.*|react-native-svg|react-native-reanimated|react-native-worklets|react-native-gesture-handler|react-native-webview|@shopify/.*|@tanstack/.*|zustand|@supabase/.*|@thumbcade/.*|standard-navigation))",
  ],
};
