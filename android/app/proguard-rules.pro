# SQLCipher's JNI bridge loads classes by name. Preserve its public API.
-keep,includedescriptorclasses class net.zetetic.** { *; }
-keep,includedescriptorclasses interface net.zetetic.** { *; }

# Capacitor discovers the local plugin by annotation/reflection.
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
