plugins {
    id("com.android.application") version "8.5.2" apply false
    // GeckoView 143 embute metadados de Kotlin 2.x — o compilador 1.9.x não
    // lê essas bibliotecas (erro de "metadata version"). AGP 8.5.2 já é
    // compatível com o plugin Kotlin 2.0.x, então não muda mais nada.
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
}
