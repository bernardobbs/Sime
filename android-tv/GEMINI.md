# SIME TV — contexto para o Gemini (Android Studio)

Cole este arquivo inteiro no chat do Gemini (painel lateral do Android Studio)
antes de pedir ajuda com o build. Ele explica o projeto, as decisões que não
devem ser desfeitas, e o que exatamente precisa de ajuda agora.

## O que é este app

App Android nativo (Kotlin) para TV Box (ex.: MXQ Pro 4K, Android 7.1) que
exibe em tela cheia os painéis web do SIME — sistema de observabilidade
eleitoral. Não é o SIME em si: é uma casca que carrega `https://sime-cyan.vercel.app`
dentro de um motor de navegador embarcado. Projeto completo e decisões em
[`docs/APP_TV_BOX.md`](../docs/APP_TV_BOX.md) (na raiz do repositório `Sime`).

## Por que GeckoView, não WebView

O WebView de fábrica do Android 7.1 é antigo demais para os painéis (que usam
CSS/JS modernos). O app embarca o próprio motor (Mozilla GeckoView) em vez de
depender do WebView do sistema. **Não sugerir trocar para WebView** — essa
troca já foi avaliada e descartada (ver `docs/APP_TV_BOX.md` §9).

## Estrutura

```
android-tv/
├── build.gradle.kts, settings.gradle.kts   — raiz
├── app/build.gradle.kts                    — compileSdk 34, minSdk 21,
│                                              ABI filters armeabi-v7a + arm64-v8a
│                                              (o box é arm; sem o filtro o
│                                              GeckoView traz x86 à toa)
└── app/src/main/java/br/jus/sime/tv/
    ├── Config.kt              — config cifrada (EncryptedSharedPreferences,
    │                            com fallback para prefs comuns se o Keystore
    │                            do aparelho estiver quebrado)
    ├── ConfiguracaoActivity.kt — tela de primeira configuração
    ├── PainelActivity.kt       — tela principal: GeckoView em tela cheia,
    │                            vigia (recarrega se travar), anti burn-in,
    │                            reconexão com backoff
    └── BootReceiver.kt        — sobe o painel sozinho após queda de energia
```

## Estado atual

Código-fonte completo, nunca compilado (foi escrito num sandbox sem acesso a
`dl.google.com`/`maven.mozilla.org`). O wrapper do Gradle já está commitado
(`android-tv/gradlew`) — não precisa instalar Gradle à parte.

## O que preciso agora

1. Rodar o **Gradle sync** no Android Studio e resolver qualquer erro de
   dependência ou de SDK ausente (aceitar as licenças que o Studio pedir).
2. Confirmar que o build compila: `Build → Make Project` (ou o equivalente a
   `./gradlew assembleRelease`).
3. Gerar um **APK assinado**: `Build → Generate Signed Bundle / APK → APK`,
   criando um keystore novo nesse passo.
4. Se o sync falhar, me ajudar a ler o erro exato (linha, plugin ou
   dependência envolvida) antes de sugerir qualquer mudança no
   `build.gradle.kts`.

## O que NÃO mudar sem perguntar

- `minSdk = 21` e os `abiFilters` — são para o hardware real do box, não
  acidente de configuração.
- O único `GeckoRuntime` por processo (já é singleton em
  `PainelActivity.kt` — criar um segundo derruba o app).
- Não adicionar dependências novas, refatorar Kotlin ou "modernizar" código só
  porque apareceu no caminho — o objetivo agora é só compilar e assinar.

## Sobre a versão do GeckoView

Se o sync falhar com 404 na coordenada `org.mozilla.geckoview:geckoview:<versão>`,
**não troque para o artefato `geckoview-nightly`** — é o canal instável da
Mozilla, e este app fica ligado sozinho o dia inteiro em campo, sem ninguém
para reverter uma build que quebrar. A causa real costuma ser só a versão
estar desatualizada (o GeckoView é lançado a cada poucas semanas). Para achar
a versão de release atual: `https://maven.mozilla.org/maven2/org/mozilla/geckoview/geckoview/maven-metadata.xml`
— o campo `<release>` traz a versão certa para usar.
