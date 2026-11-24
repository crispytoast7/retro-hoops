import { AllStarScreen } from './AllStar';
import { useEffect, useState } from 'preact/hooks';
import { kickMusic, setTrack } from '../audio/music';
import { unlockAudio } from '../audio/sfx';
import { markTip, prog } from '../core/org/progress';
import { applyUpdate, onUpdate, setCanAuto, updateWaiting } from '../state/pwa';
import { onAndroidBack } from '../state/native';
import { flush, hasSave, touch, useSave } from '../state/store';
import { ConfirmHost, ToastHost } from './kit';
import { route, useRoute } from './router';
import { BracketScreen } from './Bracket';
import { ChampionScreen } from './Champion';
import { CoachScreen } from './Coach';
import { FacilitiesScreen } from './Facilities';
import { FinancesScreen } from './Finances';
import { FiredScreen } from './Fired';
import { GameScreen } from './Game';
import { HistoryScreen } from './History';
import { HubScreen } from './Hub';
import { LineupScreen } from './Lineup';
import { NewGameScreen } from './NewGame';
import { NewsScreen } from './News';
import { OffseasonScreen } from './Offseason';
import { PlayerScreen } from './Player';
import { PostGameScreen } from './PostGame';
import { PracticeScreen } from './Practice';
import { ProgressHost } from './Tips';
import { RankingsScreen } from './Rankings';
import { RosterScreen } from './Roster';
import { ScheduleScreen } from './Schedule';
import { ScoutingScreen } from './Scouting';
import { SettingsScreen } from './Settings';
import { StaffScreen } from './Staff';
import { StandingsScreen } from './Standings';
import { StatsScreen } from './Stats';
import { TitleScreen } from './Title';
import { TradesScreen } from './Trades';

type ScreenFn = (p: { params: Record<string, any> }) => any;
const SCREENS: Record<string, ScreenFn> = {
  title: TitleScreen, newgame: NewGameScreen, hub: HubScreen, roster: RosterScreen, player: PlayerScreen,
  lineup: LineupScreen, staff: StaffScreen, facilities: FacilitiesScreen, finances: FinancesScreen,
  trades: TradesScreen, standings: StandingsScreen, schedule: ScheduleScreen, stats: StatsScreen,
  history: HistoryScreen, news: NewsScreen, rankings: RankingsScreen, game: GameScreen, postgame: PostGameScreen,
  offseason: OffseasonScreen, scouting: ScoutingScreen, settings: SettingsScreen, fired: FiredScreen, coach: CoachScreen, practice: PracticeScreen, allstar: AllStarScreen,
  bracket: BracketScreen, champion: ChampionScreen,
};

function WithSave(p: { C: ScreenFn; params: Record<string, any>; route: string }) {
  const save = useSave();
  useEffect(() => { if (save && !prog(save).seen.includes('v_' + p.route)) touch(s => markTip(s, 'v_' + p.route)); }, [p.route]);
  const t = save?.teams[save.userTeamId];
  return (
    <div class="app" style={t ? { '--team': t.colors.primary, '--team2': t.colors.secondary } as any : undefined}>
      <p.C params={p.params} />
      <ProgressHost route={p.route} />
    </div>
  );
}

/** Screens played on the court: nothing may pull the player out of them by accident. */
const onCourt = (): boolean => route().name === 'game' || route().name === 'practice' || route().name === 'allstar';
/** Press the screen's own "<" button, if it has one. */
function pressBack(): boolean {
  const backBtn = document.querySelector('.screen .topbar .btn.small') as HTMLElement | null;
  if (!backBtn || backBtn.textContent?.trim() !== '<') return false;
  backBtn.click();
  return true;
}

export function App() {
  const r = useRoute();
  useEffect(() => {
    const f = () => { unlockAudio(); kickMusic(); };
    window.addEventListener('pointerdown', f);
    return () => window.removeEventListener('pointerdown', f);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.repeat || (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'))) return;
      const k = e.key;
      const modal = document.querySelector('.modal, .moment');
      if (k === 'Enter') {
        // the main button of whatever is on top: a pop-up first, then the screen's footer
        const btn = (modal?.querySelector('.btn.primary:not(:disabled)') ?? (!modal ? document.querySelector('.screen .footer .btn.primary:not(:disabled)') : null)) as HTMLElement | null;
        if (btn) { e.preventDefault(); btn.click(); }
      } else if (k === 'Escape' && !modal && !onCourt()) {
        if (pressBack()) e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Android's back button: out of a menu screen like Escape; ignored on the court and while a pop-up
  // waits for an answer; off to the home screen from a screen with nowhere to go back to
  useEffect(() => onAndroidBack(() => (document.querySelector('.modal, .moment') || onCourt() ? 'stay' : pressBack())), []);
  useEffect(() => { setTrack(r.name === 'game' || r.name === 'practice' || r.name === 'allstar' ? 'game' : 'menu'); }, [r.name]);
  const C = SCREENS[r.name] ?? TitleScreen;
  const needsSave = r.name !== 'title' && r.name !== 'newgame' && r.name !== 'settings';
  return (
    <>
      {needsSave && hasSave() ? <WithSave key={r.name + JSON.stringify(r.params)} C={C} params={r.params} route={r.name} /> : <div class="app"><C key={r.name} params={r.params} /></div>}
      {r.name !== 'title' && r.name !== 'game' && r.name !== 'practice' && r.name !== 'allstar' && <UpdateBar />}
      <ToastHost />
      <ConfirmHost />
    </>
  );
}

// a new version found while the title screen is showing is applied at once
setCanAuto(() => route().name === 'title');

/** A new version is ready: offer it on any menu screen (the title screen has its own button). Never shown in a game. */
function UpdateBar() {
  const [upd, setUpd] = useState(updateWaiting());
  useEffect(() => onUpdate(() => setUpd(true)), []);
  if (!upd) return null;
  return (
    <div class="updatebar">
      <span class="grow">A new version of Retro Hoops is ready.</span>
      <button class="btn small good" onClick={() => { void flush().then(applyUpdate); }}>Update</button>
    </div>
  );
}
