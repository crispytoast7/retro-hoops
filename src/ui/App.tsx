import { useEffect } from 'preact/hooks';
import { kickMusic, setTrack } from '../audio/music';
import { unlockAudio } from '../audio/sfx';
import { markTip, prog } from '../core/org/progress';
import { hasSave, touch, useSave } from '../state/store';
import { ConfirmHost, ToastHost } from './kit';
import { useRoute } from './router';
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
  history: HistoryScreen, news: NewsScreen, game: GameScreen, postgame: PostGameScreen,
  offseason: OffseasonScreen, scouting: ScoutingScreen, settings: SettingsScreen, fired: FiredScreen, coach: CoachScreen, practice: PracticeScreen,
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

export function App() {
  const r = useRoute();
  useEffect(() => {
    const f = () => { unlockAudio(); kickMusic(); };
    window.addEventListener('pointerdown', f);
    return () => window.removeEventListener('pointerdown', f);
  }, []);
  useEffect(() => { setTrack(r.name === 'game' || r.name === 'practice' ? 'game' : 'menu'); }, [r.name]);
  const C = SCREENS[r.name] ?? TitleScreen;
  const needsSave = r.name !== 'title' && r.name !== 'newgame' && r.name !== 'settings';
  return (
    <>
      {needsSave && hasSave() ? <WithSave key={r.name + JSON.stringify(r.params)} C={C} params={r.params} route={r.name} /> : <div class="app"><C key={r.name} params={r.params} /></div>}
      <ToastHost />
      <ConfirmHost />
    </>
  );
}
