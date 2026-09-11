# ProGuard / R8 — React Native + Expo (release minifyEnabled)
# Docs: https://developer.android.com/topic/performance/app-optimization/enable-app-optimization

-keepattributes SourceFile,LineNumberTable,Signature,*Annotation*,EnclosingMethod,InnerClasses
-renamesourcefileattribute SourceFile

# React Native / Hermes / JNI
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }
-keep class com.facebook.react.fabric.** { *; }
-keep class com.swmansion.reanimated.** { *; }
-keep class com.swmansion.gesturehandler.** { *; }
-keep class com.swmansion.rnscreens.** { *; }

# Expo modules
-keep class expo.modules.** { *; }
-keepclassmembers class * {
  @expo.modules.core.interfaces.ExpoProp <methods>;
}

# React Native libraries often need their native modules kept
-keep class com.reactnativecommunity.** { *; }
-keep class com.horcrux.svg.** { *; }

# Google / FCM / Notifications
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# OkHttp / networking used by RN
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }

# Avoid stripping interfaces used via reflection
-keepclassmembers class * {
  @com.facebook.react.uimanager.annotations.ReactProp <methods>;
  @com.facebook.react.uimanager.annotations.ReactPropGroup <methods>;
}

# Keep Application / MainActivity entry points
-keep public class * extends android.app.Application
-keep public class * extends android.app.Activity
-keep public class * extends com.facebook.react.ReactActivity
-keep public class * extends com.facebook.react.ReactActivityDelegate

# Common third-party warnings that are safe to ignore
-dontwarn javax.annotation.**
-dontwarn java.lang.invoke.**
