#!/usr/bin/env python3
# Parseia o CSV exportado da planilha "convocação mesários" (abas "base geral
# MRV" e "Base Geral Apoio especializado" — mesmo cabeçalho nas duas,
# confirmado em 20/08/2026) e gera SQL de INSERT pronto para
# sime_mesarios_raw. Esse cabeçalho é o dump ELO completo do TRE (81 colunas,
# igual ao que scripts/parse_mesarios.py espera no formato .md de largura
# fixa) — aqui é a mesma coisa, só que já em CSV (Arquivo → Fazer
# download → Valores separados por vírgula, na planilha).
#
# Diferente de parse_mesarios_csv.py (formato "MRV simples", sem os campos de
# acompanhamento): este mapeia TODAS as 81 colunas por NOME de cabeçalho (não
# por posição), incluindo Confirmou convocação/Origem da resposta/
# Justificativa — os mesmos campos que o Apps Script da planilha
# (SIME_Sync.gs) já mantém. tipo_registro não é adivinhado: vem direto da
# própria coluna "Tipo função eleitoral" (a exportação do TRE já grava 'MRV'
# ou 'AL' ali), igual ao parser .md original.
#
# Mesmo cuidado dos outros parsers: roda em disco, nome/CPF/telefone nunca
# aparecem no console — só contagem agregada por tipo/função/situação.
#
# Uso (uma ou mais planilhas exportadas juntas):
#   python3 scripts/parse_mesarios_gsheet_csv.py saida.sql mrv.csv apoio.csv

import sys
import csv
from collections import Counter

# Mesma ordem de scripts/parse_mesarios.py — header do CSV (chave) -> coluna
# de sime_mesarios_raw (valor), na ordem exata das 81 colunas confirmadas
# pelo cabeçalho da planilha em 20/08/2026.
HEADER_TO_COLUMN = [
    ("Processo Eleitoral", "processo_eleitoral"),
    ("Pleito", "pleito"),
    ("UF de trabalho", "uf_trabalho"),
    ("Zona eleitoral de trabalho", "zona_eleitoral_trabalho"),
    ("Inscrição", "inscricao"),
    ("CPF (eleitor)", "cpf_eleitor"),
    ("CPF (dados mesário)", "cpf_dados_mesario"),
    ("Nome civil", "nome_civil"),
    ("Nome Social", "nome_social"),
    ("Data de nascimento", "data_nascimento"),
    ("Tipo telefone 1 (eleitor)", "tipo_telefone_1_eleitor"),
    ("Telefone 1 (eleitor)", "telefone_1_eleitor"),
    ("Tipo telefone 2 (eleitor)", "tipo_telefone_2_eleitor"),
    ("Telefone 2 (eleitor)", "telefone_2_eleitor"),
    ("Telefone contato (eleitor)", "telefone_contato_eleitor"),
    ("Tipo telefone pessoal (dados mesário)", "tipo_telefone_pessoal_mesario"),
    ("Telefone pessoal (dados mesário)", "telefone_pessoal_mesario"),
    ("Tipo telefone comercial (dados mesário)", "tipo_telefone_comercial_mesario"),
    ("Telefone comercial (dados mesário)", "telefone_comercial_mesario"),
    ("E-mail (eleitor)", "email_eleitor"),
    ("E-mail (dados mesário)", "email_dados_mesario"),
    ("Tipo correspondência", "tipo_correspondencia"),
    ("Grau de instrução (eleitor)", "grau_instrucao_eleitor"),
    ("Grau de instrução (dados mesário)", "grau_instrucao_mesario"),
    ("Ocupação (eleitor)", "ocupacao_eleitor"),
    ("Ocupação (dados mesário)", "ocupacao_mesario"),
    ("Excluído de eleição futura", "excluido_eleicao_futura"),
    ("Data limite exclusão de eleição futura", "data_limite_exclusao_eleicao_futura"),
    ("Observação (dados mesário)", "observacao_dados_mesario"),
    ("Possui carro", "possui_carro"),
    ("Experiência", "experiencia"),
    ("ASE 205", "ase_205"),
    ("UF do endereço do eleitor", "uf_endereco_eleitor"),
    ("Código município do endereço do eleitor", "codigo_municipio_endereco_eleitor"),
    ("Nome município do endereço do eleitor", "nome_municipio_endereco_eleitor"),
    ("Endereço do eleitor", "endereco_eleitor"),
    ("Bairro do eleitor", "bairro_eleitor"),
    ("CEP do eleitor", "cep_eleitor"),
    ("Zona eleitoral do eleitor", "zona_eleitoral_eleitor"),
    ("UF (dados mesário)", "uf_dados_mesario"),
    ("Código município (dados mesário)", "codigo_municipio_dados_mesario"),
    ("Nome município (dados mesário)", "nome_municipio_dados_mesario"),
    ("Endereço (dados mesário)", "endereco_dados_mesario"),
    ("Bairro (dados mesário)", "bairro_dados_mesario"),
    ("CEP (dados mesário)", "cep_dados_mesario"),
    ("UF comercial (dados mesário)", "uf_comercial_mesario"),
    ("Código município comercial (dados mesário)", "codigo_municipio_comercial_mesario"),
    ("Nome município comercial (dados mesário)", "nome_municipio_comercial_mesario"),
    ("Endereço comercial (dados mesário)", "endereco_comercial_mesario"),
    ("Bairro comercial (dados mesário)", "bairro_comercial_mesario"),
    ("CEP comercial (dados mesário)", "cep_comercial_mesario"),
    ("Nome de empresa", "nome_empresa"),
    ("Função na empresa", "funcao_empresa"),
    ("Código município local de trabalho", "codigo_municipio_local_trabalho"),
    ("Nome município local de trabalho", "nome_municipio_local_trabalho"),
    ("Bairro", "bairro_local_trabalho"),
    ("CEP", "cep_local_trabalho"),
    ("Número do Local de votação local de trabalho", "numero_local_votacao_local_trabalho"),
    ("Nome do local de votação local de trabalho", "nome_local_votacao_local_trabalho"),
    ("Descrição local de trabalho", "descricao_local_trabalho"),
    ("Seção local de trabalho", "secao_local_trabalho"),
    ("MRJ local de trabalho", "mrj_local_trabalho"),
    ("UF de votação do eleitor", "uf_votacao_eleitor"),
    ("Código município de votação do eleitor", "codigo_municipio_votacao_eleitor"),
    ("Nome município de votação do eleitor", "nome_municipio_votacao_eleitor"),
    ("Bairro de votação do eleitor", "bairro_votacao_eleitor"),
    ("CEP de votação do eleitor", "cep_votacao_eleitor"),
    ("Número do local de votação do eleitor", "numero_local_votacao_eleitor"),
    ("Nome do local de votação do eleitor", "nome_local_votacao_eleitor"),
    ("Número da seção de votação do eleitor", "numero_secao_votacao_eleitor"),
    ("Tipo função eleitoral", "tipo_funcao_eleitoral"),
    ("Descrição função eleitoral", "descricao_funcao_eleitoral"),
    ("Data atribuição", "data_atribuicao"),
    ("Data convocação", "data_convocacao"),
    ("Data nomeação", "data_nomeacao"),
    ("Data atualização (dados mesário)", "data_atualizacao_mesario"),
    ("Data último RAE", "data_ultimo_rae"),
    ("Confirmou convocação", "confirmou_convocacao"),
    ("Origem da resposta", "origem_resposta"),
    ("Data de resposta", "data_resposta"),
    ("Justificativa", "justificativa"),
]
DB_COLUMNS = [c for _, c in HEADER_TO_COLUMN]
HEADER_BY_COLUMN = {col: header for header, col in HEADER_TO_COLUMN}


def sql_val(v):
    v = (v or '').strip()
    if not v:
        return 'NULL'
    return "'" + v.replace("'", "''") + "'"


def detect_dialect(sample):
    try:
        return csv.Sniffer().sniff(sample, delimiters=',\t;')
    except csv.Error:
        return csv.excel  # fallback: vírgula


def parse_file(path):
    with open(path, encoding='utf-8-sig') as f:
        sample = f.read(4096)
        f.seek(0)
        dialect = detect_dialect(sample)
        reader = csv.DictReader(f, dialect=dialect)
        faltando = [h for h, _ in HEADER_TO_COLUMN if h not in (reader.fieldnames or [])]
        if faltando:
            raise SystemExit(
                f"{path}: {len(faltando)} coluna(s) esperada(s) não encontrada(s) no "
                f"cabeçalho (ex.: {faltando[:3]}) — NÃO gerar SQL, o mapeamento ficaria errado."
            )
        rows = list(reader)
    return rows


def gen_insert_sql(all_rows, batch_size=100):
    cols = DB_COLUMNS + ["tipo_registro"]
    col_list = ', '.join('"' + c + '"' for c in cols)
    out = []
    for i in range(0, len(all_rows), batch_size):
        batch = all_rows[i:i + batch_size]
        out.append(f'-- Lote {i // batch_size + 1}/{(len(all_rows) + batch_size - 1) // batch_size} ({len(batch)} registros)')
        out.append(f'insert into public.sime_mesarios_raw ({col_list}) values')
        tuples = []
        for row in batch:
            vals = [sql_val(row.get(HEADER_BY_COLUMN[c], '')) for c in DB_COLUMNS]
            tipo_registro = (row.get('Tipo função eleitoral') or '').strip()
            tuples.append('(' + ', '.join(vals) + ', ' + sql_val(tipo_registro) + ')')
        out.append(',\n'.join(tuples) + ';')
        out.append('')
    return '\n'.join(out)


def main():
    if len(sys.argv) < 3:
        print("uso: parse_mesarios_gsheet_csv.py <saida.sql> <arquivo1.csv> [arquivo2.csv ...]")
        sys.exit(1)
    out_path = sys.argv[1]
    in_paths = sys.argv[2:]

    all_rows = []
    stats_por_arquivo = []
    for p in in_paths:
        rows = parse_file(p)
        all_rows.extend(rows)
        tipos = Counter((r.get('Tipo função eleitoral') or '').strip() for r in rows)
        stats_por_arquivo.append((p, len(rows), dict(tipos)))

    if not all_rows:
        print("Nenhuma linha de dado encontrada.")
        sys.exit(1)

    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('-- ============================================================\n')
        f.write('-- Insercao em sime_mesarios_raw — gerado por script (parse_mesarios_gsheet_csv.py)\n')
        f.write(f'-- Total de registros: {len(all_rows)}\n')
        f.write('-- ============================================================\n\n')
        f.write('begin;\n\n')
        f.write(gen_insert_sql(all_rows))
        f.write('\ncommit;\n')

    print(f"Arquivo gerado: {out_path}")
    print(f"Total de linhas de dados: {len(all_rows)}\n")
    for p, n, tipos in stats_por_arquivo:
        print(f"{p}: {n} registros — por tipo_registro: {tipos}")

    zonas = Counter((r.get('Zona eleitoral de trabalho') or '').strip() for r in all_rows)
    ufs = Counter((r.get('UF de trabalho') or '').strip() for r in all_rows)
    funcoes = Counter((r.get('Descrição função eleitoral') or '').strip() for r in all_rows)
    confirmou = Counter((r.get('Confirmou convocação') or '(vazio)').strip() or '(vazio)' for r in all_rows)
    print("Por zona/UF de trabalho:", dict(zonas), dict(ufs))
    print("Por função:", dict(funcoes))
    print("Por 'Confirmou convocação':", dict(confirmou))


if __name__ == '__main__':
    main()
