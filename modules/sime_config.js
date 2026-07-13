// modules/sime_config.js
// Configuração única do Supabase para TODOS os módulos do front.
// Ao apontar para outro projeto Supabase (fork/nova zona), troque só AQUI —
// em vez de editar os 15 arquivos HTML.
//
// Ambos os valores são PÚBLICOS por design (a anon key é feita para ir no
// cliente; quem protege os dados é a RLS). A chave `service_role` NUNCA entra
// aqui nem em qualquer arquivo de modules/ — ela só vive em variáveis de
// ambiente do servidor (Vercel), usada por api/hermes-update.js.
export const SIME_CONFIG = {
  supabaseUrl: 'https://unjhnlcmxbrlonppchux.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVuamhubGNteGJybG9ucHBjaHV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzNDM1MTEsImV4cCI6MjA5ODkxOTUxMX0.3o3UhHXrLkHYz4ffBev0zb62VwcnPNP-ggbuiJG4vBs',
};
