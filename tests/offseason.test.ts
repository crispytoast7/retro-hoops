import { describe, expect, test } from 'vitest';
import { newLeague } from '../src/core/gen/league';
import { CAMP_DRILLS, CAMP_SHOTS, advanceOffseason, awardCredits, campDrillXp, campDrillsLeft, chooseTeam, finishCampDrill, startCampDrill } from '../src/core/offseason/offseason';
import { levelOfPlayer, xpOfPlayer } from '../src/core/org/xp';
import { Rng } from '../src/core/rng';
import { CALENDARS } from '../src/core/season/calendar';
import { advance } from '../src/core/season/flow';
import type { Save } from '../src/core/types';

function mk(seed = 6, team = 5): { save: Save; rng: Rng } {
  const save = newLeague({ seed, coachName: 'T', coachLook: { skin: 0, hair: 0, hairColor: 0 }, settings: { sound: false, difficulty: 'normal', haptics: false }, calendar: CALENDARS.classic });
  const rng = new Rng(save.rng);
  chooseTeam(save, team, rng);
  return { save, rng };
}
/** Sim to the start of the offseason. Returns the credits held just before the final week was played. */
function toOffseason(save: Save, rng: Rng): void {
  for (let i = 0; i < 60 && save.phase !== 'offseason'; i++) { save.owner.approval = 60; advance(save, rng, 'simWeek'); }
  expect(save.phase).toBe('offseason');
}
const skipDraft = (save: Save, rng: Rng) => { while (save.offseason && save.offseason.step !== 'camp') { if (save.offseason.step === 'draft') { save.offseason.draftIdx = save.offseason.draftOrder.length; } advanceOffseason(save, rng); } };

describe('awards', () => {
  test('the Finals MVP plays for the champion and sits right after the MVP', () => {
    for (const seed of [2, 6, 9]) {
      const { save, rng } = mk(seed);
      toOffseason(save, rng);
      const h = save.history[save.history.length - 1];
      const names = h.awards.map(a => a.award);
      expect(names).toContain('Finals MVP');
      expect(names.indexOf('Finals MVP')).toBe(names.indexOf('MVP') + 1);
      const f = h.awards.find(a => a.award === 'Finals MVP')!;
      expect(f.teamId).toBe(h.championId);
      expect(save.teams[h.championId].roster).toContain(f.playerId);
      expect(save.players[f.playerId].awards).toContain(`Finals MVP (Y${h.year})`);
      expect(f.line).toBeTruthy();
      expect(names.filter(n => n === 'Finals MVP').length).toBe(1);
    }
  }, 30000);

  test('awards won by your players pay the club, once', () => {
    let paidSomewhere = false;
    for (let seed = 1; seed <= 8; seed++) {
      const { save, rng } = mk(seed, seed % 16);
      for (let i = 0; i < 60 && save.phase === 'regular'; i++) { save.owner.approval = 60; advance(save, rng, 'simWeek'); }
      // play the playoffs out a week at a time so the credits just before the offseason are known
      let before = save.credits;
      for (let i = 0; i < 10 && save.phase !== 'offseason'; i++) { save.owner.approval = 60; before = save.credits; advance(save, rng, 'simWeek'); }
      const h = save.history[save.history.length - 1];
      const mine = h.awards.filter(a => a.teamId === save.userTeamId);
      const rewards = save.offseason!.awardRewards ?? [];
      expect(rewards.length).toBe(mine.length);
      const sum = rewards.reduce((s, r) => s + r.credits, 0);
      expect(sum).toBe(mine.reduce((s, a) => s + awardCredits(a.award), 0));
      if (sum > 0) { paidSomewhere = true; expect(save.credits - before).toBeGreaterThanOrEqual(sum); }
      // moving through the offseason never pays again
      const held = save.credits;
      advanceOffseason(save, rng);
      expect(save.credits).toBe(held);
      expect(save.offseason!.awardRewards ?? []).toEqual(rewards);
    }
    expect(paidSomewhere).toBe(true);
    expect(awardCredits('MVP')).toBeGreaterThan(awardCredits('Sixth Man'));
    expect(awardCredits('All-League PG')).toBe(1);
  }, 30000);

  test('Most Improved needs a previous season', () => {
    const { save, rng } = mk(4);
    toOffseason(save, rng);
    expect(save.history[0].awards.some(a => a.award === 'Most Improved')).toBe(false);
    skipDraft(save, rng);
    advanceOffseason(save, rng); // camp -> season two
    expect(save.phase).toBe('regular');
    toOffseason(save, rng);
    const mi = save.history[1].awards.find(a => a.award === 'Most Improved');
    if (mi) expect(save.players[mi.playerId].seasons.length).toBeGreaterThan(0);
  }, 30000);
});

describe('summer progress', () => {
  test('every player on your roster gets a before and after', () => {
    const { save, rng } = mk(6);
    toOffseason(save, rng);
    expect(save.offseason!.progress).toBeUndefined();
    const rosterBefore = save.teams[save.userTeamId].roster.slice();
    advanceOffseason(save, rng); // awards -> retirements: the summer happens here
    const prog = save.offseason!.progress!;
    expect(prog.map(x => x.playerId).sort()).toEqual(rosterBefore.slice().sort());
    expect(prog.some(x => x.after !== x.before)).toBe(true);
    for (const x of prog) { expect(Math.abs(x.after - x.before)).toBeLessThan(15); }
  }, 30000);
});

describe('camp shootaround', () => {
  test('three sessions a camp, XP by makes', () => {
    const { save, rng } = mk(6);
    expect(startCampDrill(save, save.teams[5].roster[0])).toMatch(/camp/i); // not in the offseason
    toOffseason(save, rng);
    expect(campDrillsLeft(save)).toBe(0); // not at camp yet
    skipDraft(save, rng);
    expect(save.offseason!.step).toBe('camp');
    const id = save.teams[save.userTeamId].roster[0];
    expect(campDrillsLeft(save)).toBe(CAMP_DRILLS);
    expect(startCampDrill(save, -1)).toMatch(/roster/i);
    for (let i = 0; i < CAMP_DRILLS; i++) expect(startCampDrill(save, id)).toBeNull();
    expect(campDrillsLeft(save)).toBe(0);
    expect(startCampDrill(save, id)).toMatch(/No sessions/);
    // payout
    expect(campDrillXp(0)).toBe(0);
    expect(campDrillXp(CAMP_SHOTS)).toBeGreaterThan(campDrillXp(CAMP_SHOTS - 1));
    expect(campDrillXp(CAMP_SHOTS - 1)).toBeGreaterThan(campDrillXp(CAMP_SHOTS - 2) + 12);
    const p = save.players[id];
    const lvl = levelOfPlayer(p), xp = xpOfPlayer(p);
    const res = finishCampDrill(save, id, 3);
    expect(res.xp).toBe(campDrillXp(3));
    expect(levelOfPlayer(p) > lvl || xpOfPlayer(p) > xp).toBe(true);
    expect(finishCampDrill(save, id, 0)).toEqual({ xp: 0, levels: 0 });
    // a new season resets the count
    advanceOffseason(save, rng);
    expect(save.offseason).toBeNull();
  }, 30000);
});
