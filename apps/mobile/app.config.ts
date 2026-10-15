import type { ExpoConfig } from "expo/config";

const brand = (file: string) => `../../packages/design-tokens/brand/${file}`;

const config: ExpoConfig = {
  name: "Thumbcade",
  slug: "thumbcade",
  scheme: "thumbcade",
  version: "1.0.0",
  orientation: "portrait",
  icon: brand("app-icon.png"),
  userInterfaceStyle: "dark",
  backgroundColor: "#000000",
  primaryColor: "#FF4A3D",
  ios: {
    bundleIdentifier: "com.thumbcade.app",
    supportsTablet: false,
    usesAppleSignIn: true,
    associatedDomains: ["applinks:thumbcade.com"],
    infoPlist: {
      NSPhotoLibraryAddUsageDescription: "Save share cards of your scores to your photo library.",
      NSPhotoLibraryUsageDescription: "Pick a photo for your profile picture.",
      NSCameraUsageDescription: "Scan a developer QR code to open a game you are building.",
      ITSAppUsesNonExemptEncryption: false,
    },
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyCollectedDataTypes: [
        {
          NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeProductInteraction",
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality", "NSPrivacyCollectedDataTypePurposeAnalytics"],
        },
        {
          NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeEmailAddress",
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
        },
        {
          NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeUserID",
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
        },
        {
          NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeOtherUserContent",
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
        },
      ],
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults",
          NSPrivacyAccessedAPITypeReasons: ["CA92.1"],
        },
      ],
    },
  },
  android: {
    package: "com.thumbcade.app",
    adaptiveIcon: {
      foregroundImage: brand("adaptive-foreground.png"),
      backgroundImage: brand("adaptive-background.png"),
      monochromeImage: brand("adaptive-monochrome.png"),
      backgroundColor: "#000000",
    },
    predictiveBackGestureEnabled: false,
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          { scheme: "https", host: "thumbcade.com", pathPrefix: "/g/" },
          { scheme: "https", host: "thumbcade.com", pathPrefix: "/c/" },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  plugins: [
    "expo-router",
    [
      "expo-splash-screen",
      { image: brand("splash-icon.png"), backgroundColor: "#000000", imageWidth: 180 },
    ],
    "expo-font",
    "expo-sqlite",
    "expo-apple-authentication",
    "expo-web-browser",
    ["expo-notifications", { color: "#FF4A3D" }],
    [
      "expo-media-library",
      { savePhotosPermission: "Save share cards of your scores to your photo library.", isAccessMediaLocationEnabled: false },
    ],
    ["expo-image-picker", { photosPermission: "Pick a photo for your profile picture." }],
    ["expo-camera", { cameraPermission: "Scan a developer QR code to open a game you are building." }],
  ],
  experiments: { typedRoutes: true },
};

export default config;
