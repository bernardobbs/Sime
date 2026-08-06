#!/usr/bin/env python3
# Parseia os relatórios ELO do TRE (formato "markdown de largura fixa" — cabeçalho
# + linha de traços que define os limites de cada coluna + linhas de dados) e
# gera SQL de INSERT pronto para sime_mesarios_raw. Roda inteiramente em disco:
# os dados nunca passam pelo contexto do assistente, só as estatísticas agregadas
# impressas no final (contagem por tipo_registro) — evita qualquer risco de erro
# de transcrição em CPF/telefone ao relayar isso por chat.
#
# Uso (recarga de qualquer zona, a qualquer momento):
#   1. python3 scripts/parse_mesarios.py saida.sql mesariosmrv.md mesariosal.md
#   2. No SQL Editor: TRUNCATE sime_mesarios_raw; depois colar e rodar saida.sql
#   3. select * from sime_sync_atores_from_raw(<numero_zona>, 'PI');
#      (UPSERT idempotente — não recria UUIDs, não perde confirmacao/whatsapp_*)

import sys
import re

# Ordem exata das colunas em sime_mesarios_raw (produção, confirmada via
# information_schema.columns), posições 3..83 — id/tipo_registro/importado_em/
# ator_id ficam de fora (auto ou derivados).
DB_COLUMNS = [
    "processo_eleitoral", "pleito", "uf_trabalho", "zona_eleitoral_trabalho",
    "inscricao", "cpf_eleitor", "cpf_dados_mesario", "nome_civil", "nome_social",
    "data_nascimento", "tipo_telefone_1_eleitor", "telefone_1_eleitor",
    "tipo_telefone_2_eleitor", "telefone_2_eleitor", "telefone_contato_eleitor",
    "tipo_telefone_pessoal_mesario", "telefone_pessoal_mesario",
    "tipo_telefone_comercial_mesario", "telefone_comercial_mesario",
    "email_eleitor", "email_dados_mesario", "tipo_correspondencia",
    "grau_instrucao_eleitor", "grau_instrucao_mesario", "ocupacao_eleitor",
    "ocupacao_mesario", "excluido_eleicao_futura",
    "data_limite_exclusao_eleicao_futura", "observacao_dados_mesario",
    "possui_carro", "experiencia", "ase_205", "uf_endereco_eleitor",
    "codigo_municipio_endereco_eleitor", "nome_municipio_endereco_eleitor",
    "endereco_eleitor", "bairro_eleitor", "cep_eleitor", "zona_eleitoral_eleitor",
    "uf_dados_mesario", "codigo_municipio_dados_mesario",
    "nome_municipio_dados_mesario", "endereco_dados_mesario",
    "bairro_dados_mesario", "cep_dados_mesario", "uf_comercial_mesario",
    "codigo_municipio_comercial_mesario", "nome_municipio_comercial_mesario",
    "endereco_comercial_mesario", "bairro_comercial_mesario",
    "cep_comercial_mesario", "nome_empresa", "funcao_empresa",
    "codigo_municipio_local_trabalho", "nome_municipio_local_trabalho",
    "bairro_local_trabalho", "cep_local_trabalho",
    "numero_local_votacao_local_trabalho", "nome_local_votacao_local_trabalho",
    "descricao_local_trabalho", "secao_local_trabalho", "mrj_local_trabalho",
    "uf_votacao_eleitor", "codigo_municipio_votacao_eleitor",
    "nome_municipio_votacao_eleitor", "bairro_votacao_eleitor",
    "cep_votacao_eleitor", "numero_local_votacao_eleitor",
    "nome_local_votacao_eleitor", "numero_secao_votacao_eleitor",
    "tipo_funcao_eleitoral", "descricao_funcao_eleitoral", "data_atribuicao",
    "data_convocacao", "data_nomeacao", "data_atualizacao_mesario",
    "data_ultimo_rae", "confirmou_convocacao", "origem_resposta",
    "data_resposta", "justificativa",
]
IDX_TIPO_FUNCAO = DB_COLUMNS.index("tipo_funcao_eleitoral")


def col_boundaries(ruler_line):
    """A partir da linha de traços, devolve [(start,end), ...] de cada coluna."""
    bounds = []
    for m in re.finditer(r'-+', ruler_line):
        bounds.append((m.start(), m.end()))
    return bounds


def parse_file(path):
    with open(path, encoding='utf-8') as f:
        lines = f.read().split('\n')
    header_line = lines[0]
    ruler_line = lines[1]
    bounds = col_boundaries(ruler_line)
    if len(bounds) != len(DB_COLUMNS):
        raise SystemExit(
            f"{path}: {len(bounds)} colunas no arquivo vs {len(DB_COLUMNS)} esperadas — "
            f"NÃO gerar SQL, o mapeamento posicional ficaria errado."
        )
    rows = []
    for line in lines[2:]:
        if not line.strip():
            continue
        # Linha mais curta que a régua (campos finais vazios) — completa com
        # espaços pra não perder colunas do fim.
        if len(line) < bounds[-1][1]:
            line = line + ' ' * (bounds[-1][1] - len(line))
        fields = [line[s:e].strip() for s, e in bounds]
        rows.append(fields)
    return rows


def sql_val(v):
    if v == '' or v is None:
        return 'NULL'
    return "'" + v.replace("'", "''") + "'"


def gen_insert_sql(all_rows, batch_size=100):
    cols = DB_COLUMNS + ["tipo_registro"]
    col_list = ', '.join('"' + c + '"' for c in cols)
    out = []
    for i in range(0, len(all_rows), batch_size):
        batch = all_rows[i:i + batch_size]
        out.append(f'-- Lote {i // batch_size + 1}/{(len(all_rows) + batch_size - 1) // batch_size} ({len(batch)} registros)')
        out.append(f'insert into public.sime_mesarios_raw ({col_list}) values')
        tuples = []
        for fields in batch:
            tipo_registro = fields[IDX_TIPO_FUNCAO]
            vals = [sql_val(v) for v in fields] + [sql_val(tipo_registro)]
            tuples.append('(' + ', '.join(vals) + ')')
        out.append(',\n'.join(tuples) + ';')
        out.append('')
    return '\n'.join(out)


def main():
    if len(sys.argv) < 3:
        print("uso: parse_mesarios.py <saida.sql> <arquivo1.md> [arquivo2.md ...]")
        sys.exit(1)
    out_path = sys.argv[1]
    in_paths = sys.argv[2:]

    all_rows = []
    stats_por_arquivo = []
    for p in in_paths:
        rows = parse_file(p)
        all_rows.extend(rows)
        tipos = {}
        for r in rows:
            t = r[IDX_TIPO_FUNCAO]
            tipos[t] = tipos.get(t, 0) + 1
        stats_por_arquivo.append((p, len(rows), tipos))

    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('-- ============================================================\n')
        f.write('-- Insercao em sime_mesarios_raw — gerado por script (parse_mesarios.py)\n')
        f.write(f'-- Total de registros: {len(all_rows)}\n')
        f.write('-- ============================================================\n\n')
        f.write('begin;\n\n')
        f.write(gen_insert_sql(all_rows))
        f.write('\ncommit;\n')

    print(f"Arquivo gerado: {out_path}")
    print(f"Total de linhas de dados: {len(all_rows)}\n")
    for p, n, tipos in stats_por_arquivo:
        print(f"{p}: {n} registros — {tipos}")


if __name__ == '__main__':
    main()
