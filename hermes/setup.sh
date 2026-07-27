#!/bin/bash
# ============================================================
# SIME — Setup do Hermes Agent no Oracle Cloud Free Tier
# Executar como ubuntu@SEU_ORACLE_IP
# ============================================================

set -e
echo "🚀 Instalando Hermes Agent para o SIME..."

# 1. Instalar Hermes
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
source ~/.bashrc

# 2. Configurar o agente
hermes setup --non-interactive \
  --name "SIME-7Zona" \
  --model "openrouter/anthropic/claude-sonnet-4-6"

# 3. Configurar variaveis de ambiente do SIME
cat >> ~/.hermes/config.env << 'ENV'
SIME_SUPABASE_URL=https://SEU_PROJETO.supabase.co
SIME_VERCEL_URL=https://sime-7zona.vercel.app
HERMES_WEBHOOK_SECRET=GERE_UMA_SENHA_FORTE_AQUI
ENV

# 4. Instalar as skills do SIME
mkdir -p ~/.hermes/skills/sime
cp sime_monitor.md   ~/.hermes/skills/sime/
cp sime_notificar.md ~/.hermes/skills/sime/
cp sime_updater.md   ~/.hermes/skills/sime/

# 5. Configurar gateway WhatsApp
hermes gateway config \
  --platform whatsapp \
  --mode groups-only

# 6. Configurar grupos monitorados
hermes config set sime.grupos "Mesários Campo Maior,Mesários Jatobá do Piauí,Mesários Sigefredo Pacheco,Motoristas 7ª Zona"

# 7. Configurar URL do Vercel para callbacks
hermes config set sime.vercel_endpoint "${SIME_VERCEL_URL}/api/hermes-update"
hermes config set sime.webhook_secret "${HERMES_WEBHOOK_SECRET}"

# 8. Configurar como servico systemd (roda 24/7)
sudo tee /etc/systemd/system/hermes-sime.service << SERVICE
[Unit]
Description=Hermes Agent SIME Monitor
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu
ExecStart=/home/ubuntu/.hermes/bin/hermes gateway start
Restart=always
RestartSec=10
EnvironmentFile=/home/ubuntu/.hermes/config.env

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable hermes-sime
sudo systemctl start hermes-sime

# 9. Abrir porta do gateway no firewall Oracle
# (Executar no painel Oracle Cloud: Networking > Security Lists)
# Ingress Rule: TCP, porta 3000, source 0.0.0.0/0

echo ""
echo "✅ Hermes configurado!"
echo ""
echo "Proximos passos:"
echo "1. Escanear QR Code do WhatsApp:"
echo "   hermes gateway qr"
echo ""
echo "2. Verificar status:"
echo "   systemctl status hermes-sime"
echo ""
echo "3. Ver logs em tempo real:"
echo "   journalctl -u hermes-sime -f"
echo ""
echo "4. Testar skill manualmente:"
echo '   hermes run "sime_monitor: seção 63 encerrada"'
