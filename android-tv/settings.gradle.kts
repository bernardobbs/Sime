pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // GeckoView — o motor de renderização embarcado. É a razão de o app
        // existir: o WebView de fábrica do MXQ Pro 4K (Android 7.1, sem Play
        // Store) não roda os painéis. Ver docs/APP_TV_BOX.md §2.
        maven("https://maven.mozilla.org/maven2")
    }
}

rootProject.name = "SIME TV"
include(":app")
