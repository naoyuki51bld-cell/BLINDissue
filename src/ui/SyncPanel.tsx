import { useState } from 'react';
import { activeConfig, builtInConfig, clearSavedConfig, resetPassword, saveConfig, savedConfig, signIn, signOut, syncNow, useSync } from '../sync/firebase';
import { Section } from './shared';

const GUIDE_URL = 'https://github.com/naoyuki51bld-cell/BLINDissue/blob/claude/rubiks-cube-blindfold-app-0c8m4z/docs/firebase-setup.md';

export function SyncPanel() {
  const { configured, status, email, lastSync, error } = useSync();
  const [configText, setConfigText] = useState('');
  const [mail, setMail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const config = activeConfig();

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="端末間の同期（Firebase）">
      {!configured && (
        <div className="stack">
          <p className="muted small">
            Firebase を使うと、スマホとパソコンなど複数の端末で手順・レターペア・練習記録を自動で同期できます。最初に Firebase のプロジェクトを作る必要があります（無料枠で使えます）。
            <br />
            <a href={GUIDE_URL} target="_blank" rel="noreferrer">
              設定の手順書を開く
            </a>
          </p>
          <label className="field">
            <span className="field-label">Firebase の設定（firebaseConfig）を貼り付け</span>
            <textarea
              rows={6}
              value={configText}
              onChange={(e) => setConfigText(e.target.value)}
              placeholder={'const firebaseConfig = {\n  apiKey: "…",\n  authDomain: "….firebaseapp.com",\n  projectId: "…",\n  …\n};'}
              spellCheck={false}
            />
          </label>
          <button
            className="btn primary"
            disabled={!configText.trim()}
            onClick={() => {
              if (saveConfig(configText)) window.location.reload();
              else setMessage('設定を読み取れませんでした。Firebase コンソールの「SDK の設定と構成」にある firebaseConfig の { } の部分を丸ごと貼り付けてください。');
            }}
          >
            保存して再読み込み
          </button>
        </div>
      )}

      {configured && !email && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => signIn(mail.trim(), password, false));
          }}
        >
          <p className="muted small">プロジェクト: {config?.projectId}。すべての端末で同じメールアドレスとパスワードでログインしてください。</p>
          <label className="field">
            <span className="field-label">メールアドレス</span>
            <input type="email" autoComplete="email" value={mail} onChange={(e) => setMail(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">パスワード（6 文字以上）</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <div className="row wrap">
            <button className="btn primary" type="submit" disabled={busy || !mail || !password}>
              ログイン
            </button>
            <button className="btn" type="button" disabled={busy || !mail || !password} onClick={() => run(() => signIn(mail.trim(), password, true))}>
              はじめて使う（アカウント作成）
            </button>
            <button
              className="link"
              type="button"
              disabled={!mail}
              onClick={() => run(async () => {
                await resetPassword(mail.trim());
                setMessage('パスワード再設定のメールを送りました。');
              })}
            >
              パスワードを忘れた
            </button>
          </div>
        </form>
      )}

      {configured && email && (
        <div className="stack">
          <div className="row wrap">
            <span className={`conn-dot ${status === 'synced' ? 'connected' : status === 'syncing' ? 'connecting' : ''}`} aria-hidden />
            <span>
              {email} で同期中
              {status === 'syncing' && '（送受信中…）'}
              {status === 'synced' && lastSync && `（最終同期 ${new Date(lastSync).toLocaleTimeString()}）`}
            </span>
          </div>
          <p className="muted small">変更は数秒後に自動で送られ、ほかの端末の変更もすぐに反映されます。同じ項目を別々の端末で変えた場合は、あとから変えた方が残ります。</p>
          <div className="row wrap">
            <button className="btn small" onClick={() => syncNow()}>
              今すぐ同期
            </button>
            <button className="btn small ghost" onClick={() => run(() => signOut())}>
              ログアウト
            </button>
          </div>
        </div>
      )}

      {(error || message) && <p className="error small">{message || error}</p>}

      {configured && (
        <details>
          <summary className="muted small">Firebase の設定について</summary>
          <p className="muted small">
            {savedConfig() ? 'この端末に保存した設定を使っています。' : builtInConfig() ? 'アプリに組み込まれた設定を使っています。' : ''}
          </p>
          {savedConfig() && (
            <button
              className="btn small danger"
              onClick={() => {
                if (confirm('この端末に保存した Firebase の設定を消しますか？（データは消えません）')) {
                  clearSavedConfig();
                  window.location.reload();
                }
              }}
            >
              この端末の設定を消す
            </button>
          )}
        </details>
      )}
    </Section>
  );
}
