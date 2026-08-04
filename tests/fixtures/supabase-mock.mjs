// Mock de @supabase/supabase-js controlável via globalThis.__SUPA, usado só pelo
// test_hermes.mjs: ele reescreve o import de api/hermes-update.js pra apontar
// pra cá, deixando o teste do handler determinístico e independente da versão
// real do supabase-js instalada (que ignora __SUPA). Builder thenable (executa
// no await). NÃO é usado em produção nem pelos demais testes.
const DB = () => globalThis.__SUPA;

export function createClient() {
  return {
    from(t) { return new QB(t); },
    rpc(name) { DB().ops.push({ op: 'rpc', name }); return Promise.resolve({ data: DB().now, error: null }); },
  };
}

class QB {
  constructor(t) { this.t = t; this.f = {}; this._in = {}; this._op = null; }
  select(c) { this._sel = c; return this; }
  eq(c, v) { this.f[c] = v; return this; }
  // .in(coluna, [valores]) — usado por api/hermes-notificacoes.js para filtrar
  // as notificações pelas seções da zona.
  in(c, vals) { this._in[c] = new Set(vals); return this; }
  order() { return this; }
  limit() { return this; }
  // Aplica os .eq e .in acumulados a uma lista de linhas.
  _filtra(rows) {
    return (rows || []).filter((r) =>
      Object.entries(this.f).every(([k, v]) => r[k] === v) &&
      Object.entries(this._in).every(([k, set]) => set.has(r[k])));
  }
  update(p) { this._op = 'update'; this._payload = p; return this; }
  upsert(o, opt) {
    const S = DB();
    S.ops.push({ op: 'upsert', t: this.t, payload: o, onConflict: opt && opt.onConflict });
    if (this.t === 'sime_mesa_estado') S.mesa[o.secao_id] = { ...S.mesa[o.secao_id], ...o };
    if (this.t === 'sime_midias') S.midias[o.secao_id] = { ...S.midias[o.secao_id], ...o };
    if (this.t === 'sime_componentes' || this.t === 'sime_heartbeat') {
      const key = this.t === 'sime_componentes' ? 'componentes' : 'heartbeats';
      S[key] = S[key] || [];
      const i = S[key].findIndex((r) => r.zona_id === o.zona_id && r.componente === o.componente);
      if (i > -1) S[key][i] = { ...S[key][i], ...o }; else S[key].push({ ...o });
    }
    return Promise.resolve({ error: null });
  }
  insert(o) {
    const S = DB();
    S.ops.push({ op: 'insert', t: this.t, payload: o });
    if (this.t === 'sime_logs') S.logs.push(o);
    return Promise.resolve({ error: null });
  }
  single() { return Promise.resolve(this._read()); }
  maybeSingle() { return Promise.resolve(this._read()); }
  then(resolve) {
    const S = DB();
    if (this._op === 'update') {
      S.ops.push({ op: 'update', t: this.t, payload: this._payload, filter: this.f });
      if (this.t === 'sime_mesa_estado') { const id = this.f.secao_id; S.mesa[id] = { ...S.mesa[id], ...this._payload }; }
      if (this.t === 'sime_atores') {
        const i = (S.atores || []).findIndex(a => a.id === this.f.id);
        if (i > -1) S.atores[i] = { ...S.atores[i], ...this._payload };
      }
      if (this.t === 'sime_notificacoes') {
        for (const n of S.notificacoes || []) {
          if (this._filtra([n]).length) Object.assign(n, this._payload);
        }
      }
      if (this.t === 'sime_campanhas_confirmacao') {
        for (const c of S.campanhas || []) {
          if (this._filtra([c]).length) Object.assign(c, this._payload);
        }
      }
      return resolve({ error: null });
    }
    // Consultas de lista (não-single), filtradas pelos .eq/.in acumulados.
    if (this.t === 'sime_atores')       return resolve({ data: this._filtra(S.atores), error: null });
    if (this.t === 'sime_notificacoes') return resolve({ data: this._filtra(S.notificacoes), error: null });
    if (this.t === 'sime_secoes')       return resolve({ data: this._filtra(S.secoes), error: null });
    if (this.t === 'sime_campanhas_confirmacao') return resolve({ data: this._filtra(S.campanhas), error: null });
    return resolve({ data: null, error: null });
  }
  _read() {
    const S = DB();
    if (this.t === 'sime_zonas') { const r = (S.zonas || []).find(z => z.numero === this.f.numero) || null; return { data: r, error: null }; }
    if (this.t === 'sime_secoes') {
      const r = S.secoes.find(s => s.numero === this.f.numero && (this.f.zona_id === undefined || s.zona_id === this.f.zona_id)) || null;
      return { data: r, error: r ? null : { message: 'nf' } };
    }
    if (this.t === 'sime_mesa_estado') { return { data: S.mesa[this.f.secao_id] || null, error: null }; }
    if (this.t === 'sime_eleicoes') {
      const r = (S.eleicoes || []).find(e => e.zona_id === this.f.zona_id && e.ativa === true) || null;
      return { data: r, error: null };
    }
    if (this.t === 'sime_componentes') {
      const r = (S.componentes || []).find(c => c.zona_id === this.f.zona_id && c.componente === this.f.componente) || null;
      return { data: r, error: null };
    }
    return { data: null, error: null };
  }
}
