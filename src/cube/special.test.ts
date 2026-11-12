import { describe, expect, it } from 'vitest';
import { checkSpecial, describeAlg, ltctCases, parityCases } from './special';

const PARITY_UFR_UBR = "R U R' F' R U R' U' R' F R2 U' R' U'"; // Elliott: UFR バッファ・UBR ターゲット（UF/UR 交換）

describe('special cases', () => {
  it('a parity alg matches exactly one parity case', () => {
    const ok = parityCases('U2').filter((c) => checkSpecial(c, PARITY_UFR_UBR).ok);
    expect(ok).toHaveLength(1);
    expect(ok[0].target).toBe('U1');
  });

  it('twist + parity is recognised as exactly one LTCT case', () => {
    const twist = "(R' D' R D)2 U' (R' D' R D)4 U"; // UFR と UFL を逆向きにひねる
    const alg = `${twist} ${PARITY_UFR_UBR}`;
    expect(describeAlg(alg)).toContain('ねじれ');
    const ok = ltctCases('U2').filter((c) => checkSpecial(c, alg).ok);
    expect(ok).toHaveLength(1);
    // ねじれの分だけ、最後のターゲットは UBR のうち U 面以外のステッカーになる
    expect(['R1', 'B0']).toContain(ok[0].target);
    expect(ok[0].twisted).toBe('U3');
    // 逆向きのねじれは不正解
    const flipped = { ...ok[0], dir: ok[0].dir === 'cw' ? ('ccw' as const) : ('cw' as const) };
    expect(checkSpecial(flipped, alg).ok).toBe(false);
  });

  it('explains mistakes', () => {
    const r = checkSpecial({ kind: 'flip', a: 'U2', b: 'U1' }, "R U R'");
    expect(r.ok).toBe(false);
  });
});
