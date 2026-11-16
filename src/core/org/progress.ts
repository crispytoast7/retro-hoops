// Coach progression: feature unlocks, levels, perks, trophies, unlockable court styles.
import { clamp, ovr } from '../ratings';
import type { GameResult, Save } from '../types';
import { FACILITY_KEYS } from '../types';

// ---- storage -------------------------------------------------------------------------
export interface Progress {
  xp: number;
  /** Perk id -> rank. */
  perks: Record<string, number>;
  trophies: string[];
  /** Trophies earned but not yet shown. */
  fresh: string[];
  /** Career counters for hand-played highlights and deals. */
  counters: Record<string, number>;
  /** Explainers already read. */
  seen: string[];
  court: string;
}
/** The progress block, created on first use (older saves do not have it). */
export function prog(save: Save): Progress {
  const s = save as Save & { progress?: Progress };
  if (!s.progress) s.progress = { xp: 0, perks: {}, trophies: [], fresh: [], counters: {}, seen: [], court: 'classic' };
  return s.progress;
}

// ---- feature unlocks -----------------------------------------------------------------
export type Feature =
  | 'roster' | 'lineup' | 'schedule' | 'standings' | 'stats' | 'news' | 'coach'
  | 'facilities' | 'staff' | 'finances' | 'trades' | 'scouting' | 'history';
/** Career games needed before each area of the hub opens. */
export const UNLOCK_AT: Record<Feature, number> = {
  roster: 0, lineup: 0, schedule: 0, standings: 0,
  stats: 1, news: 1, coach: 2, facilities: 2, staff: 3, finances: 4, trades: 5, scouting: 6, history: 8,
};
export const careerGames = (save: Save): number => save.coach.w + save.coach.l + save.coach.playoffW + save.coach.playoffL;
export const isUnlocked = (save: Save, f: Feature): boolean =>
  save.coach.seasons > 0 || save.phase === 'offseason' || careerGames(save) >= UNLOCK_AT[f];
export const gamesToUnlock = (save: Save, f: Feature): number => Math.max(0, UNLOCK_AT[f] - careerGames(save));

// ---- explainers ----------------------------------------------------------------------
export interface Tip { id: string; title: string; text: string[]; go?: string; goLabel?: string }
const FEATURE_TIPS: Record<Feature, Tip | null> = {
  roster: null, lineup: null, schedule: null, standings: null,
  stats: { id: 'u_stats', title: 'Stats & News unlocked', text: ['Every game produces a full box score.', 'Stats shows your players, the league leaders and every team. News follows the league: results, injuries, trades.'], go: 'stats', goLabel: 'Open Stats' },
  news: null,
  coach: { id: 'u_coach', title: 'Coach profile unlocked', text: ['You earn coach XP from every game, more for wins and for highlight plays you make yourself.', 'Each level gives a perk point. Perks change how you play and how you run the club.', 'Trophies pay credits and unlock new court styles.'], go: 'coach', goLabel: 'Open Coach' },
  facilities: { id: 'u_facilities', title: 'Facilities unlocked', text: ['Credits (the gold coin, top right) come from wins, home crowds and highlight plays.', 'Spend them on four buildings: Arena, Training Center, Medical Center, Scouting Office.', 'Upgrades arrive the next week. Buildings wear down, so budget for maintenance.'], go: 'facilities', goLabel: 'Open Facilities' },
  staff: { id: 'u_staff', title: 'Staff unlocked', text: ['Hire an Offensive Coordinator (helps the possessions you play) and a Defensive Coordinator (helps the simulated defense).', 'Better coordinators cost more credits and want a coach with a reputation. Win, and they will come.', 'From now on, things will also happen in the locker room. Your choices matter.'], go: 'staff', goLabel: 'Open Staff' },
  finances: { id: 'u_finances', title: 'Finances unlocked', text: ['Every player has a contract: salary and years.', 'Finances shows your payroll against the salary cap. Signing a free agent needs room under the cap; you can go over it only to keep your own players, and never past the hard limit.', 'Players in their final year leave next summer unless you re-sign them.'], go: 'finances', goLabel: 'Open Finances' },
  trades: { id: 'u_trades', title: 'Trades & Free Agents unlocked', text: ['Propose trades to any team: players and draft picks. Their GM weighs age, contract and what his team needs.', 'Other teams will call you with offers, too.', 'Unsigned players are in the free-agent pool. The trade deadline falls a little past mid-season.'], go: 'trades', goLabel: 'Open Trades' },
  scouting: { id: 'u_scouting', title: 'Scouting unlocked', text: ['Next summer\'s draft class is already out there.', 'Unscouted prospects show rough rating ranges. A scouting report reveals the true ratings and the ceiling.', 'A better Scouting Office gives more reports each season.'], go: 'scouting', goLabel: 'Open Scouting' },
  history: { id: 'u_history', title: 'History unlocked', text: ['Champions, awards, your franchise record book, the Hall of Fame and your own coaching career are all kept here.'], go: 'history', goLabel: 'Open History' },
};
const STEP_TIPS: Record<string, Tip> = {
  awards: { id: 'o_awards', title: 'The offseason', text: ['The season is over. The offseason has six steps: awards, retirements, contracts, the draft, free agency and training camp.', 'First, the review: champions, awards and what the owner made of your year.'] },
  retirements: { id: 'o_retirements', title: 'Retirements', text: ['Everyone is a year older. Young players with room to grow improve; veterans past 30 start to fade.', 'Some old hands call it a career. The greats go to the Hall of Fame.'] },
  contracts: { id: 'o_contracts', title: 'Contracts', text: ['Players whose deals ran out are listed here with what they want.', 'You may go over the salary cap to re-sign your own players, but never past the hard limit. Anyone you do not re-sign leaves for free agency when you continue.', 'Unhappy players may refuse to come back at any price.'] },
  draft: { id: 'o_draft', title: 'The draft', text: ['Two rounds. The worst teams enter a lottery for the top three picks; the rest go in reverse order of record.', 'When you are on the clock, tap a prospect to draft him. Scouted prospects show true ratings and their ceiling.', 'Rookies sign fixed, cheap contracts. That is how good teams stay good.'] },
  freeAgency: { id: 'o_freeAgency', title: 'Free agency', text: ['Five days. Offer a salary and years; each player weighs money, your record, your facilities and your reputation.', 'You need room under the salary cap to sign someone. Over the cap, you can only offer minimum deals.', 'Other teams are bidding too. The best players sign on day one.'] },
  camp: { id: 'o_camp', title: 'Training camp', text: ['Last stop before the new season. Rating upgrades are 25% cheaper during camp.', 'Check your roster size and lineup, then start the season.'] },
};
const WELCOME: Tip = {
  id: 'welcome', title: 'Welcome, Coach',
  text: ['You have been handed the worst team in the league. You are the head coach and the general manager. The owner knows it is a rebuild: he will not fire you in your first season, and the worst teams get the best chance at the first pick in the draft.',
    'Each game you play about a dozen key moments by hand: fast breaks, pick-and-rolls, post-ups, free throws, the last shot. Score and your team goes on a run; waste one and the other side does.',
    'The club opens up as you go: facilities, staff, trades and more unlock over your first few games.',
    'Start with Practice: seven short drills teach every control. Then play your first game. The court is forgiving at first and gets harder as you get better.'],
  go: 'practice', goLabel: 'Go to Practice',
};
const WEEK_TIP: Tip = {
  id: 'week', title: 'Your week',
  text: ['Before every game you get one move, and three to pick from: make a player better for good, buy an edge for this game, or look after the club.',
    'The three change every week. What you pass on is gone.',
    'Your players also run hot and cold. A big night heats a player up and he plays above his ratings; a bad one cools him off. Check the lineup before you tip off.'],
};
/** The next explainer the player should see, or null. Purely derived from the save. */
export function nextTip(save: Save): Tip | null {
  const seen = prog(save).seen;
  if (!seen.includes('welcome')) return WELCOME;
  if (save.phase === 'offseason' && save.offseason) {
    const t = STEP_TIPS[save.offseason.step];
    if (t && !seen.includes(t.id)) return t;
    return null;
  }
  if (careerGames(save) >= 1 && !seen.includes(WEEK_TIP.id)) return WEEK_TIP;
  for (const f of Object.keys(FEATURE_TIPS) as Feature[]) {
    const t = FEATURE_TIPS[f];
    if (t && !seen.includes(t.id) && isUnlocked(save, f)) {
      // a coach who is past his first season has seen it all
      if (save.coach.seasons > 0) { seen.push(t.id); continue; }
      return t;
    }
  }
  return null;
}
export function markTip(save: Save, id: string): void { const s = prog(save).seen; if (!s.includes(id)) s.push(id); }

// ---- adaptive difficulty ---------------------------------------------------------------
/** Share of key moments the game steers you toward scoring in. */
const DDA_TARGET = 0.5;
/** How hard the court plays right now: 1 is the baseline, higher is harder. Adapts every game. */
export const challenge = (save: Save): number => (prog(save) as Progress & { dda?: number }).dda ?? 1;
/** After a hand-played game: scoring in most of your moments makes the next game harder, and the reverse. */
export function adaptChallenge(save: Save, scored: number, moments: number): void {
  if (moments < 4) return;
  const p = prog(save) as Progress & { dda?: number };
  const gap = scored / moments - DDA_TARGET;
  // it eases off quickly for someone who is struggling, and tightens a little faster for someone cruising
  const step = gap * 0.9 * (gap < -0.15 ? 1.3 : gap > 0.2 ? 1.25 : 1);
  p.dda = clamp((p.dda ?? 1) + step, CHALLENGE_MIN, 2.6);
}
/** The gentlest and the starting setting: a new coach begins below the baseline and it finds his level. */
export const CHALLENGE_MIN = 0.65, CHALLENGE_START = 0.85;
export function startChallenge(save: Save): void { (prog(save) as Progress & { dda?: number }).dda = CHALLENGE_START; }

// ---- coach's tips after a rough game ------------------------------------------------------
export interface MomentStats { moments: number; scored: number; turnovers: number; wayOff: number; shotClock: number; fakes: number; passes: number }
/** Up to two concrete pointers for someone who struggled in the moments he played. Empty when he did fine. */
export function coachTips(st: MomentStats, difficulty: string, challengeNow: number): string[] {
  if (st.moments < 4 || st.scored / st.moments >= 0.4) return [];
  const tips: [number, string][] = [];
  if (st.wayOff >= 2) tips.push([st.wayOff * 2, 'Your shots are leaving early. Hold SHOOT, watch the crosshair swing, and let go only when it is over the rim. Gold is good, green is a swish.']);
  if (st.turnovers >= 2) tips.push([st.turnovers * 2.2, 'You are losing the ball. Do not dribble into a defender: tap an open teammate (the green label) before he reaches you, or flick sideways to get past.']);
  if (st.shotClock >= 1) tips.push([st.shotClock * 3, 'The shot clock is beating you. If nothing is open after a few seconds, pass to a teammate and shoot from there.']);
  if (st.passes === 0) tips.push([2, 'You never passed. Tap a teammate with a green label: the man who catches it gets a moment before his defender arrives.']);
  if (st.fakes === 0 && st.wayOff + st.turnovers >= 2) tips.push([1.5, 'Try a pump fake: tap SHOOT with a defender on you. If he jumps, you are open.']);
  tips.push([1, 'Closer is easier. Drag toward the basket and keep going: near the rim he lays it in or dunks by himself.']);
  const out = tips.sort((a, b) => b[0] - a[0]).slice(0, 2).map(t => t[1]);
  if (difficulty !== 'easy' && challengeNow <= CHALLENGE_MIN + 0.05) out.push('Still tough? Settings has a Rookie difficulty with a steadier crosshair and slower defenders.');
  return out;
}

// ---- first-season checklist --------------------------------------------------------------
export interface Step { id: string; text: string; why: string; go: string; done: boolean }
const bump = (save: Save, key: string): void => { const c = prog(save).counters; c[key] = (c[key] ?? 0) + 1; };
/** Record that the player has done something the checklist cares about. */
export const note = (save: Save, key: 'facility' | 'hire' | 'train' | 'scout' | 'sign'): void => bump(save, key);
/** What a new coach should do next, in order. Empty once everything is done or after the first season. */
export function checklist(save: Save): Step[] {
  if (save.coach.seasons > 0) return [];
  const p = prog(save), c = p.counters, seen = (id: string) => p.seen.includes(id);
  const games = careerGames(save);
  const all: (Step & { when: boolean })[] = [
    { id: 'practice', text: 'Learn the controls in Practice', why: 'Seven short drills: move, shoot, fake, pass, drive, crossover.', go: 'practice', done: seen('practice_done'), when: true },
    { id: 'roster', text: 'Meet your players', why: 'Tap anyone for his star ratings. Stars decide who should shoot, handle and finish.', go: 'roster', done: seen('v_roster'), when: true },
    { id: 'lineup', text: 'Check your starting five', why: 'Your best five should start. Tap two players to swap them.', go: 'lineup', done: seen('v_lineup'), when: true },
    { id: 'game1', text: 'Play your first game', why: 'Press PLAY above. You take the key moments; what you do in them swings the rest of the game.', go: '', done: games >= 1, when: true },
    { id: 'captain', text: 'Name a team captain', why: 'Open a player and tap Make Captain. A captain steadies morale after losses.', go: 'roster', done: save.captainId !== null, when: games >= 1 },
    { id: 'facility', text: 'Upgrade or maintain a facility', why: 'Spend the credits you earn. Start with the Training Center or the Arena.', go: 'facilities', done: (c.facility ?? 0) > 0, when: isUnlocked(save, 'facilities') },
    { id: 'coachperk', text: 'Spend a perk point', why: 'Each coach level gives one. Perks change how you play and run the club.', go: 'coach', done: perkPointsSpent(save) > 0, when: isUnlocked(save, 'coach') && coachLevel(save) >= 2 },
    { id: 'hire', text: 'Hire a coordinator', why: 'An offensive coordinator steadies your crosshair; a defensive one helps the simulated defense.', go: 'staff', done: (c.hire ?? 0) > 0, when: isUnlocked(save, 'staff') },
    { id: 'train', text: 'Level up a player', why: 'Your players earn XP in games. When one levels up, open him and choose which rating improves.', go: 'roster', done: (c.train ?? 0) > 0, when: games >= 2 },
    { id: 'money', text: 'Look at your finances', why: 'Salaries, the cap, how much room you have, and whose contract is about to run out.', go: 'finances', done: seen('v_finances'), when: isUnlocked(save, 'finances') },
    { id: 'trade', text: 'Browse trades and free agents', why: 'See what other teams would give you, or sign someone who is unattached.', go: 'trades', done: seen('v_trades'), when: isUnlocked(save, 'trades') },
    { id: 'scout', text: 'Scout a draft prospect', why: 'A report shows his true ratings and how good he could become.', go: 'scouting', done: (c.scout ?? 0) > 0, when: isUnlocked(save, 'scouting') },
  ];
  return all.filter(s => s.when).map(({ when: _w, ...s }) => s);
}

// ---- levels --------------------------------------------------------------------------
export const MAX_LEVEL = 20;
/** Total XP needed to reach a level. */
export const xpFor = (level: number): number => Math.round(40 * (level - 1) * (level + 2));
export function levelOf(xp: number): number {
  let l = 1;
  while (l < MAX_LEVEL && xp >= xpFor(l + 1)) l++;
  return l;
}
export const coachLevel = (save: Save): number => levelOf(prog(save).xp);
export const RANKS = ['Rookie Coach', 'Assistant', 'Bench Boss', 'Tactician', 'Play Caller', 'Floor General', 'Strategist', 'Mastermind', 'Franchise Builder', 'Legend'];
export const rankName = (level: number): string => RANKS[Math.min(RANKS.length - 1, Math.floor((level - 1) / 2))];

// ---- perks ---------------------------------------------------------------------------
export interface Perk { id: string; name: string; desc: string; max: number; level: number; group: 'Court' | 'Club' }
export const PERKS: Perk[] = [
  { id: 'shooting', name: 'Shooting Coach', desc: 'Your crosshair swings 7% less per rank.', max: 3, level: 1, group: 'Court' },
  { id: 'handles', name: 'Ball-Handling Drills', desc: 'Crossovers work more often and defenders strip you less (6% per rank).', max: 3, level: 1, group: 'Court' },
  { id: 'passing', name: 'Playmaker', desc: 'Passes are 8% faster and harder to intercept per rank.', max: 2, level: 2, group: 'Court' },
  { id: 'rim', name: 'Rim Attack', desc: 'Layups and dunks go in 4% more often per rank.', max: 2, level: 3, group: 'Court' },
  { id: 'clutch', name: 'Clutch Play-Caller', desc: 'You play two more possessions per game per rank.', max: 2, level: 5, group: 'Court' },
  { id: 'film', name: 'Film Room', desc: 'Your simulated defense plays as if the coordinator had an extra half star per rank.', max: 2, level: 4, group: 'Court' },
  { id: 'gate', name: 'Box Office', desc: 'Home games pay 25% more gate credits per rank.', max: 2, level: 1, group: 'Club' },
  { id: 'scout', name: 'Talent Scout', desc: 'Three more scouting reports every season per rank.', max: 2, level: 2, group: 'Club' },
  { id: 'negotiator', name: 'Negotiator', desc: 'Your own players ask for 5% less when re-signing, per rank.', max: 3, level: 3, group: 'Club' },
  { id: 'develop', name: 'Player Development', desc: 'Training-camp rating upgrades cost 1 credit less (never below 1).', max: 1, level: 4, group: 'Club' },
  { id: 'trust', name: 'Owner\'s Trust', desc: 'Losses cost 20% less owner approval per rank.', max: 2, level: 5, group: 'Club' },
  { id: 'locker', name: 'Locker Room', desc: 'Losses hurt team morale half as much.', max: 1, level: 6, group: 'Club' },
];
export const perk = (save: Save, id: string): number => prog(save).perks[id] ?? 0;
export const perkPointsSpent = (save: Save): number => Object.values(prog(save).perks).reduce((s, v) => s + v, 0);
/** One point per level gained. */
export const perkPoints = (save: Save): number => coachLevel(save) - 1 - perkPointsSpent(save);
export function buyPerk(save: Save, id: string): string | null {
  const p = PERKS.find(x => x.id === id);
  if (!p) return 'Unknown perk.';
  if (coachLevel(save) < p.level) return `Needs coach level ${p.level}.`;
  if (perk(save, id) >= p.max) return 'Already at the top rank.';
  if (perkPoints(save) <= 0) return 'No perk points. Level up to earn one.';
  prog(save).perks[id] = perk(save, id) + 1;
  return null;
}
/** Multiplier on what the user's own players ask for when re-signing (perk: Negotiator). */
export const resignDiscount = (save: Save): number => 1 - 0.05 * perk(save, 'negotiator');

// ---- trophies ------------------------------------------------------------------------
export interface Trophy { id: string; name: string; desc: string; credits: number; test: (save: Save, c: Record<string, number>) => boolean }
const me = (save: Save) => save.teams[save.userTeamId];
const myHist = (save: Save) => save.history.filter(h => h.userPlayoff !== undefined);
export const TROPHIES: Trophy[] = [
  { id: 'first_win', name: 'On the Board', desc: 'Win your first game.', credits: 2, test: s => s.coach.w + s.coach.playoffW >= 1 },
  { id: 'dunk1', name: 'Above the Rim', desc: 'Throw down a dunk yourself.', credits: 2, test: (_s, c) => (c.dunk ?? 0) >= 1 },
  { id: 'dunk25', name: 'Dunk Contest', desc: '25 dunks in your career.', credits: 5, test: (_s, c) => (c.dunk ?? 0) >= 25 },
  { id: 'perfect10', name: 'Pure Stroke', desc: '10 perfect releases.', credits: 3, test: (_s, c) => (c.perfect ?? 0) >= 10 },
  { id: 'perfect100', name: 'Automatic', desc: '100 perfect releases.', credits: 8, test: (_s, c) => (c.perfect ?? 0) >= 100 },
  { id: 'three50', name: 'Bombs Away', desc: 'Make 50 threes yourself.', credits: 5, test: (_s, c) => (c.three ?? 0) >= 50 },
  { id: 'ankles10', name: 'Ankle Collector', desc: 'Shake 10 defenders with a crossover.', credits: 3, test: (_s, c) => (c.ankles ?? 0) >= 10 },
  { id: 'andone5', name: 'And the Foul', desc: 'Five and-ones.', credits: 3, test: (_s, c) => (c.andone ?? 0) >= 5 },
  { id: 'buzzer', name: 'Ice Water', desc: 'Hit a buzzer-beater.', credits: 5, test: (_s, c) => (c.buzzer ?? 0) >= 1 },
  { id: 'blowout', name: 'No Mercy', desc: 'Win a game by 30 or more.', credits: 3, test: (_s, c) => (c.blowout ?? 0) >= 1 },
  { id: 'bigGame', name: 'Takeover', desc: 'One of your players scores 40 in a game.', credits: 4, test: (_s, c) => (c.big40 ?? 0) >= 1 },
  { id: 'streak', name: 'Heating Up', desc: 'Win six in a row.', credits: 4, test: s => me(s).record.streak >= 6 },
  { id: 'wins25', name: 'Quarter Century', desc: '25 career wins.', credits: 4, test: s => s.coach.w >= 25 },
  { id: 'wins100', name: 'Century Club', desc: '100 career wins.', credits: 8, test: s => s.coach.w >= 100 },
  { id: 'wins500', name: 'Institution', desc: '500 career wins.', credits: 20, test: s => s.coach.w >= 500 },
  { id: 'playoffs', name: 'Dancing', desc: 'Make the playoffs.', credits: 4, test: s => myHist(s).some(h => h.userPlayoff !== 'none') || !!s.playoffs?.series.some(x => x.highId === s.userTeamId || x.lowId === s.userTeamId) },
  { id: 'series', name: 'Moving On', desc: 'Win a playoff round.', credits: 5, test: s => myHist(s).some(h => h.userPlayoff === 'SF' || h.userPlayoff === 'F' || h.userPlayoff === 'champ') },
  { id: 'title', name: 'Champions', desc: 'Win the championship.', credits: 12, test: s => s.coach.titles >= 1 },
  { id: 'repeat', name: 'Back to Back', desc: 'Win two titles in a row.', credits: 15, test: s => { const h = myHist(s); return h.length >= 2 && h[h.length - 1].userPlayoff === 'champ' && h[h.length - 2].userPlayoff === 'champ'; } },
  { id: 'dynasty', name: 'Dynasty', desc: 'Win five championships.', credits: 30, test: s => s.coach.titles >= 5 },
  { id: 'mvp', name: 'Star Maker', desc: 'Coach the league MVP.', credits: 6, test: s => s.history.some(h => h.mvp && h.mvp.teamId === h.userTeamId) },
  { id: 'trade', name: 'Wheeler-Dealer', desc: 'Make a trade.', credits: 2, test: (_s, c) => (c.trade ?? 0) >= 1 },
  { id: 'staff5', name: 'Brain Trust', desc: 'Employ a five-star coordinator.', credits: 5, test: s => (me(s).staff.oc?.stars ?? 0) >= 5 || (me(s).staff.dc?.stars ?? 0) >= 5 },
  { id: 'fac3', name: 'Building Something', desc: 'Every facility at level 3 or better.', credits: 6, test: s => FACILITY_KEYS.every(k => me(s).facilities[k].level >= 3) },
  { id: 'fac5', name: 'State of the Art', desc: 'Take a facility to level 5.', credits: 8, test: s => FACILITY_KEYS.some(k => me(s).facilities[k].level >= 5) },
  { id: 'star', name: 'Franchise Player', desc: 'Have a five-star player on your roster.', credits: 4, test: s => me(s).roster.some(id => ovr(s.players[id]) >= 92) },
  { id: 'hof', name: 'Immortal', desc: 'Send one of your players to the Hall of Fame.', credits: 8, test: s => s.hallOfFame.some(h => s.coach.stops.some(st => st.teamId === h.teamId)) },
  { id: 'fans', name: 'Sold Out', desc: 'Fan support at 90 or more.', credits: 4, test: s => s.fans >= 90 },
  { id: 'second_act', name: 'Second Act', desc: 'Win a title with a second club.', credits: 15, test: s => s.coach.stops.filter(st => st.titles >= 1).length >= 2 },
  { id: 'rebuild', name: 'Redemption', desc: 'Win a title after being fired.', credits: 15, test: s => s.coach.fired >= 1 && s.coach.stops.length > 1 && s.coach.stops[s.coach.stops.length - 1].titles >= 1 },
  { id: 'level10', name: 'Old Hand', desc: 'Reach coach level 10.', credits: 10, test: s => coachLevel(s) >= 10 },
];
/** Award any trophies newly earned. Returns their ids. */
export function checkTrophies(save: Save): string[] {
  const p = prog(save);
  const got: string[] = [];
  for (const t of TROPHIES) {
    if (p.trophies.includes(t.id)) continue;
    let ok = false;
    try { ok = t.test(save, p.counters); } catch { ok = false; }
    if (!ok) continue;
    p.trophies.push(t.id); p.fresh.push(t.id); got.push(t.id);
    save.credits += t.credits;
    p.xp += 40;
  }
  return got;
}

// ---- court styles --------------------------------------------------------------------
export interface CourtStyle { id: string; name: string; wood: string; wood2: string; grain: string; how: string; ok: (save: Save) => boolean }
export const COURTS: CourtStyle[] = [
  { id: 'classic', name: 'Classic Maple', wood: '#d9a066', wood2: '#cf955a', grain: '#b97f47', how: 'Yours from day one.', ok: () => true },
  { id: 'honey', name: 'Honey Oak', wood: '#e8bd72', wood2: '#deb064', grain: '#c0924a', how: 'Reach coach level 3.', ok: s => coachLevel(s) >= 3 },
  { id: 'walnut', name: 'Dark Walnut', wood: '#8a5a3c', wood2: '#7e5035', grain: '#63402b', how: 'Earn 6 trophies.', ok: s => prog(s).trophies.length >= 6 },
  { id: 'slate', name: 'Night Court', wood: '#4a5068', wood2: '#434960', grain: '#343a50', how: 'Reach coach level 7.', ok: s => coachLevel(s) >= 7 },
  { id: 'beach', name: 'Boardwalk', wood: '#e9d8a6', wood2: '#e0cd96', grain: '#c7b27a', how: 'Earn 15 trophies.', ok: s => prog(s).trophies.length >= 15 },
  { id: 'gold', name: 'Champions\' Gold', wood: '#e6b422', wood2: '#d9a81c', grain: '#b88a12', how: 'Win a championship.', ok: s => s.coach.titles >= 1 },
];
export const courtStyle = (save: Save): CourtStyle => {
  const c = COURTS.find(x => x.id === prog(save).court);
  return c && c.ok(save) ? c : COURTS[0];
};

// ---- XP from games -------------------------------------------------------------------
export interface GameProgress { xp: number; levelUp: number | null; trophies: string[] }
/** Call once per user game (hand-played or simmed). `scale` shrinks routine XP in long seasons. */
export function gameProgress(save: Save, result: GameResult, highlights: string[], playoff: boolean, scale: number): GameProgress {
  const p = prog(save);
  const home = result.homeId === save.userTeamId;
  const mine = home ? result.homeScore : result.awayScore, theirs = home ? result.awayScore : result.homeScore;
  const won = mine > theirs;
  const before = levelOf(p.xp);
  let xp = (won ? (playoff ? 45 : 28) : 10) * scale;
  // plays you made yourself are always worth full XP
  const worth: Record<string, number> = { dunk: 3, three: 2, perfect: 2, ankles: 2, andone: 3, buzzer: 15, oreb: 1, putback: 3 };
  for (const h of highlights) { xp += worth[h] ?? 0; p.counters[h] = (p.counters[h] ?? 0) + 1; }
  if (won && mine - theirs >= 30) p.counters.blowout = (p.counters.blowout ?? 0) + 1;
  const lines = home ? result.box.home : result.box.away;
  if (lines.some(l => l.pts >= 40)) p.counters.big40 = (p.counters.big40 ?? 0) + 1;
  xp = Math.round(xp * 10) / 10;
  p.xp += xp;
  const trophies = checkTrophies(save);
  const after = levelOf(p.xp);
  return { xp, levelUp: after > before ? after : null, trophies };
}
/** Season-end XP: goals met and how deep the run went. */
export function seasonProgress(save: Save): void {
  const p = prog(save);
  const last = save.history[save.history.length - 1];
  if (!last) return;
  p.xp += save.owner.goals.filter(g => g.done).length * 60;
  p.xp += { none: 0, R1: 40, SF: 90, F: 160, champ: 320 }[last.userPlayoff] ?? 0;
  checkTrophies(save);
}
export const noteTrade = (save: Save): void => { const c = prog(save).counters; c.trade = (c.trade ?? 0) + 1; };
export const xpBar = (save: Save): { level: number; into: number; need: number; pct: number } => {
  const xp = prog(save).xp, level = levelOf(xp);
  if (level >= MAX_LEVEL) return { level, into: 0, need: 0, pct: 100 };
  const a = xpFor(level), b = xpFor(level + 1);
  return { level, into: Math.floor(xp - a), need: b - a, pct: clamp(((xp - a) / (b - a)) * 100, 0, 100) };
};
