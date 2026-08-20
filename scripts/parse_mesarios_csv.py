#!/usr/bin/env python3
# Parseia o export CSV "MRV simples" do TRE (Zona, Seção, Nome, Inscrição,
# Situação, Localidade, Nº Local, Nome Local, Cód. Objeto Local, Nº Função
# Eleitoral, Função Eleitoral, Data Atualização, Ciente, whatsapp, celular,
# telefone2) e gera SQL de INSERT pronto para sime_mesarios_raw — mesmo
# destino de scripts/parse_mesarios.py, mas pra este formato mais novo/mais
# simples (sem os ~80 campos do dump ELO fixed-width; só o essencial de
# mesário mesmo). Todo esse arquivo é só MRV (Presidente/1º Mesário/2º
# Mesário/1º Secretário) — não cobre AL (acessibilidade), que continua
# vindo do formato antigo quando precisar.
#
# Mesmo cuidado do parser antigo: roda inteiramente em disco, nome/CPF/
# telefone nunca aparecem no console — só a contagem agregada por função e
# por município no final.
#
# Uso:
#   python3 scripts/parse_mesarios_csv.py saida.sql mesarios.csv <zona> <uf>
#   No SQL Editor do Supabase: TRUNCATE sime_mesarios_raw; colar e rodar saida.sql
#   select * from sime_sync_atores_from_raw(<zona>, '<uf>');

import sys
import csv
from collections import Counter

# Ordem exata das colunas em sime_mesarios_raw (mesma lista de parse_mesarios.py)
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


def sql_val(v):
    v = (v or '').strip()
    if not v:
        return 'NULL'
    return "'" + v.replace("'", "''") + "'"


def row_to_fields(row, uf):
    # Mapeia só o que sime_sync_atores_from_raw realmente lê (ver definição
    # da função): inscricao, nome_civil, telefone_pessoal_mesario (1ª opção
    # do COALESCE — por isso "whatsapp" vai aqui, não celular/telefone2, que
    # entram só como fallback), secao_local_trabalho, nome_municipio_local_trabalho,
    # descricao_funcao_eleitoral, zona_eleitoral_trabalho, uf_trabalho. O
    # resto fica NULL — este export não traz CPF/endereço/etc., e a função
    # de sync nunca olha pra essas colunas mesmo no dump ELO completo.
    f = {c: '' for c in DB_COLUMNS}
    f['uf_trabalho'] = uf
    f['zona_eleitoral_trabalho'] = row['Zona'].strip()
    f['inscricao'] = row['Inscrição'].strip()
    f['nome_civil'] = row['Nome'].strip()
    f['telefone_pessoal_mesario'] = row['whatsapp'].strip()
    f['telefone_1_eleitor'] = row['celular'].strip()
    f['telefone_2_eleitor'] = row['telefone2'].strip()
    f['numero_local_votacao_local_trabalho'] = row['Nº Local'].strip()
    f['nome_local_votacao_local_trabalho'] = row['Nome Local'].strip()
    f['nome_municipio_local_trabalho'] = row['Localidade'].strip()
    f['secao_local_trabalho'] = row['Seção'].strip()
    f['mrj_local_trabalho'] = row['Cód. Objeto Local'].strip()
    f['descricao_funcao_eleitoral'] = row['Função Eleitoral'].strip()
    f['tipo_funcao_eleitoral'] = 'MRV'  # este export é só MRV
    f['data_atualizacao_mesario'] = row['Data Atualização'].strip()
    f['confirmou_convocacao'] = row['Ciente'].strip()
    return [f[c] for c in DB_COLUMNS]


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
            vals = [sql_val(v) for v in fields] + ["'MRV'"]
            tuples.append('(' + ', '.join(vals) + ')')
        out.append(',\n'.join(tuples) + ';')
        out.append('')
    return '\n'.join(out)


def main():
    if len(sys.argv) < 5:
        print("uso: parse_mesarios_csv.py <saida.sql> <arquivo.csv> <zona> <uf>")
        sys.exit(1)
    out_path, in_path, zona, uf = sys.argv[1:5]

    with open(in_path, encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        rows = [r for r in reader if r['Zona'].strip() == zona]

    if not rows:
        print(f"Nenhuma linha com Zona={zona} encontrada em {in_path}")
        sys.exit(1)

    all_fields = [row_to_fields(r, uf) for r in rows]

    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('-- ============================================================\n')
        f.write('-- Insercao em sime_mesarios_raw — gerado por script (parse_mesarios_csv.py)\n')
        f.write(f'-- Zona {zona}/{uf} — total de registros: {len(all_fields)}\n')
        f.write('-- ============================================================\n\n')
        f.write('begin;\n\n')
        f.write(gen_insert_sql(all_fields))
        f.write('\ncommit;\n')

    print(f"Arquivo gerado: {out_path}")
    print(f"Total de linhas de dados (zona {zona}): {len(rows)}\n")
    print("Por função:", dict(Counter(r['Função Eleitoral'] for r in rows)))
    print("Por município:", dict(Counter(r['Localidade'] for r in rows)))
    print("Por situação:", dict(Counter(r['Situação'] for r in rows)))
    sem_telefone = sum(1 for r in rows if not r['whatsapp'].strip() and not r['celular'].strip() and not r['telefone2'].strip())
    print(f"Sem nenhum telefone: {sem_telefone}")


if __name__ == '__main__':
    main()
