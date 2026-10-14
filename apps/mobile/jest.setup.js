/* eslint-disable no-undef */
require("react-native-gesture-handler/jestSetup");
require("react-native-reanimated").setUpTests();

jest.mock("react-native-webview", () => {
  const React = require("react");
  const { View } = require("react-native");
  const WebView = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ injectJavaScript: () => undefined, reload: () => undefined }));
    return React.createElement(View, { testID: "webview", accessibilityLabel: props.accessibilityLabel });
  });
  return { __esModule: true, default: WebView, WebView };
});

jest.mock("expo-sqlite/kv-store", () => {
  const mem = new Map();
  const api = {
    getItemSync: (k) => (mem.has(k) ? mem.get(k) : null),
    setItemSync: (k, v) => mem.set(k, v),
    removeItemSync: (k) => mem.delete(k),
    getItem: async (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: async (k, v) => void mem.set(k, v),
    removeItem: async (k) => void mem.delete(k),
  };
  return { __esModule: true, default: api };
});

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy", Soft: "soft", Rigid: "rigid" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

process.env.EXPO_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

jest.mock("expo-media-library", () => ({ requestPermissionsAsync: jest.fn(async () => ({ granted: true })), saveToLibraryAsync: jest.fn() }));
jest.mock("react-native-view-shot", () => ({ captureRef: jest.fn(async () => "file:///tmp/card.png") }));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }));
jest.mock("expo-auth-session/providers/google", () => ({ useIdTokenAuthRequest: () => [null, null, jest.fn()] }));
jest.mock("expo-apple-authentication", () => ({
  signInAsync: jest.fn(),
  AppleAuthenticationButton: () => null,
  AppleAuthenticationButtonType: { CONTINUE: 1 },
  AppleAuthenticationButtonStyle: { WHITE: 0 },
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));
