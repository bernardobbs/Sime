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

**Cuidado ao pular pra versão mais nova: o requisito mínimo de Android do
GeckoView sobe com o tempo.** A versão de release mais recente pode exigir
uma API do Android maior que 25 (Android 7.1) — que é o que o MXQ Pro 4K real
roda. Isso não é um ajuste de `minSdk` no `build.gradle.kts`: se o motor em si
exige API 26+, o box físico simplesmente não roda essa versão, não importa o
que o Gradle declare. Se o Manifest Merger reclamar de `minSdk` depois de
trocar a versão, a saída é achar a versão de release **anterior** mais recente
que ainda aceite API 25 — testando o build, não assumindo. Cada nova versão
do GeckoView pode ter subido esse piso de novo.

## Kotlin 2.0.21 (necessário para o GeckoView 143+)

O `.aar` do GeckoView 143 embute metadados de biblioteca Kotlin 2.x. O plugin
`org.jetbrains.kotlin.android` do projeto já está em `2.0.21` (raiz
`build.gradle.kts`) por causa disso — é compatível com o AGP 8.5.2, não
precisa mexer em mais nada. Se o sync reclamar de "metadata version
X.Y.Z, expected version Z.Y.X" ao ler uma classe do GeckoView, é sinal de
que o plugin Kotlin caiu de novo para 1.9.x (verificar `build.gradle.kts` da
raiz) ou de cache de Gradle desatualizado (`./gradlew --stop` e tentar de
novo costuma resolver).

## `onLoadRequest` mudou de assinatura

Em versões antigas do GeckoView, `NavigationDelegate.onLoadRequest` podia
retornar `GeckoResult<Boolean>`. Na 143 (e em toda a linha atual) o retorno é
`GeckoResult<AllowOrDeny>` — `AllowOrDeny` é um enum (`ALLOW`/`DENY`) de
`org.mozilla.geckoview.AllowOrDeny`. Já corrigido em `PainelActivity.kt`; se
aparecer o mesmo erro de tipo em outro lugar, é o mesmo motivo.
