#!/bin/bash
# ============================================================
# SIME — Setup do Hermes Agent
# ============================================================
# Uso:  ZONA=7 SIME_SECRET='...' bash setup.sh
#
# Cobre a instalação em Linux (VPS, Oracle Cloud ou o WSL de um PC Windows).
# Para rodar direto no Windows sem WSL, veja hermes/README.md — os passos são
# os mesmos, muda só a forma de manter o serviço de pé.
#
# O Hermes NÃO precisa de endereço público. Ele é sempre quem inicia a
# conexão: escreve os eventos que detecta nos grupos e consulta a fila de
# notificações do SIME a cada ciclo. Por isso não há porta a abrir no firewall
# — o passo de liberar a 3000 que existia aqui antes não é mais necessário.

set -e

ZONA="${ZONA:?Defina a zona. Ex.: ZONA=7 SIME_SECRET=... bash setup.sh}"
SIME_URL="${SIME_URL:-https://sime-cyan.vercel.app}"
# O MESMO valor precisa estar na Vercel como HERMES_SECRET_ZONA_<ZONA>.
SIME_SECRET="${SIME_SECRET:?Defina SIME_SECRET com o mesmo valor de HERMES_SECRET_ZONA_${ZONA} na Vercel}"
# Intervalo do loop que drena a fila de notificações. 30s é folgado para um
# pânico que escala em 10 min; diminuir só aumenta chamadas sem ganho real.
INTERVALO="${INTERVALO:-30}"

echo "🚀 Instalando Hermes Agent para o SIME — ${ZONA}ª Zona"

# 1. Instalar Hermes
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
source ~/.bashrc

# 2. Configurar o agente
hermes setup --non-interactive \
  --name "SIME-${ZONA}Zona" \
  --model "openrouter/anthropic/claude-sonnet-4-6"

# 3. Variáveis de ambiente do SIME
cat >> ~/.hermes/config.env << ENV
SIME_VERCEL_URL=${SIME_URL}
SIME_ZONA=${ZONA}
HERMES_SECRET_ZONA_${ZONA}=${SIME_SECRET}
SIME_POLL_INTERVALO=${INTERVALO}
ENV

# 4. Instalar as skills do SIME
mkdir -p ~/.hermes/skills/sime
cp SIME_hermes_skill_monitor.md   ~/.hermes/skills/sime/
cp SIME_hermes_skill_notificar.md ~/.hermes/skills/sime/
cp SIME_hermes_skill_updater.md   ~/.hermes/skills/sime/
cp SIME_hermes_skill_mesarios.md  ~/.hermes/skills/sime/

# 5. Gateway WhatsApp
# groups-and-dm: o sime_mesarios conversa por DM com cada mesário para
# registrar a confirmação de permanência — só grupos deixaria esse fluxo fora.
hermes gateway config \
  --platform whatsapp \
  --mode groups-and-dm

# 6. Grupos monitorados — ajuste aos nomes reais dos grupos da sua zona
hermes config set sime.grupos "Mesários ${ZONA}ª Zona,Motoristas ${ZONA}ª Zona"

# 7. Endpoints do SIME (os três usam o mesmo Bearer)
hermes config set sime.endpoint_update       "${SIME_URL}/api/hermes-update"
hermes config set sime.endpoint_mesarios     "${SIME_URL}/api/hermes-mesarios"
hermes config set sime.endpoint_notificacoes "${SIME_URL}/api/hermes-notificacoes"
hermes config set sime.secret                "${SIME_SECRET}"
hermes config set sime.poll_intervalo        "${INTERVALO}"

# 8. Serviço systemd (roda 24/7)
sudo tee /etc/systemd/system/hermes-sime.service << SERVICE
[Unit]
Description=Hermes Agent SIME — ${ZONA}a Zona
After=network.target

[Service]
Type=simple
User=${USER}
WorkingDirectory=${HOME}
ExecStart=${HOME}/.hermes/bin/hermes gateway start
Restart=always
RestartSec=10
EnvironmentFile=${HOME}/.hermes/config.env

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable hermes-sime
sudo systemctl start hermes-sime

echo ""
echo "✅ Hermes configurado para a ${ZONA}ª Zona"
echo "   Nenhuma porta precisa ser aberta: o Hermes só faz conexões de saída."
echo ""
echo "Próximos passos:"
echo "1. Parear o WhatsApp:    hermes gateway qr"
echo "2. Conferir o serviço:   systemctl status hermes-sime"
echo "3. Acompanhar os logs:   journalctl -u hermes-sime -f"
echo "4. Testar a leitura:     hermes run \"sime_monitor: seção 63 encerrada\""
echo "5. Testar a fila:"
echo "   curl -sS -X POST ${SIME_URL}/api/hermes-notificacoes \\"
echo "     -H \"Authorization: Bearer \${HERMES_SECRET_ZONA_${ZONA}}\" \\"
echo "     -H 'Content-Type: application/json' -d '{\"acao\":\"pendentes\"}'"
