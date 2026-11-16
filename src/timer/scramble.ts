// 3x3 のスクランブル（ランダムな手順の並び）
const FACES = ['U', 'D', 'R', 'L', 'F', 'B'];
const AXIS: Record<string, number> = { U: 0, D: 0, R: 1, L: 1, F: 2, B: 2 };
const SUFFIX = ['', "'", '2'];

export function randomScramble(length = 25, rand: () => number = Math.random): string {
  const out: string[] = [];
  let last = '';
  let lastAxisCount = 0;
  let lastAxis = -1;
  while (out.length < length) {
    const f = FACES[Math.floor(rand() * 6)];
    if (f === last) continue;
    const ax = AXIS[f];
    // 同じ軸が 3 回続かないように（R L R など）
    if (ax === lastAxis && lastAxisCount >= 2) continue;
    if (ax === lastAxis) lastAxisCount++;
    else {
      lastAxis = ax;
      lastAxisCount = 1;
    }
    last = f;
    out.push(f + SUFFIX[Math.floor(rand() * 3)]);
  }
  return out.join(' ');
}
