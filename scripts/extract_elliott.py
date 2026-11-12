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


def parity(ws):
    """PARITY: 行 = 最後のコーナーのターゲット、列 = コーナーのバッファ（その右隣の列が入れ替わるエッジ）"""
    rows = list(ws.iter_rows(values_only=True))
    header = rows[0]
    out = {}
    for r in rows[1:]:
        target = r[0]
        if not target:
            continue
        for j, buf in enumerate(header):
            if j == 0 or not buf or buf == 'SWAP':
                continue
            alg = r[j] if j < len(r) else None
            if isinstance(alg, str) and alg.strip():
                out.setdefault(str(buf).strip(), {})[str(target).strip()] = ' '.join(alg.split())
    return out


def flips(ws):
    """FLIPS: 三角形の表。1 列目 = UF、以降の列は対角線に書かれた行のエッジ"""
    rows = list(ws.iter_rows(values_only=True))
    labels = [str(rows[0][1]).strip()]
    out = {}
    for i, r in enumerate(rows[1:], start=1):
        name = r[0]
        if not name:
            continue
        name = str(name).strip()
        for j in range(1, i + 1):
            alg = r[j] if j < len(r) else None
            if j - 1 < len(labels) and isinstance(alg, str) and alg.strip():
                out.setdefault(name, {})[labels[j - 1]] = ' '.join(alg.split())
        labels.append(name)
    return out


def main(src, dst):
    wb = openpyxl.load_workbook(src, data_only=True)
    data = {
        'source': "Elliott's Full Floating & More",
        'edge': {b: table(wb[b]) for b in EDGE_BUFFERS if b in wb.sheetnames},
        'corner': {b: table(wb[b]) for b in CORNER_BUFFERS if b in wb.sheetnames},
        'parity': parity(wb['PARITY']) if 'PARITY' in wb.sheetnames else {},
        'flip': flips(wb['FLIPS']) if 'FLIPS' in wb.sheetnames else {},
    }
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    n = sum(len(c) for t in ('edge', 'corner', 'parity', 'flip') for b in data[t].values() for c in (b.values() if t in ('edge', 'corner') else [b]))
    print(f'{n} algs written to {dst}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
