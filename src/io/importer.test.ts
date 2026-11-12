import { describe, expect, it } from 'vitest';
import { defaultData } from '../data/store';
import { labelsFromList, interleave, romajiToKana } from '../data/schemes';
import { importAlgTable, importPairTable, makeMatcher } from './importer';
import { pairReading, pairText } from '../data/labels';
import { applyMoves, solved } from '../cube/cube';
import { toBaseMoves } from '../cube/notation';
import { detectCase } from '../cube/verify';

const detect = (alg: string) => detectCase('edge', 3, applyMoves(solved(3), 3, toBaseMoves(alg, 3)), 'U2')!;
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
  it('detects sheets whose header row is the first target', () => {
    // [R U R', D] はバッファ UFR → RDF → FDL。上の行を 1 文字目にした表
    const csv = [',た,あ', "し,\"[R U R', D]\","].join('\n');
    const res = importAlgTable('corner', cfg.corner, parseDelimited(csv));
    expect(res.transposed).toBe(true);
    expect(res.entries[0]).toMatchObject({ a: 'R3', b: 'F3' });
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
    expect(romajiToKana('KYA')).toBe('きゃ');
    expect(romajiToKana('SHO')).toBe('しょ');
    expect(romajiToKana('CHU')).toBe('ちゅ');
  });
  it('dual labels: first letter consonant, second letter vowel', () => {
    const consonants = labelsFromList('K S T N H M Y R W G Z D B P J F V C L Q X KY SH CH'.split(' '));
    const vowels = labelsFromList('A I U E O AA II UU EE OO YA YU YO WA WO AI AU EI OU UI IA IU IE IO'.split(' '));
    const dual = { ...cfg.edge, labels: consonants, labels2: vowels, dual: true };
    const m = makeMatcher('edge', dual);
    // K = U0（1 文字目）、A = U0 の 2 文字目… は同じパーツなので、S（U1）+ A（U0）
    expect(m.splitPair('SA')).toEqual(['U1', 'U0']);
    expect(m.splitPair('KI')).toEqual(['U0', 'U1']);
    // 表形式: 行 = 1 文字目（子音）、列 = 2 文字目（母音）
    const d = detect("[M', U2]");
    const header = ['', vowels[d[1]]].join(',');
    const row = [consonants[d[0]], "\"[M', U2]\""].join(',');
    const res = importAlgTable('edge', dual, parseDelimited([header + ',' + vowels['U1'], row + ','].join('\n')));
    expect(res.mode).toBe('matrix');
    expect(res.transposed).toBeFalsy();
    expect(res.entries[0]).toMatchObject({ a: d[0], b: d[1] });
  });
  it('pair text uses the first set for the first letter and the second set for the second', () => {
    const dual = { ...cfg.edge, labels: labelsFromList(Array(24).fill('').map((_, i) => 'KSTNHMYRWGZDBPJFVCLQXZZZ'[i])), labels2: labelsFromList(Array(24).fill('').map((_, i) => 'AIUEOAIUEOAIUEOAIUEOAIUE'[i])), dual: true };
    expect(pairText('edge', dual, 'U1', 'U0')).toBe('SA');
    expect(pairReading({ ...dual, kana: true }, 'SA')).toBe('さ');
  });
});
