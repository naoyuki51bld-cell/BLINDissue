import { describe, expect, it } from 'vitest';
import { defaultData } from '../data/store';
import { labelsFromList, interleave, romajiToKana } from '../data/schemes';
import { importAlgTable, importPairTable, makeMatcher } from './importer';
import { parseDelimited } from './table';

const cfg = defaultData().pieces;

describe('importer', () => {
  it('reads a matrix sheet with kana labels', () => {
    // 行=1文字目、列=2文字目（コーナー: ひらがな、バッファ UFR=う/U2）
    const csv = [',あ,い,お', "い,\"[R U R', D]\",,", "お,[D: [R' U R, D2]],R U R',"].join('\n');
    const res = importAlgTable('corner', cfg.corner, parseDelimited(csv));
    expect(res.mode).toBe('matrix');
    // い→あ と お→い。お(LUB) と あ(UBL) は同じパーツなので飛ばす
    expect(res.entries.map((e) => `${e.a}${e.b}`).sort()).toEqual(['L0U1', 'U1U0']);
    expect(res.skippedInvalid).toEqual(['おあ']);
  });
  it('reads a list with pair strings and position names', () => {
    const tsv = "AB\t[M', U2]\tメモ\nUB-UL\t[U R U', M']\nXY\tR";
    const res = importAlgTable('edge', cfg.edge, parseDelimited(tsv));
    expect(res.mode).toBe('list');
    expect(res.entries).toHaveLength(2);
    expect(res.entries[0]).toMatchObject({ a: 'U0', b: 'U1', memo: 'メモ' });
    expect(res.entries[1]).toMatchObject({ a: 'U0', b: 'U3' });
  });
  it('splits multi-letter labels', () => {
    const labels = labelsFromList(interleave('K S T N H M Y R W G Z D'.split(' '), 'A I U E O AA II UU EE OO YA YO'.split(' ')));
    const m = makeMatcher('edge', { ...cfg.edge, labels });
    // K+AA に一意に分けられる（KA というラベルは無い）
    expect(m.splitPair('KAA')).toEqual(['U0', 'F3']);
  });
  it('reads letter pairs', () => {
    const res = importPairTable(parseDelimited('ペア,単語\nあい,愛\nあう,会う'), ['あ', 'い', 'う']);
    expect(res.entries).toEqual([
      { pair: 'あい', word: '愛' },
      { pair: 'あう', word: '会う' },
    ]);
  });
  it('romaji to kana', () => {
    expect(romajiToKana('KA')).toBe('か');
    expect(romajiToKana('SHI')).toBe('し');
    expect(romajiToKana('KS')).toBeNull();
    expect(romajiToKana('AI')).toBe('あい');
  });
});
