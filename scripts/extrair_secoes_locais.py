#!/usr/bin/env python3
# Extrai a lista de SEÇÕES + LOCAIS DE VOTAÇÃO a partir da própria planilha de
# mesários (a mesma que já é usada pra popular sime_mesarios_raw/sime_atores)
# e gera SQL de INSERT pronto pra sime_secoes.
#
# Pedido direto (28/08/2026): "da planilha de mesários do modulo de
# convocação você consegue extrair as seções e locais de votação?" — útil
# principalmente pra configurar uma zona NOVA (ex.: 94ª), que ainda não tem
# sime_secoes populado e cujo seed original (7ª Zona) foi feito à mão, fora
# do repositório ("Inserção das seções e rotas via script de seed separado",
# ver sql/SIME_schema.sql).
#
# Só a aba/planilha MRV serve com confiança pra isto — o apoio logístico
# (Coordenador de Acessibilidade/Auxiliar de Eleição) quase nunca vem com
# "Seção local de trabalho"/"Seção" preenchido no arquivo do TRE (achado já
# documentado em CLAUDE.md ao investigar o mesmo problema pro Dashboard).
# Linhas de apoio logístico (tipo_funcao_eleitoral != 'MRV', quando essa
# coluna existe) são ignoradas de propósito, não são um erro.
#
# A planilha NÃO traz número de eleitores por seção — esse campo fica NULL
# aqui; se precisar, complete depois com a lista oficial de seções do TRE
# (fora do escopo deste script, que só sabe o que a planilha de mesários traz).
#
# Aceita os DOIS formatos CSV já usados pelo resto do projeto (detecção
# automática pelo cabeçalho — mesmos dois que "🔄 Sincronizar" aceita no
# navegador):
#   - roster completo (81 colunas, cabeçalho "Seção local de trabalho")
#   - "MRV simples" (16 colunas, cabeçalho "Seção" + "Localidade" + "Nº Local")
# NÃO aceita o dump ELO .md (largura fixa) nesta v1 — se só tiver esse
# formato, exporte a planilha como CSV primeiro (ou peça pra estender este
# script, a lógica de leitura do .md já existe em parse_mesarios.py).
#
# Mesmo cuidado dos outros parsers: roda inteiramente em disco, nome/CPF/
# telefone nunca são lidos nem impressos — só as colunas de local (seção,
# local de votação, município) e a contagem agregada no final.
#
# Uso:
#   python3 scripts/extrair_secoes_locais.py saida.sql arquivo.csv <zona> <uf>
#   No SQL Editor do Supabase: colar e rodar saida.sql (idempotente — pode
#   rodar de novo sem duplicar, atualiza local_nome/municipio se mudou).

import sys
import csv
from collections import Counter, OrderedDict

# As duas formas de cabeçalho que já existem no projeto pra essas 3 colunas —
# ver scripts/parse_mesarios_gsheet_csv.py (81 col.) e
# scripts/parse_mesarios_csv.py (16 col., "MRV simples").
COLUNAS_81 = {
    'seção': 'Seção local de trabalho',
    'local': 'Nome do local de votação local de trabalho',
    'municipio': 'Nome município local de trabalho',
    'zona': 'Zona eleitoral de trabalho',
    'tipo_funcao': 'Tipo função eleitoral',
}
COLUNAS_16 = {
    'seção': 'Seção',
    'local': 'Nome Local',
    'municipio': 'Localidade',
    'zona': 'Zona',
    'tipo_funcao': None,  # este formato é sempre MRV — não tem essa coluna
}


def detectar_dialeto(sample):
    try:
        return csv.Sniffer().sniff(sample, delimiters=',\t;')
    except csv.Error:
        return csv.excel


def detectar_formato(fieldnames):
    fs = set(fieldnames or [])
    if COLUNAS_81['seção'] in fs:
        return COLUNAS_81
    if COLUNAS_16['seção'] in fs and COLUNAS_16['municipio'] in fs:
        return COLUNAS_16
    return None


def ler_arquivo(path, zona):
    with open(path, encoding='utf-8-sig') as f:
        sample = f.read(4096)
        f.seek(0)
        dialect = detectar_dialeto(sample)
        reader = csv.DictReader(f, dialect=dialect)
        colunas = detectar_formato(reader.fieldnames)
        if not colunas:
            raise SystemExit(
                f"{path}: cabeçalho não reconhecido (nem formato de 81 colunas, "
                f"nem 'MRV simples' de 16) — não dá pra saber onde estão seção/"
                f"local/município. Colunas encontradas: {reader.fieldnames}"
            )
        linhas = list(reader)

    total = len(linhas)
    linhas = [r for r in linhas if (r.get(colunas['zona']) or '').strip() == zona]

    if colunas['tipo_funcao']:
        antes = len(linhas)
        linhas = [r for r in linhas if (r.get(colunas['tipo_funcao']) or '').strip().upper() == 'MRV']
        ignoradas_al = antes - len(linhas)
    else:
        ignoradas_al = 0  # formato "MRV simples" já é só MRV

    return linhas, colunas, total, ignoradas_al


def extrair_secoes(linhas, colunas):
    """Devolve (OrderedDict numero -> (local_nome, municipio), lista de conflitos)."""
    secoes = OrderedDict()
    conflitos = []
    sem_secao = 0
    for r in linhas:
        num_raw = (r.get(colunas['seção']) or '').strip()
        if not num_raw:
            sem_secao += 1
            continue
        try:
            numero = int(num_raw)
        except ValueError:
            sem_secao += 1
            continue
        local_nome = (r.get(colunas['local']) or '').strip()
        municipio = (r.get(colunas['municipio']) or '').strip()
        if not local_nome or not municipio:
            sem_secao += 1
            continue
        if numero in secoes:
            existente = secoes[numero]
            if existente != (local_nome, municipio):
                conflitos.append((numero, existente, (local_nome, municipio)))
            continue  # mantém o primeiro valor — nunca adivinha qual está certo
        secoes[numero] = (local_nome, municipio)
    return secoes, conflitos, sem_secao


def sql_val(v):
    return "'" + v.replace("'", "''") + "'"


def gen_insert_sql(secoes, zona, uf):
    linhas_values = ',\n  '.join(
        f'({numero}, {sql_val(local_nome)}, {sql_val(municipio)})'
        for numero, (local_nome, municipio) in secoes.items()
    )
    return f'''insert into public.sime_secoes (zona_id, numero, local_nome, municipio)
select z.id, v.numero, v.local_nome, v.municipio
from (values
  {linhas_values}
) as v(numero, local_nome, municipio)
cross join (select id from sime_zonas where numero={zona} and estado={sql_val(uf)}) z
on conflict (zona_id, numero) do update
  set local_nome = excluded.local_nome, municipio = excluded.municipio;
'''


def main():
    if len(sys.argv) < 5:
        print("uso: extrair_secoes_locais.py <saida.sql> <arquivo1.csv> [arquivo2.csv ...] <zona> <uf>")
        sys.exit(1)
    out_path = sys.argv[1]
    zona, uf = sys.argv[-2], sys.argv[-1]
    in_paths = sys.argv[2:-2]
    if not in_paths:
        print("uso: extrair_secoes_locais.py <saida.sql> <arquivo1.csv> [arquivo2.csv ...] <zona> <uf>")
        sys.exit(1)

    secoes_total = OrderedDict()
    conflitos_total = []
    total_lido = 0
    total_ignoradas_al = 0
    total_sem_secao = 0

    for path in in_paths:
        linhas, colunas, total, ignoradas_al = ler_arquivo(path, zona)
        total_lido += total
        total_ignoradas_al += ignoradas_al
        secoes, conflitos, sem_secao = extrair_secoes(linhas, colunas)
        total_sem_secao += sem_secao
        for numero, valor in secoes.items():
            if numero in secoes_total and secoes_total[numero] != valor:
                conflitos_total.append((numero, secoes_total[numero], valor))
                continue
            secoes_total[numero] = valor
        conflitos_total.extend(conflitos)

    if not secoes_total:
        print(f"Nenhuma seção MRV com zona={zona} encontrada nos arquivos informados.")
        sys.exit(1)

    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('-- ============================================================\n')
        f.write('-- Seções/locais de votação extraídos da planilha de mesários\n')
        f.write(f'-- Zona {zona}/{uf} — {len(secoes_total)} seções únicas (só MRV)\n')
        f.write('-- Não traz número de eleitores (a planilha de mesários não tem essa\n')
        f.write('-- coluna) — completar depois se precisar, com a lista oficial do TRE.\n')
        f.write('-- Idempotente (ON CONFLICT atualiza local_nome/municipio se mudou).\n')
        f.write('-- ============================================================\n\n')
        f.write('begin;\n\n')
        f.write(gen_insert_sql(secoes_total, zona, uf))
        f.write('\ncommit;\n')

    municipios = Counter(m for _, m in secoes_total.values())
    print(f"Arquivo gerado: {out_path}")
    print(f"Linhas lidas nos arquivos: {total_lido}")
    if total_ignoradas_al:
        print(f"Ignoradas (apoio logístico, sem seção confiável no arquivo do TRE): {total_ignoradas_al}")
    if total_sem_secao:
        print(f"Ignoradas (sem seção/local/município preenchido): {total_sem_secao}")
    print(f"Seções únicas extraídas (zona {zona}): {len(secoes_total)}")
    print("Por município:", dict(municipios))
    if conflitos_total:
        print(f"\n⚠ {len(conflitos_total)} conflito(s) — mesmo número de seção com local/município "
              f"diferente entre linhas (mantido o PRIMEIRO valor encontrado, nada foi adivinhado):")
        for numero, antigo, novo in conflitos_total:
            print(f"  Seção {numero}: mantido {antigo!r}, ignorado {novo!r}")


if __name__ == '__main__':
    main()
