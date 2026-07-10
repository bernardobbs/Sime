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
  constructor(t) { this.t = t; this.f = {}; this._op = null; }
  select(c) { this._sel = c; return this; }
  eq(c, v) { this.f[c] = v; return this; }
  order() { return this; }
  limit() { return this; }
  update(p) { this._op = 'update'; this._payload = p; return this; }
  upsert(o, opt) {
    const S = DB();
    S.ops.push({ op: 'upsert', t: this.t, payload: o, onConflict: opt && opt.onConflict });
    if (this.t === 'sime_mesa_estado') S.mesa[o.secao_id] = { ...S.mesa[o.secao_id], ...o };
    if (this.t === 'sime_midias') S.midias[o.secao_id] = { ...S.midias[o.secao_id], ...o };
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
      return resolve({ error: null });
    }
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
    return { data: null, error: null };
  }
}
