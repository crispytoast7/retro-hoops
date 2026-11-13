import { render } from 'preact';
import './style.css';

function App() {
  return (
    <main class="boot">
      <h1>RETRO HOOPS</h1>
      <p>Tip-off soon. The deploy pipeline works.</p>
    </main>
  );
}

const root = document.getElementById('app')!;
if (import.meta.env.DEV && location.search.includes('arcade')) {
  void import('./dev/arcadeTest').then(m => m.runArcadeTest(root));
} else {
  render(<App />, root);
}
