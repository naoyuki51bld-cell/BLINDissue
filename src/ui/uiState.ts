import { useEffect } from 'react';
import { create } from 'zustand';

/** 練習中はメニュー（タブ）を隠す */
export const useUi = create<{ immersive: number }>()(() => ({ immersive: 0 }));

export function useImmersive() {
  useEffect(() => {
    useUi.setState((s) => ({ immersive: s.immersive + 1 }));
    return () => useUi.setState((s) => ({ immersive: Math.max(0, s.immersive - 1) }));
  }, []);
}
