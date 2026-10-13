/**
 * Font files for React Native (expo-font). Metro-only: uses require() on font assets.
 *
 *   import { nativeFonts } from "@thumbcade/design-tokens/native-fonts";
 *   const [loaded] = useFonts(nativeFonts);
 *
 * Keys match `fontFamily.native` in tokens.ts.
 */
declare const require: (path: string) => number;

export const nativeFonts = {
  "MonaSansDisplayExpanded-Black": require("../fonts/native/MonaSansDisplayExpanded-Black.ttf"),
  "MonaSansDisplayExpanded-ExtraBold": require("../fonts/native/MonaSansDisplayExpanded-ExtraBold.ttf"),
  "MonaSansDisplayExpanded-Bold": require("../fonts/native/MonaSansDisplayExpanded-Bold.ttf"),
  "MonaSansExpanded-Bold": require("../fonts/native/MonaSansExpanded-Bold.ttf"),
  "MonaSansExpanded-SemiBold": require("../fonts/native/MonaSansExpanded-SemiBold.ttf"),
  "MonaSans-Regular": require("../fonts/native/MonaSans-Regular.ttf"),
  "MonaSans-Medium": require("../fonts/native/MonaSans-Medium.ttf"),
  "MonaSans-SemiBold": require("../fonts/native/MonaSans-SemiBold.ttf"),
  "MonaSans-Bold": require("../fonts/native/MonaSans-Bold.ttf"),
  "DepartureMono-Regular": require("../fonts/native/DepartureMono-Regular.otf"),
} as const;
