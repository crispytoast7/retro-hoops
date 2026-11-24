import { describe, expect, test } from 'vitest';
import { newLeague } from '../src/core/gen/league';
import { advanceOffseason, chooseTeam, draftDone, userDraftPick, userOnClock } from '../src/core/offseason/offseason';
import { draftLookback, gradeDraft } from '../src/core/org/draftlook';
import { prospectCeiling } from '../src/core/org/economy';
import { pendingMoment, resolveMoment } from '../src/core/org/moments';
import { ovr } from '../src/core/ratings';
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
const toDraft = (save: Save, rng: Rng) => {
  for (let i = 0; i < 60 && save.phase !== 'offseason'; i++) { advance(save, rng, 'simWeek'); const m = pendingMoment(save); if (m) resolveMoment(save, m.choices.findIndex(c => !c.disabled), rng); save.pendingEvent = null; }
  for (let i = 0; i < 10 && save.offseason!.step !== 'draft'; i++) advanceOffseason(save, rng);
};

describe('the draft matters', () => {
  test('the top of every class has star ceilings, and a few sleepers hide deep in it', () => {
    let stars = 0, sleepers = 0, classes = 0;
    for (const seed of [3, 6, 9, 14]) {
      const { save } = mk(seed);
      const cls = save.draftClass.map(id => save.players[id]);
      classes++;
      const room = (i: number) => cls[i].potential - ovr(cls[i]);
      stars += cls.slice(0, 6).filter(p => p.potential >= 82).length;
      sleepers += cls.slice(16).filter((p, k) => room(k + 16) >= 14).length;
      for (const p of cls) expect(p.potential).toBeGreaterThanOrEqual(ovr(p));
    }
    expect(stars / classes).toBeGreaterThanOrEqual(2);
    expect(sleepers).toBeGreaterThanOrEqual(2);
  });

  test('an unscouted ceiling is a range that holds the truth; scouting makes it exact', () => {
    const { save } = mk();
    for (const id of save.draftClass) {
      const p = save.players[id];
      const c = prospectCeiling(save, p);
      expect(c.known).toBe(false);
      expect(c.lo).toBeLessThanOrEqual(c.hi);
      p.scouted = true;
      expect(prospectCeiling(save, p)).toEqual({ known: true, lo: p.potential, hi: p.potential });
    }
  });

  test('your class gets a grade on draft night, and old classes get their steals and busts called out', () => {
    const { save, rng } = mk();
    toDraft(save, rng);
    for (let i = 0; i < 40 && !draftDone(save); i++) {
      if (userOnClock(save)) {
        const off = save.offseason!;
        const best = off.prospects.map(id => save.players[id]).sort((a, b) => b.potential - a.potential)[0];
        userDraftPick(save, best.id, rng);
      }
    }
    const g = gradeDraft(save, save.userTeamId);
    expect(g).not.toBeNull();
    expect(['A', 'B', 'C', 'D', 'F']).toContain(g!.grade);
    // taking the best ceiling on the board every time is a good night
    expect(['A', 'B', 'C']).toContain(g!.grade);
    expect(g!.line.length).toBeGreaterThan(20);
    // two seasons on, a late pick has blossomed: the lookback names him
    const late = Object.values(save.players).find(p => p.draft && p.draft.year === save.year && p.draft.round === 2)!;
    for (const k in late.ratings) (late.ratings as Record<string, number>)[k] = 92;
    save.year += 2;
    const before = save.news.length;
    draftLookback(save);
    const stories = save.news.slice(0, save.news.length - before);
    for (const n of stories) expect(n.text).toMatch(/The (steal|bust) of the Season \d+ draft/);
    expect(stories.some(n => n.text.includes(late.name) && /steal/.test(n.text))).toBe(true);
  }, 60000);
});
