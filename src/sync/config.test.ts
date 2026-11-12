import { describe, expect, it } from 'vitest';
import { parseConfig } from './firebase';

describe('firebase config parsing', () => {
  it('accepts the JS snippet copied from the Firebase console', () => {
    const snippet = `// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyExample",
  authDomain: "bld-trainer.firebaseapp.com",
  projectId: "bld-trainer",
  storageBucket: "bld-trainer.appspot.com",
  messagingSenderId: "1234",
  appId: "1:1234:web:abcd",
};`;
    expect(parseConfig(snippet)).toMatchObject({ apiKey: 'AIzaSyExample', projectId: 'bld-trainer' });
  });
  it('accepts JSON and rejects junk', () => {
    expect(parseConfig('{"apiKey":"k","projectId":"p","authDomain":"a","appId":"x"}')?.apiKey).toBe('k');
    expect(parseConfig('hello')).toBeNull();
  });
});
