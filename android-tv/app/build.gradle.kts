plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "br.jus.sime.tv"
    compileSdk = 34

    defaultConfig {
        applicationId = "br.jus.sime.tv"
        // 21 cobre o MXQ Pro 4K (Android 7.1 = API 25) com folga.
        minSdk = 21
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"

        // O box é armv7/arm64. Sem esse filtro o APK carrega x86 à toa e passa
        // de 200 MB — o GeckoView traz uma cópia do motor por arquitetura.
        ndk { abiFilters += listOf("armeabi-v7a", "arm64-v8a") }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { viewBinding = true }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    // Token guardado cifrado: o box fica num telão de repartição pública.
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // GeckoView: motor próprio, independente do System WebView do box.
    // Ver docs/APP_TV_BOX.md §2 — é a decisão central do projeto.
    implementation("org.mozilla.geckoview:geckoview:127.0.20240613141014")
}
