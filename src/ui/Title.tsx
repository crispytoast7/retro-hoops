import { hasSave, getSave } from '../state/store';
import { Btn, confirmDialog, fullName } from './kit';
import { nav, reset } from './router';

export function TitleScreen(_p: { params: Record<string, any> }) {
  const save = hasSave() ? getSave() : null;
  const ready = save && save.schedule.length > 0;
  const fresh = async () => {
    if (ready && !(await confirmDialog('Starting a new game replaces your current franchise. Export it first from Settings if you want to keep it.', 'New game'))) return;
    nav('newgame');
  };
  return (
    <div class="screen">
      <div class="title">
        <div class="logo">RETRO<span>HOOPS</span></div>
        <div class="dim">Run the franchise. Play the big possessions.</div>
        <div style={{ height: '8px' }} />
        {ready && <Btn kind="primary big" onClick={() => reset('hub')}>Continue</Btn>}
        {ready && <div class="dim">{save!.coach.name} · {fullName(save!.teams[save!.userTeamId])} · Season {save!.year}</div>}
        <Btn kind={ready ? '' : 'primary big'} onClick={fresh}>New Game</Btn>
        <Btn onClick={() => nav('settings')}>Settings</Btn>
      </div>
    </div>
  );
}
