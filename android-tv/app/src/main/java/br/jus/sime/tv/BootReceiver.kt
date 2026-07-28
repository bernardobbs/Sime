package br.jus.sime.tv

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Sobe o painel sozinho depois de um boot.
 *
 * É o que separa "o telão voltou" de "alguém precisa achar o controle remoto":
 * queda de energia no cartório às 5h da manhã do dia D não pode virar uma
 * tarefa manual.
 *
 * Só age se o box já estiver configurado — senão abriria a tela de
 * configuração sozinho, sem ninguém por perto.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val acao = intent.action ?: return
        if (acao != Intent.ACTION_BOOT_COMPLETED && acao != "android.intent.action.QUICKBOOT_POWERON") return
        if (!Config(context).configurado) return

        context.startActivity(
            Intent(context, PainelActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }
}
