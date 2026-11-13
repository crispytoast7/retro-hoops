import { DEAD_CAP_RATE, ROSTER_MIN } from '../core/constants';
import { marketSalary } from '../core/gm/value';
import { upgradeCost, upgradeRating, UPGRADE_POINTS } from '../core/org/economy';
import { releasePlayer } from '../core/org/roster';
import { careerStats, emptyStats, ovr } from '../core/ratings';
import { RATING_KEYS, RATING_NAMES } from '../core/types';
import type { StatLine, Trait } from '../core/types';
import { sfx } from '../audio/sfx';
import { act, touch, useSave } from '../state/store';
import { Btn, Meter, Panel, Screen, Sprite, Stars, avg, confirmDialog, fullName, money, pct, toast } from './kit';
import { back } from './router';

const TRAIT_DESC: Record<Trait, string> = {
  Leader: 'Steadies the room. A great captain.',
  Diva: 'Wants the spotlight, sulks on the bench, asks for more money.',
  'Hard Worker': 'Develops faster and responds well to a challenge.',
  Clutch: 'Shoots better late in close games.',
  Hothead: 'Takes losses badly. Handle with care.',
  Loyal: 'Gives his own team a discount and rarely asks out.',
  Mercenary: 'Follows the money.',
  'Quiet Pro': 'Does the job without complaint, starter or not.',
  Showman: 'Fans love him.',
  Lazy: 'Develops slowly. Skips the odd practice.',
};
const RATING_DESC: Record<string, string> = {
  sht: 'Bigger, slower shot meter. Range.', hnd: 'Dribble speed, crossovers, fewer steals.', pas: 'Faster passes, fewer interceptions.',
  spd: 'Movement on drives.', fin: 'Layups and dunks in traffic.', def: 'Steals, blocks, simulated defense.', reb: 'Boards at both ends.',
};

function StatRow({ label, s }: { label: string; s: StatLine }) {
  return (
    <tr>
      <td>{label}</td><td>{s.gp}</td><td>{avg(s.min, s.gp)}</td><td>{avg(s.pts, s.gp)}</td><td>{avg(s.orb + s.drb, s.gp)}</td><td>{avg(s.ast, s.gp)}</td>
      <td>{avg(s.stl, s.gp)}</td><td>{avg(s.blk, s.gp)}</td><td>{pct(s.fgm, s.fga)}</td><td>{pct(s.tpm, s.tpa)}</td><td>{pct(s.ftm, s.fta)}</td>
    </tr>
  );
}

export function PlayerScreen({ params }: { params: Record<string, any> }) {
  const save = useSave();
  const p = save.players[params.id];
  if (!p) return <Screen title="Player"><div class="dim">This player has left the league.</div></Screen>;
  const team = p.teamId !== null ? save.teams[p.teamId] : null;
  const mine = p.teamId === save.userTeamId;
  const prospect = p.scouted === false;
  const dead = p.contract.years > 0 ? Math.round(p.contract.salary * DEAD_CAP_RATE * 10) / 10 : 0;
  const career = careerStats(p);
  const upgrade = (k: (typeof RATING_KEYS)[number]) => {
    const err = act(s => upgradeRating(s, p.id, k));
    if (err) toast(err); else sfx.coin();
  };
  const release = async () => {
    if (save.teams[save.userTeamId].roster.length <= ROSTER_MIN) return toast(`You need at least ${ROSTER_MIN} players.`);
    if (!(await confirmDialog(`Release ${p.name}? ${dead > 0 ? `${money(dead)} stays on your cap as dead money until next offseason.` : ''}`, 'Release'))) return;
    act(s => { releasePlayer(s, p.id, { deadCap: true }); });
    toast(`${p.name} released.`, true);
    back();
  };
  return (
    <Screen title={p.name} team={team ?? undefined}>
      <Panel team>
        <div class="row" style={{ alignItems: 'flex-start', gap: '12px' }}>
          <Sprite player={p} team={team} scale={4} />
          <div class="col grow" style={{ gap: '4px' }}>
            <div class="row wrap"><span class="tag pos">{p.pos}</span><span>#{p.num}</span><span class="dim">Age {p.age}</span></div>
            <div class="row">{prospect ? <span class="dim">Unscouted prospect</span> : <Stars v={ovr(p)} big />}</div>
            <div class="dim nowrap">{team ? fullName(team) : p.retired ? 'Retired' : prospect || save.draftClass.includes(p.id) ? 'Draft prospect' : 'Free agent'}</div>
            {p.injury && <div class="bad">{p.injury.desc === 'suspended' ? 'Suspended' : `Injured: ${p.injury.desc}`}, {p.injury.weeks} wk</div>}
            {save.tradeDemands.includes(p.id) && <div class="bad">Has asked for a trade</div>}
          </div>
        </div>
      </Panel>

      {!prospect && (
        <Panel title="RATINGS">
          <div class="list">
            {RATING_KEYS.map(k => (
              <div class="item">
                <div class="grow"><div>{RATING_NAMES[k]}</div><div class="dim" style={{ fontSize: '16px' }}>{RATING_DESC[k]}</div></div>
                <Stars v={p.ratings[k]} />
                {mine && <Btn kind="small" disabled={p.ratings[k] >= 99 || save.credits < upgradeCost(save, p, k)} onClick={() => upgrade(k)} silent>+ ◉{upgradeCost(save, p, k)}</Btn>}
              </div>
            ))}
          </div>
          {mine && <div class="dim" style={{ fontSize: '16px', marginTop: '6px' }}>Spend credits to train a rating (+{UPGRADE_POINTS} points; half a star is about 6). You have ◉ {save.credits}. Cost rises with each star.</div>}
        </Panel>
      )}

      <Panel title="PROFILE">
        <div class="list">
          <div class="item"><div class="grow"><div>{p.trait}</div><div class="dim" style={{ fontSize: '16px' }}>{TRAIT_DESC[p.trait]}</div></div></div>
          {team && <div class="item"><Meter label="MORALE" value={p.morale} /></div>}
          <div class="item"><span class="grow">Contract</span><span>{p.teamId !== null ? `${money(p.contract.salary)} · ${p.contract.years} yr${p.contract.years === 1 ? '' : 's'} left` : prospect ? 'Rookie deal when drafted' : `Asks about ${money(marketSalary(p))}`}</span></div>
          {p.draft && <div class="item"><span class="grow">Drafted</span><span>Season {p.draft.year}, round {p.draft.round}, pick {p.draft.pick} ({save.teams[p.draft.teamId].abbr})</span></div>}
          {p.awards.length > 0 && <div class="item"><span class="grow">Awards</span><span class="gold right">{p.awards.join(', ')}</span></div>}
        </div>
      </Panel>

      {mine && (
        <div class="row">
          <Btn class="grow" kind={save.captainId === p.id ? 'good' : ''} onClick={() => { touch(s => { s.captainId = s.captainId === p.id ? null : p.id; }); toast(save.captainId === p.id ? `${p.name} is your captain. Morale holds up better after losses.` : 'Captaincy removed.', true); }}>
            {save.captainId === p.id ? 'Captain ✓' : 'Make Captain'}
          </Btn>
          <Btn kind="danger" onClick={release}>Release</Btn>
        </div>
      )}

      {(p.season.gp > 0 || p.seasons.length > 0) && (
        <Panel title="STATS (PER GAME)">
          <div class="scrollx">
            <table class="tbl">
              <thead><tr><th>SEASON</th><th>GP</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>FG</th><th>3P</th><th>FT</th></tr></thead>
              <tbody>
                {p.season.gp > 0 && <StatRow label={`Y${save.year} ${team?.abbr ?? ''}`} s={p.season} />}
                {p.seasons.slice().reverse().map(s => <StatRow label={`Y${s.year} ${save.teams[s.teamId]?.abbr ?? ''}`} s={s.stats} />)}
                <tr class="me"><StatRowCells s={career.gp ? career : emptyStats()} /></tr>
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </Screen>
  );
}
function StatRowCells({ s }: { s: StatLine }) {
  return (
    <>
      <td>Career</td><td>{s.gp}</td><td>{avg(s.min, s.gp)}</td><td>{avg(s.pts, s.gp)}</td><td>{avg(s.orb + s.drb, s.gp)}</td><td>{avg(s.ast, s.gp)}</td>
      <td>{avg(s.stl, s.gp)}</td><td>{avg(s.blk, s.gp)}</td><td>{pct(s.fgm, s.fga)}</td><td>{pct(s.tpm, s.tpa)}</td><td>{pct(s.ftm, s.fta)}</td>
    </>
  );
}
