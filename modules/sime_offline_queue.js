// modules/sime_offline_queue.js
// Fila offline compartilhada (IndexedDB) — extraída de SIME_midias.html (única
// tela que já tinha essa lógica) pra reaproveitar nos demais módulos de campo.
// Mesmo padrão: um item por ação pendente, retry a cada 30s, até 5 tentativas
// antes de marcar como 'erro' e parar de tentar sozinho.

const DB_NAME = 'sime_offline';
const DB_VER = 1;
let dbInstance = null;

function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('queue')) {
        const s = db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
        s.createIndex('status', 'status');
      }
    };
    req.onsuccess = () => { dbInstance = req.result; resolve(dbInstance); };
    req.onerror = () => reject(req.error);
  });
}

async function getDB() {
  return dbInstance || (dbInstance = await initDB());
}

// Enfileira uma ação que falhou por falta de rede/servidor. `dados` deve
// conter tudo que a ação precisa reconstruir depois — inclusive não deve
// incluir timestamp de cliente: quem grava o timestamp de verdade é a função
// de sincronização (via sime_now()), no momento em que o replay tiver sucesso.
export async function enqueue(acao, dados) {
  const db = await getDB();
  return new Promise((resolve) => {
    const tx = db.transaction('queue', 'readwrite');
    tx.objectStore('queue').add({ acao, dados, status: 'pendente', ts: Date.now(), tentativas: 0 });
    tx.oncomplete = () => resolve();
  });
}

export async function countPending() {
  const db = await getDB();
  return new Promise((resolve) => {
    const req = db.transaction('queue', 'readonly').objectStore('queue').index('status').getAll('pendente');
    req.onsuccess = () => resolve(req.result.length);
    req.onerror = () => resolve(0);
  });
}

// `syncFn(acao, dados)` deve rejeitar se a sincronização falhar (rede/servidor
// indisponível) — cada item pendente é tentado de novo; sucesso remove da
// fila, falha incrementa `tentativas` (marca 'erro' e para de tentar sozinho
// depois de 5). Retorna a contagem de itens que continuam pendentes.
export async function processQueue(syncFn) {
  const db = await getDB();
  return new Promise((resolve) => {
    const tx = db.transaction('queue', 'readwrite');
    const store = tx.objectStore('queue');
    const req = store.index('status').getAll('pendente');
    req.onsuccess = async () => {
      const items = req.result;
      let synced = 0;
      for (const item of items) {
        try {
          await syncFn(item.acao, item.dados);
          store.delete(item.id);
          synced++;
        } catch (e) {
          item.tentativas = (item.tentativas || 0) + 1;
          item.status = item.tentativas >= 5 ? 'erro' : 'pendente';
          store.put(item);
        }
      }
      resolve(items.length - synced);
    };
    req.onerror = () => resolve(0);
  });
}

// Dispara um retry imediato e depois a cada `intervaloMs` (30s por padrão,
// conforme a filosofia offline-first do CLAUDE.md). Retorna o id do
// setInterval, pra quem chamar poder limpar se precisar.
export function iniciarRetryPeriodico(syncFn, onUpdate, intervaloMs = 30000) {
  const tick = () => processQueue(syncFn).then((pendentes) => { if (onUpdate) onUpdate(pendentes); });
  tick();
  return setInterval(tick, intervaloMs);
}
