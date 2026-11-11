import { STICKER_IDS, type StickerId } from '../cube/pieces';

export type Labels = Record<StickerId, string>;

export const PRESETS: { id: string; name: string; labels: string[] }[] = [
  { id: 'speffz', name: 'Speffz（A〜X）', labels: 'ABCDEFGHIJKLMNOPQRSTUVWX'.split('') },
  {
    id: 'kana',
    name: 'ひらがな（あ〜ね）',
    labels: 'あいうえおかきくけこさしすせそたちつてとなにぬね'.split(''),
  },
  {
    id: 'kana-iroha',
    name: 'いろは（い〜ゐ）',
    labels: 'いろはにほへとちりぬるをわかよたれそつねならむうゐ'.split(''),
  },
];

export function labelsFromList(list: string[]): Labels {
  const out: Labels = {};
  STICKER_IDS.forEach((id, i) => (out[id] = list[i] ?? ''));
  return out;
}

/** 「A B C ...」や「あいう…」や改行・カンマ区切りを 24 個のラベルに分ける */
export function splitLabelInput(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  if (/[\s,、，\t]/.test(t)) return t.split(/[\s,、，\t]+/).filter(Boolean);
  return Array.from(t);
}

/** 奇数番号（1, 3, 5…）と偶数番号（2, 4, 6…）を別々のリストで指定する */
export function interleave(odd: string[], even: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < 12; i++) out.push(odd[i] ?? '', even[i] ?? '');
  return out;
}

export function duplicateLabels(labels: Labels): string[] {
  const seen = new Map<string, number>();
  for (const id of STICKER_IDS) {
    const l = labels[id];
    if (l) seen.set(l, (seen.get(l) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, c]) => c > 1).map(([l]) => l);
}

// ---- ローマ字 → ひらがな（エッジの「子音 + 母音」ペアをかな読みで表示するため） ----
const ROMAJI: Record<string, string> = {
  a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お',
  ka: 'か', ki: 'き', ku: 'く', ke: 'け', ko: 'こ',
  sa: 'さ', si: 'し', shi: 'し', su: 'す', se: 'せ', so: 'そ',
  ta: 'た', ti: 'ち', chi: 'ち', tu: 'つ', tsu: 'つ', te: 'て', to: 'と',
  na: 'な', ni: 'に', nu: 'ぬ', ne: 'ね', no: 'の',
  ha: 'は', hi: 'ひ', hu: 'ふ', fu: 'ふ', he: 'へ', ho: 'ほ',
  ma: 'ま', mi: 'み', mu: 'む', me: 'め', mo: 'も',
  ya: 'や', yu: 'ゆ', ye: 'いぇ', yo: 'よ', yi: 'い',
  ra: 'ら', ri: 'り', ru: 'る', re: 'れ', ro: 'ろ',
  la: 'ら', li: 'り', lu: 'る', le: 'れ', lo: 'ろ',
  wa: 'わ', wi: 'うぃ', wu: 'う', we: 'うぇ', wo: 'を',
  ga: 'が', gi: 'ぎ', gu: 'ぐ', ge: 'げ', go: 'ご',
  za: 'ざ', zi: 'じ', zu: 'ず', ze: 'ぜ', zo: 'ぞ',
  ja: 'じゃ', ji: 'じ', ju: 'じゅ', je: 'じぇ', jo: 'じょ',
  da: 'だ', di: 'ぢ', du: 'づ', de: 'で', do: 'ど',
  ba: 'ば', bi: 'び', bu: 'ぶ', be: 'べ', bo: 'ぼ',
  pa: 'ぱ', pi: 'ぴ', pu: 'ぷ', pe: 'ぺ', po: 'ぽ',
  va: 'ゔぁ', vi: 'ゔぃ', vu: 'ゔ', ve: 'ゔぇ', vo: 'ゔぉ',
  fa: 'ふぁ', fi: 'ふぃ', fe: 'ふぇ', fo: 'ふぉ',
  ca: 'か', ci: 'し', cu: 'く', ce: 'せ', co: 'こ',
  qa: 'くぁ', qi: 'くぃ', qu: 'く', qe: 'くぇ', qo: 'くぉ',
  xa: 'ぁ', xi: 'ぃ', xu: 'ぅ', xe: 'ぇ', xo: 'ぉ',
  n: 'ん', nn: 'ん',
};

/** ローマ字として読めればひらがなにする。読めなければ null */
export function romajiToKana(text: string): string | null {
  const s = text.toLowerCase();
  if (!/^[a-z]+$/.test(s)) return null;
  let out = '';
  let i = 0;
  while (i < s.length) {
    let matched = false;
    for (const len of [3, 2, 1]) {
      const part = s.slice(i, i + len);
      if (part.length === len && ROMAJI[part]) {
        // 子音 1 文字の n は、後ろに母音が続く場合は使わない
        if (part === 'n' && i + 1 < s.length && /[aiueoy]/.test(s[i + 1])) continue;
        out += ROMAJI[part];
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) {
      // 促音（kk → っk）
      if (i + 1 < s.length && s[i] === s[i + 1] && !/[aiueon]/.test(s[i])) {
        out += 'っ';
        i++;
        continue;
      }
      return null;
    }
  }
  return out;
}
