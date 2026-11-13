import { render } from 'preact';
import '@fontsource/press-start-2p';
import '@fontsource/vt323';
import './style.css';
import { boot } from './state/store';
import { App } from './ui/App';

const root = document.getElementById('app')!;
if (import.meta.env.DEV && location.search.includes('arcade')) {
  void import('./dev/arcadeTest').then(m => m.runArcadeTest(root));
} else {
  void boot().finally(() => render(<App />, root));
}
