import { render } from 'preact';
import '@fontsource/press-start-2p';
import '@fontsource/vt323';
import './style.css';
import { initPwa } from './state/pwa';
import { boot } from './state/store';
import { App } from './ui/App';

const root = document.getElementById('app')!;
if (import.meta.env.DEV && location.search.includes('arcade')) {
  void import('./dev/arcadeTest').then(m => m.runArcadeTest(root));
} else {
  initPwa();
  void boot().finally(() => render(<App />, root));
}
