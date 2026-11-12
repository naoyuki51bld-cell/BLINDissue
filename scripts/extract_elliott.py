"""Elliott's "Full Floating & More" スプレッドシート（.xlsx）から手順表を取り出して JSON にする。

使い方: python3 -I scripts/extract_elliott.py 入力.xlsx src/data/elliott.json
元の表は「制限なく使ってよい（コピー・改変・公開・配布可）」と明記されている。
"""
import json
import sys

import openpyxl

EDGE_BUFFERS = ['UF', 'UB', 'UR', 'UL', 'DF', 'DB', 'FR', 'FL', 'DR', 'DL']
CORNER_BUFFERS = ['UFR', 'UFL', 'UBL', 'UBR', 'DFR', 'DFL']


def table(ws):
    rows = list(ws.iter_rows(values_only=True))
    header = rows[0]
    out = {}
    for r in rows[1:]:
        first = r[0]
        if not first:
            continue
        for col, cell in zip(header[1:], r[1:]):
            if col and isinstance(cell, str) and cell.strip():
                out.setdefault(str(first).strip(), {})[str(col).strip()] = ' '.join(cell.split())
    return out


def main(src, dst):
    wb = openpyxl.load_workbook(src, data_only=True)
    data = {
        'source': "Elliott's Full Floating & More",
        'edge': {b: table(wb[b]) for b in EDGE_BUFFERS if b in wb.sheetnames},
        'corner': {b: table(wb[b]) for b in CORNER_BUFFERS if b in wb.sheetnames},
    }
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    n = sum(len(c) for t in ('edge', 'corner') for b in data[t].values() for c in b.values())
    print(f'{n} algs written to {dst}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
