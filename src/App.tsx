import { useEffect } from 'react';
import { AlgsView } from './ui/AlgsView';
import { HomeView, type Tab } from './ui/HomeView';
import { ExportPanel, ImportPanel } from './ui/ImportExport';
import { PairsView } from './ui/PairsView';
import { PracticeView } from './ui/PracticeView';
import { SchemeEditor } from './ui/SchemeEditor';
import { usePersisted } from './ui/shared';
import { SyncPanel } from './ui/SyncPanel';
import { BlddbPanel } from './ui/BlddbPanel';
import { useStore } from './data/store';
import { initSync } from './sync/firebase';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: 'ホーム', icon: '⌂' },
  { id: 'algs', label: '手順', icon: '⟲' },
  { id: 'pairs', label: 'ペア', icon: 'あ' },
  { id: 'practice', label: '練習', icon: '▶' },
  { id: 'settings', label: '設定', icon: '⚙' },
];

export function App() {
  const [tab, setTab] = usePersisted<Tab>('tab', 'home');

  useEffect(() => {
    // ブラウザがデータを勝手に消さないようにお願いする（対応ブラウザのみ）
    navigator.storage?.persist?.().catch(() => undefined);
    // 保存済みのデータを読み込んでから同期を始める
    const begin = () => initSync().catch(() => undefined);
    if (useStore.persist.hasHydrated()) begin();
    else return useStore.persist.onFinishHydration(begin);
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);

  return (
    <div className="app">
      <header className="topbar">
        <h1>BLD Trainer</h1>
        <nav className="tabs-top" aria-label="メニュー">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {tab === 'home' && <HomeView go={setTab} />}
        {tab === 'algs' && <AlgsView />}
        {tab === 'pairs' && <PairsView />}
        {tab === 'practice' && <PracticeView />}
        {tab === 'settings' && (
          <div className="page">
            <SyncPanel />
            <SchemeEditor />
            <ImportPanel />
            <BlddbPanel />
            <ExportPanel />
          </div>
        )}
      </main>
      <nav className="tabs-bottom" aria-label="メニュー">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            <span className="tab-icon" aria-hidden>
              {t.icon}
            </span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
