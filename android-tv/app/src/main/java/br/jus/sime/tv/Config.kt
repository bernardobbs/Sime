package br.jus.sime.tv

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Os quatro painéis do SIME.
 *
 * "Expedição" é o nome operacional do painel de Distribuição — o embarque das
 * urnas nas rotas. O arquivo no servidor continua sendo SIME_tv_distribuicao.
 */
enum class Painel(
    val id: String,
    val arquivo: String,
    val titulo: String,
    val descricao: String,
    val icone: String,
) {
    PREPARACAO("preparacao", "SIME_tv_preparacao.html", "PREPARAÇÃO", "Carga e lacre das urnas (D-X)", "🏭"),
    EXPEDICAO("expedicao", "SIME_tv_distribuicao.html", "EXPEDIÇÃO", "Embarque de urnas nas rotas (D-1)", "🚚"),
    VESPERA("vespera", "SIME_tv_vespera.html", "VÉSPERA", "Instalação nas seções (D-1)", "🌙"),
    DIA("dia", "SIME_tv_dia.html", "DIA D", "Seções ao vivo", "🗳️");

    companion object {
        fun porId(id: String?): Painel? = entries.firstOrNull { it.id == id }
    }
}

/**
 * Configuração do box. Fica cifrada porque o token de TV, ainda que só de
 * leitura, dá acesso aos dados da zona e o aparelho fica num telão de
 * repartição pública.
 */
class Config(context: Context) {

    private val prefs: SharedPreferences = try {
        val chave = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context, ARQUIVO, chave,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    } catch (e: Exception) {
        // Keystore quebrado é comum em box barato com ROM alterada. Melhor cair
        // para preferências comuns do que o app não abrir no dia da eleição —
        // o token é de leitura e revogável pelo Admin.
        context.getSharedPreferences("${ARQUIVO}_claro", Context.MODE_PRIVATE)
    }

    var painel: Painel?
        get() = Painel.porId(prefs.getString("painel", null))
        set(v) = prefs.edit().putString("painel", v?.id).apply()

    var token: String?
        get() = prefs.getString("token", null)
        set(v) = prefs.edit().putString("token", v?.trim()?.uppercase()).apply()

    var zona: String
        get() = prefs.getString("zona", "7") ?: "7"
        set(v) = prefs.edit().putString("zona", v).apply()

    var servidor: String
        get() = prefs.getString("servidor", PADRAO_SERVIDOR) ?: PADRAO_SERVIDOR
        set(v) = prefs.edit().putString("servidor", v.trimEnd('/')).apply()

    val configurado: Boolean
        get() = painel != null && !token.isNullOrBlank()

    /**
     * URL final do painel.
     *
     * Usa a rota por zona (/z/7/...) que o vercel.json reescreve: assim o box
     * da 7ª nunca exibe a 94ª por engano de configuração, e o endereço deixa
     * isso visível para quem for conferir.
     *
     * O tv_token vai na URL uma única vez; o sime_tv_auth.js troca por um JWT
     * e guarda no localStorage do próprio motor.
     */
    fun url(): String {
        val p = painel ?: Painel.DIA
        return "$servidor/z/$zona/${p.arquivo}?tv_token=${token.orEmpty()}"
    }

    companion object {
        private const val ARQUIVO = "sime_tv_config"
        const val PADRAO_SERVIDOR = "https://sime-cyan.vercel.app"
    }
}
