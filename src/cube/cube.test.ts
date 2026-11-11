import { describe, expect, it } from 'vitest';
import { applyMoves, solved, statesEqual, wholeCubeRotations } from './cube';
import { cancel, flatten, flatToString, invertAlgText, moveCount, parseAlg, toBaseMoves } from './notation';
import { casesFor, stickerIndex, stickerName, STICKER_IDS, type PieceType } from './pieces';
import { detectCase, verifyAlg } from './verify';

const run = (alg: string, n: number) => applyMoves(solved(n), n, toBaseMoves(alg, n));
const isSolved = (alg: string, n: number) => statesEqual(run(alg, n), solved(n));

describe('cube simulator', () => {
  it('basic identities hold', () => {
    for (const n of [3, 4, 5]) {
      expect(isSolved('R4', n)).toBe(true);
      expect(isSolved("(R U R' U')6", n)).toBe(true);
    }
    expect(isSolved('(R U)105', 3)).toBe(true);
    expect(isSolved('(R U)35', 3)).toBe(false);
  });
  it('M / x / wide moves are consistent', () => {
    expect(statesEqual(run('x', 3), run("R M' L'", 3))).toBe(true);
    expect(statesEqual(run('Rw', 4), run('R 2R', 4))).toBe(true);
    expect(statesEqual(run('r', 4), run('Rw', 4))).toBe(true);
    expect(statesEqual(run('3Rw', 5), run('R 2R 3R', 5))).toBe(true);
    expect(statesEqual(run('2-3Rw', 5), run('2R 3R', 5))).toBe(true);
    expect(statesEqual(run('y', 3), run("U E' D'", 3))).toBe(true);
    expect(statesEqual(run('z', 3), run("F S B'", 3))).toBe(true);
    expect(statesEqual(run('Rw', 3), run("R M'", 3))).toBe(true);
  });
  it('has 24 whole cube rotations', () => {
    expect(wholeCubeRotations(3)).toHaveLength(24);
    expect(wholeCubeRotations(4)).toHaveLength(24);
  });
});

describe('notation', () => {
  it('expands commutators and conjugates', () => {
    expect(flatToString(cancel(flatten(parseAlg("[R U R', D]"))))).toBe("R U R' D R U' R' D'");
    expect(flatToString(cancel(flatten(parseAlg("[R: U]"))))).toBe("R U R'");
    expect(flatToString(cancel(flatten(parseAlg("[U': [R' D R, U2]]"))))).toBe("U' R' D R U2 R' D' R U'");
  });
  it('accepts full-width / japanese punctuation', () => {
    expect(moveCount('［Ｒ　Ｕ　Ｒ’，　Ｄ］')).toBe(8);
  });
  it('inverts while keeping structure', () => {
    expect(invertAlgText("[R U R', D]")).toBe("[D, R U R']");
    expect(invertAlgText("[U': [R' D R, U2]]")).toBe("[U': [U2, R' D R]]");
    const a = "[U': [R' D R, U2]] R2";
    expect(isSolved(`${a} ${invertAlgText(a)}`, 3)).toBe(true);
  });
  it('reports syntax errors', () => {
    expect(() => parseAlg('[R U')).toThrow();
    expect(() => parseAlg('[R U]')).toThrow();
    expect(() => parseAlg('R Q')).toThrow();
  });
});

describe('pieces', () => {
  it('names follow Speffz positions', () => {
    expect(STICKER_IDS.map((id) => stickerName('corner', id)).join(' ')).toBe(
      'UBL UBR UFR UFL LUB LUF LDF LDB FUL FUR FDR FDL RUF RUB RDB RDF BUR BUL BDL BDR DFL DFR DBR DBL',
    );
    expect(STICKER_IDS.map((id) => stickerName('edge', id)).join(' ')).toBe(
      'UB UR UF UL LU LF LD LB FU FR FD FL RU RB RD RF BU BL BD BR DF DR DB DL',
    );
    expect(stickerName('wing', 'U2')).toBe('UFr');
    expect(stickerName('wing', 'U0')).toBe('UBl');
    expect(stickerName('xcenter', 'U0')).toBe('Ubl');
    expect(stickerName('tcenter', 'U0')).toBe('Ub');
  });
  it('enumerates cases', () => {
    expect(casesFor('corner', 'U2')).toHaveLength(378);
    expect(casesFor('edge', 'U2')).toHaveLength(440);
    expect(casesFor('wing', 'U2')).toHaveLength(506);
    expect(casesFor('xcenter', 'U0')).toHaveLength(506);
  });
});

describe('verification', () => {
  it('detects and verifies a corner commutator', () => {
    const alg = "[R U R', D]";
    const detected = detectCase('corner', 3, run(alg, 3), 'U2');
    expect(detected).not.toBeNull();
    const [a, b] = detected!;
    expect(verifyAlg('corner', 3, alg, 'U2', a, b)).toEqual({ kind: 'ok', rotation: false });
    // 逆順のケースは逆手順
    expect(verifyAlg('corner', 3, invertAlgText(alg), 'U2', b, a).kind).toBe('ok');
    expect(verifyAlg('corner', 3, alg, 'U2', b, a).kind).toBe('mismatch');
  });
  it('edge 3-cycles are detected and verified', () => {
    for (const alg of ["M2 U2 M U2 M", "[M', U2]", "[U R U', M']", "[R' U' R: [R2', E]]"]) {
      const d = detectCase('edge', 3, run(alg, 3), 'U2');
      expect(d, alg).not.toBeNull();
      expect(verifyAlg('edge', 3, alg, 'U2', d![0], d![1]).kind, alg).toBe('ok');
      expect(verifyAlg('edge', 3, invertAlgText(alg), 'U2', d![1], d![0]).kind, alg).toBe('ok');
    }
  });
  it('accepts algs that end with a rotation', () => {
    const d = detectCase('corner', 3, run("[R U R', D]", 3), 'U2')!;
    const res = verifyAlg('corner', 3, "[R U R', D] x", 'U2', d[0], d[1]);
    expect(res).toEqual({ kind: 'ok', rotation: true });
  });
  it('T-perm matches the known sticker movement', () => {
    const s = run("R U R' U' R' F R2 U' R' U' R U R' F'", 3);
    // UR と UL、UFR と UBR が入れ替わる（U 面: 0=UB,1=UR,2=UF,3=UL の中央行列）
    const U = (r: number, c: number) => r * 3 + c;
    expect(s[U(1, 2)]).toBe(U(1, 0));
    expect(s[U(1, 0)]).toBe(U(1, 2));
    expect(s[U(2, 2)]).toBe(U(0, 2));
    expect(s[U(0, 2)]).toBe(U(2, 2));
  });
  it('big cube commutators: wing / x-center / +center', () => {
    const cases: [PieceType, number, string][] = [
      ['wing', 4, "[R U R', 2D]"],
      ['wing', 5, "[L' U' L, 2D]"],
      ['xcenter', 4, "[2R, U 2L' U']"],
      ['xcenter', 5, "[U' 2R U, 2L']"],
      ['tcenter', 5, "[M', U 2L' U']"],
    ];
    for (const [pt, n, alg] of cases) {
      const s = run(alg, n);
      // 動いたスロットをバッファにする
      const buf = STICKER_IDS.find((id) => s[stickerIndex(pt, id, n)] !== stickerIndex(pt, id, n));
      expect(buf, alg).toBeDefined();
      const d = detectCase(pt, n, s, buf!);
      expect(d, alg).not.toBeNull();
      expect(verifyAlg(pt, n, alg, buf!, d![0], d![1]).kind, alg).toBe('ok');
      expect(verifyAlg(pt, n, alg, buf!, d![1], d![0]).kind, alg).toBe('mismatch');
    }
  });
});
