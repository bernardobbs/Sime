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
    //
    // A versão de release atual (153.0.20260727124451) exige minSdk 26 —
    // acima do Android 7.1 (API 25) do MXQ Pro 4K real. Isso não é um ajuste
    // de configuração: se o motor exige API 26+, o box físico não roda essa
    // versão, ponto. 143.0.20251003115653 é a última release ainda compatível
    // com API 25. Ainda falta confirmar num build real (fora deste sandbox,
    // que não alcança maven.mozilla.org) que o Manifest Merger aceita
    // minSdk 21 sem reclamar — mas a existência da coordenada e a assinatura
    // de API (onLoadRequest, ver PainelActivity.kt) já foram verificadas
    // contra o código-fonte do GeckoView.
    implementation("org.mozilla.geckoview:geckoview:143.0.20251003115653")
}
