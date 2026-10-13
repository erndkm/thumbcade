# Source this before running native tooling:  source scripts/env.sh
# Points tools at the locally installed Xcode / Android SDK / JDK without changing system settings.
export DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"
export ANDROID_HOME="/opt/homebrew/share/android-commandlinetools"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
# Android emulator AVD created during setup:
export THUMBCADE_AVD="thumbcade_pixel"
