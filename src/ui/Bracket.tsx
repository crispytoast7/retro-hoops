// The playoff bracket, drawn as a bracket: each conference's two semifinals feed its final,
// and the two conference champions meet in the middle.
import { useEffect } from 'preact/hooks';
import { sfx } from '../audio/sfx';
import { markTip } from '../core/org/progress';
import { BracketView, Match, Moment, Slot, bracketView } from '../core/season/bracket';
import { seriesNeed } from '../core/season/calendar';
import type { Save } from '../core/types';
import { touch, useSave } from '../state/store';
import { Btn, Panel, Screen, confName, fullName } from './kit';
import { back } from './router';

function Row({ save, s, decided, wide }: { save: Save; s: Slot; decided: boolean; wide?: boolean }) {
  if (s.teamId === null) return <div class="bk-row tbd">{s.label}</div>;
  const t = save.teams[s.teamId];
  const mine = t.id === save.userTeamId;
  return (
    <div class={`bk-row ${s.won ? 'won' : decided ? 'lost' : ''} ${mine ? 'me' : ''}`}>
      <span class="bk-seed">{s.seed}</span>
      <span class="swatch" style={{ background: t.colors.primary, boxShadow: `3px 0 0 ${t.colors.secondary}`, marginRight: '3px' }} />
      <span class="grow nowrap">{t.abbr}{wide && <span class="bk-name"> {t.name}</span>}</span>
      {mine && <span class="bk-you">YOU</span>}
      <span class="bk-score">{s.score ?? ''}</span>
    </div>
  );
}
const Box = ({ save, m, wide }: { save: Save; m: Match; wide?: boolean }) => (
  <div class={`bk-box ${[m.a, m.b].some(s => s.teamId === save.userTeamId) ? 'mine' : ''}`}>
    <Row save={save} s={m.a} decided={m.decided} wide={wide} />
    <Row save={save} s={m.b} decided={m.decided} wide={wide} />
  </div>
);

function Conf({ save, v, conf }: { save: Save; v: BracketView; conf: number }) {
  const c = v.confs[conf];
  return (
    <div class="bk-conf">
      <div class="bk-caps"><span>{confName(conf).toUpperCase()} · SEMIFINALS</span><span>{confName(conf).toUpperCase()} FINAL</span></div>
      <div class="bk-grid">
        <div class="bk-col"><Box save={save} m={c.semis[0]} /><Box save={save} m={c.semis[1]} /></div>
        <div class="bk-join" />
        <div class="bk-col mid"><Box save={save} m={c.final} /></div>
      </div>
    </div>
  );
}

export function Bracket({ save }: { save: Save }) {
  const v = bracketView(save);
  return (
    <div class="bk">
      <Conf save={save} v={v} conf={0} />
      <div class="bk-final">
        <div class="bk-link" />
        <div class="bk-caps one"><span>♛ CHAMPIONSHIP · BEST OF {seriesNeed(save, 3) * 2 - 1}</span></div>
        <Box save={save} m={v.final} wide />
        {v.championId != null && <div class="bk-champ">♛ {fullName(save.teams[v.championId]).toUpperCase()} ♛</div>}
        <div class="bk-link" />
      </div>
      <Conf save={save} v={v} conf={1} />
    </div>
  );
}

/** Full-screen bracket. Opened with a `moment`, it stops the player to tell him where his run stands. */
export function BracketScreen({ params }: { params: Record<string, any> }) {
  const save = useSave();
  const m = params.moment as Moment | undefined;
  useEffect(() => {
    if (!m) return;
    touch(s => markTip(s, m.id));
    if (m.kind === 'advance' || m.kind === 'begin') { sfx.fanfare(); sfx.cheer(m.kind === 'advance'); } else sfx.groan();
  }, []);
  const projected = !save.playoffs;
  const good = m && (m.kind === 'advance' || m.kind === 'begin');
  return (
    <Screen title={projected ? 'Playoff Picture' : 'Playoffs'} onBack={m ? null : undefined} footer={m ? <Btn kind="primary big" class="grow" onClick={back}>Continue</Btn> : undefined}>
      {m && (
        <div class={`panel bk-moment ${good ? 'good' : 'bad'}`}>
          <h2>{m.title}</h2>
          <div>{m.text}</div>
        </div>
      )}
      <Panel title={projected ? 'IF THE SEASON ENDED TODAY' : `SEASON ${save.year} BRACKET`}>
        <Bracket save={save} />
      </Panel>
      <div class="dim" style={{ fontSize: '17px' }}>Top four in each conference. 1 plays 4, 2 plays 3, one game each round, the higher seed at home.</div>
    </Screen>
  );
}
