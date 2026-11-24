import { describe, expect, test } from 'vitest';
import { newLeague } from '../src/core/gen/league';
import { chooseTeam } from '../src/core/offseason/offseason';
import { doPlan, edgeFor, ensureWeek, formOf, intel, isRivalGame, needsWeek, plansOpen, rivalOf, signSponsor, sponsorOf, sponsorOffers, sponsorOpen, sponsorProgress, weekState, withForm, quietWeek } from '../src/core/org/week';
import { Rng } from '../src/core/rng';
import { CALENDARS } from '../src/core/season/calendar';
import { advance, sideInput } from '../src/core/season/flow';
import { userGame } from '../src/core/season/schedule';
import type { Player, Save } from '../src/core/types';

function mk(seed = 6): { save: Save; rng: Rng } {
  const save = newLeague({ seed, coachName: 'T', coachLook: { skin: 0, hair: 0, hairColor: 0 }, settings: { sound: false, difficulty: 'normal', haptics: false }, calendar: CALENDARS.classic });
  const rng = new Rng(save.rng);
  chooseTeam(save, 5, rng);
  return { save, rng };
}
const play = (save: Save, rng: Rng, n = 1) => { for (let i = 0; i < n; i++) advance(save, rng, 'simGame'); };

describe('the weekly plan', () => {
  test('opens after the first game and deals one plan of each kind', () => {
    const { save, rng } = mk();
    expect(plansOpen(save)).toBe(false);
    play(save, rng);
    expect(plansOpen(save)).toBe(true);
    expect(needsWeek(save)).toBe(true);
    ensureWeek(save);
    const w = weekState(save);
    expect(w.hand.map(p => p.group)).toEqual(['train', 'prep', 'club']);
    expect(ensureWeek(save)).toBe(false); // same week: same hand
  });

  test('one move a week, and the hand changes week to week', () => {
    const { save, rng } = mk();
    play(save, rng);
    const seen = new Set<string>();
    let repeats = 0;
    for (let i = 0; i < 10; i++) {
      ensureWeek(save);
      const w = weekState(save);
      // a quiet week deals nothing
      if (quietWeek(save)) { expect(w.hand.length).toBe(0); play(save, rng); continue; }
      const ids = w.hand.map(p => p.id);
      if (ids.every(id => w.last.includes(id))) repeats++;
      ids.forEach(id => seen.add(id));
      const first = w.hand[0];
      expect(doPlan(save, first.id, rng)).toBeTruthy();
      expect(w.picked).toBe(first.id);
      expect(doPlan(save, w.hand[1].id, rng)).toBeNull(); // only one
      play(save, rng);
    }
    expect(repeats).toBe(0);
    expect(seen.size).toBeGreaterThanOrEqual(8);
  });

  test('every plan can be carried out', () => {
    const done = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const { save, rng } = mk(seed);
      play(save, rng, 6); // past the unlocks
      // give the situational plans something to work with
      const me = save.teams[save.userTeamId];
      save.players[me.roster[8]].morale = 20;
      save.players[me.roster[9]].injury = { weeks: 3, desc: 'sprained ankle' };
      for (let i = 0; i < 6 && save.phase === 'regular'; i++) {
        ensureWeek(save);
        const w = weekState(save);
        if (!w.hand.length) { play(save, rng); continue; } // a quiet week
        const plan = w.hand[(seed + i) % w.hand.length];
        const r = doPlan(save, plan.id, rng);
        expect(r, plan.id).toBeTruthy();
        expect(w.picked).toBe(plan.id);
        done.add(plan.id.startsWith('drill_') ? 'drill' : plan.id);
        play(save, rng);
      }
    }
    for (const id of ['drill', 'film', 'shoot', 'walk', 'sponsorday']) expect(done.has(id), id).toBe(true);
    expect(done.size).toBeGreaterThanOrEqual(12);
  }, 30000);

  test('a prep plan gives an edge for one game only', () => {
    const { save, rng } = mk();
    play(save, rng);
    ensureWeek(save);
    const w = weekState(save);
    w.hand[1] = { id: 'film', group: 'prep', title: 'Film', effect: '' };
    const dc = sideInput(save, save.userTeamId).dcStars;
    doPlan(save, 'film', rng);
    expect(edgeFor(save)?.kind).toBe('film');
    expect(sideInput(save, save.userTeamId).dcStars).toBe(dc + 1.5);
    play(save, rng);
    expect(edgeFor(save)).toBeNull();
    expect(sideInput(save, save.userTeamId).dcStars).toBe(dc);
  });

  test('a guaranteed win pays or costs', () => {
    let paid = 0, cost = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const { save, rng } = mk(seed);
      play(save, rng);
      ensureWeek(save);
      weekState(save).hand[1] = { id: 'guarantee', group: 'prep', title: 'G', effect: '' };
      doPlan(save, 'guarantee', rng);
      const posts = advance(save, rng, 'simGame');
      const post = posts[0];
      if (post.won) { expect(post.credits.some(c => c.label === 'Guarantee kept')).toBe(true); paid++; }
      else { expect(post.notes.some(n => !n.good)).toBe(true); cost++; }
    }
    expect(paid + cost).toBe(10);
  });
});

describe('form', () => {
  test('a hot player plays above his ratings, a cold one below', () => {
    const { save } = mk();
    const p = save.players[save.teams[5].roster[0]];
    expect(withForm(p)).toBe(p);
    (p as Player & { form?: number }).form = 2;
    expect(withForm(p).ratings.sht).toBe(Math.min(99, p.ratings.sht + 4));
    expect(withForm(p).id).toBe(p.id);
    (p as Player & { form?: number }).form = -1;
    expect(withForm(p).ratings.def).toBe(p.ratings.def - 2);
  });

  test('over a season players heat up and cool off, but most stay level', () => {
    let changes = 0, games = 0, hot = 0, cold = 0, slots = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const { save, rng } = mk(seed);
      while (save.phase === 'regular') {
        const posts = advance(save, rng, 'simGame');
        for (const p of posts) { changes += p.form.length; games++; }
        for (const id of save.teams[save.userTeamId].roster) { const f = formOf(save.players[id]); slots++; if (f > 0) hot++; if (f < 0) cold++; expect(Math.abs(f)).toBeLessThanOrEqual(2); }
      }
    }
    expect(games).toBe(84);
    expect(changes / games).toBeGreaterThan(1);
    expect(changes / games).toBeLessThan(6);
    expect(hot / slots).toBeGreaterThan(0.05);
    expect(cold / slots).toBeGreaterThan(0.05);
    expect((hot + cold) / slots).toBeLessThan(0.6);

  }, 30000);
});

describe('rivals and stakes', () => {
  test('rivals come in pairs inside a conference', () => {
    const { save } = mk();
    for (const t of save.teams) {
      const r = rivalOf(save, t.id);
      expect(r).not.toBe(t.id);
      expect(rivalOf(save, r)).toBe(t.id);
      expect(save.teams[r].conf).toBe(t.conf);
    }
    expect(save.schedule.some(g => isRivalGame(save, g) && (g.homeId === 5 || g.awayId === 5))).toBe(true);
  });

  test('the hub knows the opponent and the playoff race', () => {
    const { save, rng } = mk();
    play(save, rng, 4);
    const info = intel(save, userGame(save)!);
    expect(info.star).toBeTruthy();
    expect(info.race).toMatch(/in the (East|West)/);
    expect(info.race).toMatch(/Top 4/);
  });
});

describe('sponsor deals', () => {
  test('three offers, one signed, paid once when the target is met', () => {
    const { save, rng } = mk();
    expect(sponsorOpen(save)).toBe(false);
    play(save, rng, 3);
    expect(sponsorOpen(save)).toBe(true);
    const offers = sponsorOffers(save);
    expect(offers.map(o => o.tier)).toEqual(['Safe', 'Solid', 'Bold']);
    expect(new Set(offers.map(o => o.kind)).size).toBe(3);
    expect(offers[2].credits).toBeGreaterThan(offers[0].credits);
    signSponsor(save, 0);
    expect(sponsorOpen(save)).toBe(false);
    const s = sponsorOf(save)!;
    // make it a wins deal he is about to meet
    s.kind = 'wins'; s.target = 1; s.base = save.teams[5].record.w;
    expect(sponsorProgress(save, s)).toEqual([0, 1]);
    const credits = save.credits;
    let bonus = 0;
    while (save.phase === 'regular' && !s.paid) {
      const before = save.credits;
      const posts = advance(save, rng, 'simGame');
      if (s.paid) { bonus = posts[0].credits.find(c => c.label.endsWith('bonus'))?.amount ?? 0; expect(save.credits - before).toBeGreaterThanOrEqual(s.credits); }
    }
    expect(s.paid).toBe(true);
    expect(bonus).toBe(s.credits);
    expect(save.credits).toBeGreaterThan(credits);
  });
});

describe('the league reacts to you', () => {
  test('a new coach starts on the weakest roster, with a gentle court and a patient owner', async () => {
    const { worstTeam, chooseTeam: choose } = await import('../src/core/offseason/offseason');
    const { teamStrength } = await import('../src/core/gm/value');
    const { challenge, CHALLENGE_START } = await import('../src/core/org/progress');
    const { checkFired } = await import('../src/core/org/people');
    const save = newLeague({ seed: 9, coachName: 'T', coachLook: { skin: 0, hair: 0, hairColor: 0 }, settings: { sound: false, difficulty: 'normal', haptics: false }, calendar: CALENDARS.classic });
    const w = worstTeam(save);
    for (const t of save.teams) expect(teamStrength(save, t)).toBeGreaterThanOrEqual(teamStrength(save, w));
    choose(save, w.id, new Rng(save.rng));
    expect(challenge(save)).toBe(CHALLENGE_START);
    save.owner.approval = 0;
    expect(checkFired(save)).toBe(false); // first season: safe
    save.year++;
    save.owner.approval = 0;
    expect(checkFired(save)).toBe(true);
  });

  test('struggling eases the court quickly, cruising tightens it, within limits', async () => {
    const { adaptChallenge, challenge, CHALLENGE_MIN, coachTips } = await import('../src/core/org/progress');
    const { save } = mk();
    const start = challenge(save);
    adaptChallenge(save, 1, 11);
    const eased = challenge(save);
    expect(eased).toBeLessThan(start - 0.15);
    for (let i = 0; i < 6; i++) adaptChallenge(save, 0, 11);
    expect(challenge(save)).toBe(CHALLENGE_MIN);
    for (let i = 0; i < 12; i++) adaptChallenge(save, 10, 11);
    expect(challenge(save)).toBe(2.6);
    const tips = coachTips({ moments: 11, scored: 2, turnovers: 4, wayOff: 3, shotClock: 0, fakes: 0, passes: 0 }, 'normal', CHALLENGE_MIN);
    expect(tips.length).toBe(3);
    expect(tips[0]).toMatch(/losing the ball/);
    expect(tips[2]).toMatch(/Rookie/);
    expect(coachTips({ moments: 11, scored: 7, turnovers: 4, wayOff: 3, shotClock: 0, fakes: 0, passes: 0 }, 'normal', 1)).toEqual([]);
  });

  test("winners get everyone's best game and strugglers are taken lightly", async () => {
    const { pressure, withPressure } = await import('../src/core/org/week');
    const { buildSetup } = await import('../src/core/season/flow');
    const { save, rng } = mk();
    expect(pressure(save)).toBe(0);
    const me = save.teams[save.userTeamId];
    me.record.w = 9; me.record.l = 1;
    expect(pressure(save)).toBeGreaterThanOrEqual(2);
    const g = userGame(save)!;
    const oppId = g.homeId === me.id ? g.awayId : g.homeId;
    const setup = buildSetup(save, g, 0);
    const oppSide = setup.home.team.id === oppId ? setup.home : setup.away, mySide = setup.home.team.id === oppId ? setup.away : setup.home;
    const real = save.players[oppSide.players[0].id];
    expect(oppSide.players[0].ratings.def).toBe(Math.min(99, real.ratings.def + pressure(save)));
    expect(mySide.players[0].ratings.def).toBe(save.players[mySide.players[0].id].ratings.def);
    me.record.w = 1; me.record.l = 9;
    expect(pressure(save)).toBeLessThanOrEqual(-1);
    expect(pressure(save)).toBeGreaterThanOrEqual(-2);
    expect(withPressure(real, 0)).toBe(real);
    // last year's champions carry a target all season
    me.record.w = 0; me.record.l = 0;
    save.history.push({ year: save.year, championId: me.id, runnerUpId: 0, mvp: null, awards: [], userTeamId: me.id, userW: 12, userL: 2, userPlayoff: 'champ' });
    save.year++;
    expect(pressure(save)).toBe(3);
    void rng;
  });
});
