import { useState } from 'react';
import { PIECE_LABEL, PIECE_TYPES, STICKER_IDS, stickerName, VALID_SIZES, type PieceType, type StickerId } from '../cube/pieces';
import { duplicateLabels, labelsFromList, PRESETS, splitLabelInput } from '../data/schemes';
import { useStore } from '../data/store';
import { CubeNet } from './CubeNet';
import { BufferOrderEditor } from './BufferOrder';
import { PieceTabs, Section, usePersisted } from './shared';


/** 展開図の上で文字を直接書き換える。Enter / Tab で次のステッカーへ */
type Which = 'first' | 'second';
const setKey = (w: Which) => (w === 'first' ? 'labels' : 'labels2');

function EditableNet({
  pt,
  order,
  which = 'first',
  title,
  maxWidth = 520,
}: {
  pt: PieceType;
  order: StickerId[];
  which?: Which;
  title?: string;
  maxWidth?: number;
}) {
  const cfg = useStore((s) => s.pieces[pt]);
  const setPiece = useStore((s) => s.setPiece);
  const [editing, setEditing] = useState<StickerId | null>(null);
  return (
    <div className="stack">
      {title && <div className="field-label">{title}</div>}
      <CubeNet
        n={cfg.size}
        pieceType={pt}
        labels={which === 'first' ? cfg.labels : cfg.labels2 ?? {}}
        marks={[{ id: cfg.buffer, kind: 'buffer' }]}
        showNumbers
        maxWidth={maxWidth}
        onSlotClick={(id) => setEditing(id)}
        editingId={editing}
        onEditDone={(id, value, go) => {
          const v = value.trim();
          const labels = useStore.getState().pieces[pt][setKey(which)] ?? {};
          if (v !== (labels[id] ?? '')) setPiece(pt, { [setKey(which)]: { ...labels, [id]: v } });
          if (go === 'stay') {
            setEditing((cur) => (cur === id ? null : cur));
            return;
          }
          const i = order.indexOf(id);
          const next = order[(i + (go === 'next' ? 1 : order.length - 1)) % order.length];
          setEditing(go === 'next' && i === order.length - 1 ? null : next);
        }}
      />
    </div>
  );
}

export function SchemeEditor() {
  const [pt, setPt] = usePersisted<PieceType>('scheme.pt', 'corner');
  const cfg = useStore((s) => s.pieces[pt]);
  const pieces = useStore((s) => s.pieces);
  const setPiece = useStore((s) => s.setPiece);
  const [mode, setMode] = usePersisted<'net' | 'list' | 'bulk'>('scheme.mode2', 'net');
  const [target, setTarget] = useState<Which>('first');
  const dual = !!cfg.dual;
  const first = cfg.labels;
  const second = cfg.labels2 ?? {};
  const dupsFirst = duplicateLabels(first);
  const dupsSecond = dual ? duplicateLabels(second) : [];

  const applyTo = (w: Which, list: string[]) => setPiece(pt, { [setKey(w)]: labelsFromList(list) });
  const listOf = (w: Which) => STICKER_IDS.map((id) => (w === 'first' ? first : second)[id] ?? '');
  const setDual = (on: boolean) => {
    // はじめて 2 セットにするときは、2 文字目の文字を 1 文字目と同じ内容で始める
    const hasSecond = Object.values(second).some(Boolean);
    setPiece(pt, on && !hasSecond ? { dual: true, labels2: { ...first } } : { dual: on });
  };

  return (
    <Section title="文字の割り振りとバッファ">
      <PieceTabs value={pt} onChange={setPt} />
      <label className="check dual-toggle">
        <input type="checkbox" checked={dual} onChange={(e) => setDual(e.target.checked)} />
        <span>
          <b>1 文字目と 2 文字目で別の文字を使う</b>
          <br />
          <span className="muted small">例: 1 文字目は子音（K, S, T…）、2 文字目は母音（A, I, U…）。ペアは「1 文字目の文字 + 2 文字目の文字」になります（K + A → KA）。</span>
        </span>
      </label>
      <div className="segmented">
        <button className={mode === 'net' ? 'active' : ''} onClick={() => setMode('net')}>
          展開図で編集
        </button>
        <button className={mode === 'list' ? 'active' : ''} onClick={() => setMode('list')}>
          一覧で編集
        </button>
        <button className={mode === 'bulk' ? 'active' : ''} onClick={() => setMode('bulk')}>
          まとめて入力
        </button>
      </div>

      {mode === 'net' && (
        <>
          {dual ? (
            <div className="net-pair">
              <EditableNet pt={pt} order={STICKER_IDS} which="first" title="1 文字目に使う文字" maxWidth={440} />
              <EditableNet pt={pt} order={STICKER_IDS} which="second" title="2 文字目に使う文字" maxWidth={440} />
            </div>
          ) : (
            <EditableNet pt={pt} order={STICKER_IDS} />
          )}
          <p className="muted small">
            ステッカーを押すと、その場で文字を書き換えられます。Enter（または Tab）で次の番号のステッカーへ進みます。小さい数字は番号（Speffz と同じ並び: U 面の左上から時計回り → L → F → R → B → D）、★ はバッファです。
          </p>
        </>
      )}

      {mode === 'list' && (
        <div className="label-grid">
          {STICKER_IDS.map((id, i) => (
            <div key={id} className={id === cfg.buffer ? 'label-cell buffer' : 'label-cell'}>
              <span className="muted small">
                {i + 1}. {stickerName(pt, id)}
              </span>
              {(dual ? (['first', 'second'] as Which[]) : (['first'] as Which[])).map((w) => (
                <input
                  key={`${pt}-${id}-${w}-${(w === 'first' ? first : second)[id] ?? ''}`}
                  aria-label={`${stickerName(pt, id)} の${w === 'first' ? '1' : '2'}文字目`}
                  placeholder={dual ? (w === 'first' ? '1文字目' : '2文字目') : ''}
                  defaultValue={(w === 'first' ? first : second)[id] ?? ''}
                  onBlur={(e) => {
                    const cur = useStore.getState().pieces[pt][setKey(w)] ?? {};
                    if (e.target.value.trim() !== (cur[id] ?? '')) setPiece(pt, { [setKey(w)]: { ...cur, [id]: e.target.value.trim() } });
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {mode === 'bulk' && (
        <div className="stack">
          <BulkText key={`${pt}-first`} title={dual ? '1 文字目に使う文字（24 個）' : '24 個の文字'} initial={listOf('first')} onApply={(l) => applyTo('first', l)} />
          {dual && <BulkText key={`${pt}-second`} title="2 文字目に使う文字（24 個）" initial={listOf('second')} onApply={(l) => applyTo('second', l)} />}
        </div>
      )}

      {(dupsFirst.length > 0 || dupsSecond.length > 0) && (
        <p className="warn small">
          同じ文字が複数のステッカーに振られています: {[...dupsFirst, ...dupsSecond].join('、')}。手順は位置で管理しているので問題ありませんが、取り込み時にその文字は位置を特定できません。
        </p>
      )}

      <div className="row wrap">
        <label className="field inline">
          <span className="field-label">バッファ</span>
          <select value={cfg.buffer} onChange={(e) => setPiece(pt, { buffer: e.target.value })}>
            {STICKER_IDS.map((id) => (
              <option key={id} value={id}>
                {stickerName(pt, id)}（{first[id] || '—'}{dual ? `/${second[id] || '—'}` : ''}）
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
      <p className="muted small">バッファを変えると、そのバッファ用の手順表に切り替わります（元の手順は消えません）。手順タブからも切り替えられます。</p>
      <div>
        <div className="field-label">バッファの順番（フローティング）</div>
        <BufferOrderEditor pt={pt} />
      </div>

      <div className="stack">
        <div className="field-label">プリセット・コピー</div>
        {dual && (
          <div className="segmented">
            <button className={target === 'first' ? 'active' : ''} onClick={() => setTarget('first')}>
              1 文字目に適用
            </button>
            <button className={target === 'second' ? 'active' : ''} onClick={() => setTarget('second')}>
              2 文字目に適用
            </button>
          </div>
        )}
        <div className="row wrap">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              className="btn small"
              onClick={() => confirm(`${PIECE_LABEL[pt]}の${dual ? (target === 'first' ? '1 文字目の' : '2 文字目の') : ''}文字を「${p.name}」にしますか？`) && applyTo(dual ? target : 'first', p.labels)}
            >
              {p.name}
            </button>
          ))}
          {PIECE_TYPES.filter((o) => o !== pt).map((o) => (
            <button
              key={o}
              className="btn small ghost"
              onClick={() =>
                confirm(`${PIECE_LABEL[o]}の文字の設定（1 文字目・2 文字目とも）を${PIECE_LABEL[pt]}にコピーしますか？`) &&
                setPiece(pt, { labels: { ...pieces[o].labels }, labels2: { ...(pieces[o].labels2 ?? {}) }, dual: !!pieces[o].dual })
              }
            >
              {PIECE_LABEL[o]}からコピー
            </button>
          ))}
        </div>
      </div>
    </Section>
  );
}

function BulkText({ title, initial, onApply }: { title: string; initial: string[]; onApply: (list: string[]) => void }) {
  const [text, setText] = useState(initial.join(' '));
  return (
    <label className="field">
      <span className="field-label">
        {title}（{splitLabelInput(text).length}/24）
      </span>
      <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="例: あ い う え お か …（スペース区切り。1 文字ずつなら区切りなしでも可）" />
      <button className="btn primary" type="button" onClick={() => onApply(splitLabelInput(text))}>
        反映
      </button>
    </label>
  );
}
