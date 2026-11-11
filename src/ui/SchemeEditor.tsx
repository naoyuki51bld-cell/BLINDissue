import { useState } from 'react';
import { PIECE_LABEL, PIECE_TYPES, STICKER_IDS, stickerName, VALID_SIZES, type PieceType, type StickerId } from '../cube/pieces';
import { duplicateLabels, interleave, labelsFromList, PRESETS, splitLabelInput } from '../data/schemes';
import { useStore } from '../data/store';
import { CubeNet } from './CubeNet';
import { PieceTabs, Section, usePersisted } from './shared';

export function SchemeEditor() {
  const [pt, setPt] = usePersisted<PieceType>('scheme.pt', 'corner');
  const cfg = useStore((s) => s.pieces[pt]);
  const pieces = useStore((s) => s.pieces);
  const setPiece = useStore((s) => s.setPiece);
  const [selected, setSelected] = useState<StickerId | null>(null);
  const [bulk, setBulk] = useState('');
  const [odd, setOdd] = useState('');
  const [even, setEven] = useState('');
  const [mode, setMode] = useState<'each' | 'bulk' | 'oddeven'>('each');
  const dups = duplicateLabels(cfg.labels);

  const setLabel = (id: StickerId, v: string) => setPiece(pt, { labels: { ...cfg.labels, [id]: v.trim() } });
  const apply = (list: string[]) => setPiece(pt, { labels: labelsFromList(list) });
  const current = STICKER_IDS.map((id) => cfg.labels[id] ?? '');

  return (
    <Section title="文字の割り振りとバッファ">
      <PieceTabs value={pt} onChange={setPt} />
      <div className="editor-grid">
        <div className="stack">
          <CubeNet
            n={cfg.size}
            pieceType={pt}
            labels={cfg.labels}
            marks={[{ id: cfg.buffer, kind: 'buffer' }, ...(selected ? [{ id: selected, kind: 'selected' as const }] : [])]}
            onSlotClick={(id) => {
              setMode('each');
              setSelected(id);
              setTimeout(() => document.getElementById(`label-${id}`)?.focus(), 0);
            }}
          />
          <p className="muted small">★ がバッファ。ステッカーを押すとその文字を編集できます。番号は Speffz と同じ並び（U 面の左上から時計回り → L → F → R → B → D）です。</p>
          <div className="row wrap">
            <label className="field inline">
              <span className="field-label">バッファ</span>
              <select value={cfg.buffer} onChange={(e) => setPiece(pt, { buffer: e.target.value })}>
                {STICKER_IDS.map((id) => (
                  <option key={id} value={id}>
                    {stickerName(pt, id)}（{cfg.labels[id] || '—'}）
                  </option>
                ))}
              </select>
            </label>
            <label className="field inline">
              <span className="field-label">確認に使うキューブ</span>
              <select value={cfg.size} onChange={(e) => setPiece(pt, { size: Number(e.target.value) })}>
                {VALID_SIZES[pt].map((n) => (
                  <option key={n} value={n}>
                    {n}x{n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={cfg.kana} onChange={(e) => setPiece(pt, { kana: e.target.checked })} />
            ペアがローマ字として読めるとき、かなの読みを併記する（例: K + A → か）
          </label>
          <p className="muted small">バッファを変えると、そのバッファ用の手順表に切り替わります（元の手順は消えません）。フローティングバッファの手順表もこれで管理できます。</p>
        </div>
        <div className="stack">
          <div className="segmented">
            <button className={mode === 'each' ? 'active' : ''} onClick={() => setMode('each')}>
              1 枚ずつ
            </button>
            <button className={mode === 'bulk' ? 'active' : ''} onClick={() => { setMode('bulk'); setBulk(current.join(' ')); }}>
              まとめて
            </button>
            <button
              className={mode === 'oddeven' ? 'active' : ''}
              onClick={() => {
                setMode('oddeven');
                setOdd(current.filter((_, i) => i % 2 === 0).join(' '));
                setEven(current.filter((_, i) => i % 2 === 1).join(' '));
              }}
            >
              奇数／偶数
            </button>
          </div>

          {mode === 'each' && (
            <div className="label-grid">
              {STICKER_IDS.map((id, i) => (
                <label key={id} className={id === cfg.buffer ? 'label-cell buffer' : selected === id ? 'label-cell selected' : 'label-cell'}>
                  <span className="muted small">
                    {i + 1}. {stickerName(pt, id)}
                  </span>
                  <input
                    id={`label-${id}`}
                    defaultValue={cfg.labels[id] ?? ''}
                    key={`${pt}-${id}-${cfg.labels[id] ?? ''}`}
                    onFocus={() => setSelected(id)}
                    onBlur={(e) => e.target.value.trim() !== (cfg.labels[id] ?? '') && setLabel(id, e.target.value)}
                  />
                </label>
              ))}
            </div>
          )}

          {mode === 'bulk' && (
            <div className="stack">
              <textarea rows={3} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder="例: あ い う え お か …（スペース区切り。1 文字ずつなら区切りなしでも可）" />
              <p className="muted small">{splitLabelInput(bulk).length} / 24 個</p>
              <button className="btn primary" onClick={() => apply(splitLabelInput(bulk))}>
                反映
              </button>
            </div>
          )}

          {mode === 'oddeven' && (
            <div className="stack">
              <p className="muted small">
                奇数番号（1, 3, 5, …, 23）と偶数番号（2, 4, …, 24）の文字を別々に入力します。エッジで「奇数は子音、偶数は母音」のように振っている場合に便利です。
              </p>
              <label className="field">
                <span className="field-label">奇数番号の 12 個（{splitLabelInput(odd).length}/12）</span>
                <input value={odd} onChange={(e) => setOdd(e.target.value)} placeholder="例: K S T N H M Y R W G Z D" />
              </label>
              <label className="field">
                <span className="field-label">偶数番号の 12 個（{splitLabelInput(even).length}/12）</span>
                <input value={even} onChange={(e) => setEven(e.target.value)} placeholder="例: A I U E O …" />
              </label>
              <button className="btn primary" onClick={() => apply(interleave(splitLabelInput(odd), splitLabelInput(even)))}>
                反映
              </button>
            </div>
          )}

          {dups.length > 0 && (
            <p className="warn small">
              同じ文字が複数のステッカーに振られています: {dups.join('、')}。手順は位置で管理しているので問題ありませんが、取り込み時にその文字は位置を特定できません。
            </p>
          )}

          <div>
            <div className="field-label">プリセット・コピー</div>
            <div className="row wrap">
              {PRESETS.map((p) => (
                <button key={p.id} className="btn small" onClick={() => confirm(`${PIECE_LABEL[pt]}の文字を「${p.name}」にしますか？`) && apply(p.labels)}>
                  {p.name}
                </button>
              ))}
              {PIECE_TYPES.filter((o) => o !== pt).map((o) => (
                <button
                  key={o}
                  className="btn small ghost"
                  onClick={() => confirm(`${PIECE_LABEL[o]}の文字を${PIECE_LABEL[pt]}にコピーしますか？`) && setPiece(pt, { labels: { ...pieces[o].labels } })}
                >
                  {PIECE_LABEL[o]}からコピー
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
