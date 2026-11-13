// Weekly events. Tokens: {player} {team} {city} {coach} {owner} {opp}.
import type { Effect, EventTemplate } from '../core/types';

const mo = (v: number): Effect => ({ k: 'morale', v });
const tm = (v: number): Effect => ({ k: 'teamMorale', v });
const fa = (v: number): Effect => ({ k: 'fans', v });
const ow = (v: number): Effect => ({ k: 'owner', v });
const cr = (v: number): Effect => ({ k: 'credits', v });
const rp = (v: number): Effect => ({ k: 'rep', v });
const inj = (v: number): Effect => ({ k: 'injury', v });
const sus = (v: number): Effect => ({ k: 'suspend', v });
const trd: Effect = { k: 'tradeDemand', v: 0 };

export const EVENTS: EventTemplate[] = [
  {
    id: 'star_skips_practice', title: 'Skipped Practice', subject: 'star',
    text: '{player} did not show for Tuesday practice. The excuse involves a "very important brunch".',
    choices: [
      {
        label: 'Bench him next game', result: 'The message lands. The locker room nods, the star sulks.',
        effects: [mo(-8), tm(5), ow(2)],
        byTrait: {
          Diva: { result: 'He takes it as a personal insult and hints at leaving.', effects: [mo(-12), tm(2), trd] },
          'Hard Worker': { result: 'He apologizes and stays late all week.', effects: [mo(2), tm(6), ow(2)] },
        },
      },
      {
        label: 'Let it slide', result: 'Nothing happens, which everyone notices.',
        effects: [mo(5), tm(-6), ow(-2)],
        byTrait: { Lazy: { result: 'He takes this as a standing invitation.', effects: [mo(6), tm(-9), ow(-3)] } },
      },
      { label: 'Fine him', result: 'A small cheque and a big lesson.', effects: [mo(-4), cr(2), tm(2)] },
    ],
  },
  {
    id: 'rookie_wants_minutes', title: 'Rookie Wants Minutes', subject: 'rookie',
    text: '{player} knocks on your door. He says he is "ready", and has a highlight reel on his phone to prove it.',
    choices: [
      {
        label: 'Promise more playing time', result: 'He beams. The veterans mutter.',
        effects: [mo(10), tm(-4)],
        byTrait: { 'Hard Worker': { result: 'He practices like a man possessed. The vets respect the hustle.', effects: [mo(10), tm(1)] } },
      },
      {
        label: 'Tell him to earn it', result: 'He frowns, then nods. Probably.',
        effects: [mo(-5), tm(3)],
        byTrait: {
          Diva: { result: 'He rolls his eyes so hard you hear it.', effects: [mo(-10), tm(1)] },
          'Hard Worker': { result: 'He takes it as a challenge and heads to the gym.', effects: [mo(3), tm(4)] },
        },
      },
      { label: 'Send him to extra film study', result: 'Homework: the great motivator.', effects: [mo(1), tm(1), rp(1)] },
    ],
  },
  {
    id: 'media_interview', title: 'Postgame Presser', subject: 'none',
    text: 'A reporter from the {city} Courier asks whether {team} are "pretenders or contenders". The room goes quiet.',
    choices: [
      {
        label: 'Talk big', result: 'The quote runs on the front page. Fans love it.',
        effects: [fa(6), rp(1), tm(-3)],
      },
      { label: 'Stay humble', result: 'Safe, boring, correct.', effects: [ow(3), tm(3), fa(-2)] },
      { label: 'Deflect with a joke', result: 'You get a laugh and no story.', effects: [rp(1), fa(2), ow(-1)] },
    ],
  },
  {
    id: 'trade_demand', title: 'Trade Request', subject: 'unhappy',
    text: '{player} walks in with an agent and a folded piece of paper. You can guess what it says.',
    choices: [
      {
        label: 'Talk him into staying', result: 'It takes an hour and a sandwich, but he stays.',
        effects: [mo(6), cr(-2)],
        byTrait: {
          Loyal: { result: 'He admits he was just venting and hugs you awkwardly.', effects: [mo(12), cr(-1)] },
          Mercenary: { result: 'He nods politely and starts calling other teams anyway.', effects: [mo(-4), trd] },
        },
      },
      { label: 'Tell him you will shop him', result: 'He asks out. The room feels it.', effects: [mo(2), tm(-5), trd] },
      {
        label: 'Refuse flat out', result: 'He stays but he is not happy about it.',
        effects: [mo(-10), ow(3), tm(-2)],
        byTrait: { Hothead: { result: 'He storms out. Doors are slammed. A plant is injured.', effects: [mo(-12), tm(-6), sus(1)] } },
      },
    ],
  },
  {
    id: 'contract_grumbling', title: 'Contract Grumbling', subject: 'star',
    text: '{player} tells a podcast he is "underpaid by any reasonable measure". {owner} has seen the clip.',
    choices: [
      {
        label: 'Promise to revisit it in summer', result: 'Everyone gets a little of what they want.',
        effects: [mo(7), ow(-3)],
        byTrait: {
          Mercenary: { result: 'He says "summer" like it is a deadline. Which it is.', effects: [mo(2), ow(-3)] },
          Loyal: { result: 'He takes your word without a second thought.', effects: [mo(10), ow(-2)] },
        },
      },
      { label: 'Publicly back the owner', result: 'The owner is happy. The star is not.', effects: [ow(5), mo(-8)] },
      { label: 'Say nothing', result: 'The story goes away on its own, mostly.', effects: [mo(-3), fa(-2)] },
    ],
  },
  {
    id: 'player_feud', title: 'Locker Room Feud', subject: 'any',
    text: '{player} and a teammate nearly came to blows over the last slice of pizza. It is not about the pizza.',
    choices: [
      {
        label: 'Sit them down together', result: 'A truce is declared. Pizza is shared.',
        effects: [tm(5), mo(-3)],
        byTrait: {
          Hothead: { result: 'The meeting escalates. Chairs are discussed.', effects: [tm(-6), mo(-6), sus(1)] },
          Leader: { result: 'He takes charge and settles it in two minutes.', effects: [tm(9), mo(3)] },
        },
      },
      { label: 'Fine them both', result: 'Nobody is thrilled but nobody is fighting.', effects: [cr(3), tm(-3), mo(-4)] },
      { label: 'Let them sort it out', result: 'They do, loudly, and then they are fine.', effects: [tm(-2), mo(2), rp(-1)] },
    ],
  },
  {
    id: 'charity_event', title: 'Charity Night', subject: 'any',
    text: 'The {city} Food Bank wants {player} at a charity dinner. It is on a night before a big game.',
    choices: [
      {
        label: 'Send him', result: 'Photos, handshakes, a mashed potato incident.',
        effects: [fa(6), rp(1), mo(-2)],
        byTrait: {
          Showman: { result: 'He works the room like a pro and takes the stage uninvited.', effects: [fa(8), rp(2), mo(5)] },
          Lazy: { result: 'He falls asleep at the table. A photo exists.', effects: [fa(-2), mo(-5)] },
        },
      },
      { label: 'Send the whole staff', result: 'A polite crowd and a small donation.', effects: [fa(2), cr(-1), ow(2)] },
      { label: 'Decline politely', result: 'Rest is rest. The Food Bank is not impressed.', effects: [fa(-4), mo(2)] },
    ],
  },
  {
    id: 'owner_request', title: 'Owner Request', subject: 'none',
    text: '{owner} calls. They want you to start a donor\'s nephew at guard "just for a quarter". You are not sure how serious they are.',
    choices: [
      { label: 'Humor them', result: 'The nephew plays three minutes and gets one rebound, off his own head.', effects: [ow(6), tm(-6)] },
      { label: 'Politely refuse', result: 'They sigh, then say they respect it.', effects: [ow(-5), tm(4), rp(1)] },
      { label: 'Offer a ceremonial jersey instead', result: 'A signed jersey and a loud thank-you.', effects: [ow(2), cr(-1), tm(1)] },
    ],
  },
  {
    id: 'hot_streak_talk', title: 'Hot Hand', subject: 'any',
    text: '{player} has been shooting lights out. Everyone keeps saying "do not jinx it". Naturally, someone does.',
    choices: [
      {
        label: 'Feed him the ball', result: 'He keeps cooking. The others watch.',
        effects: [mo(7), tm(-3), fa(2)],
        byTrait: { Clutch: { result: 'He loves the pressure and delivers again.', effects: [mo(10), fa(3), tm(-1)] } },
      },
      { label: 'Keep the offense balanced', result: 'Ball moves, egos hold.', effects: [tm(5), mo(-3)] },
      { label: 'Talk about the process', result: 'You say "process" four times. Nobody is moved.', effects: [rp(1), mo(1), fa(-1)] },
    ],
  },
  {
    id: 'slump_talk', title: 'In a Slump', subject: 'any',
    text: '{player} is 4-for-27 over the last three games. He has started apologizing to the rim.',
    choices: [
      {
        label: 'Give him a night off', result: 'He returns rested and sheepish.',
        effects: [mo(6), tm(-2)],
        byTrait: { 'Hard Worker': { result: 'He hates sitting but admits it helped.', effects: [mo(3), tm(1)] } },
      },
      {
        label: 'Challenge him', result: 'It is a gamble, as these always are.',
        effects: [mo(-3), tm(3)],
        byTrait: {
          'Hard Worker': { result: 'He accepts the dare and lives in the gym for a week.', effects: [mo(9), tm(4)] },
          Diva: { result: 'He says you do not believe in him. You do not argue.', effects: [mo(-9), tm(-2)] },
        },
      },
      { label: 'Tell him to keep shooting', result: 'Confidence is a fragile thing.', effects: [mo(5), ow(-1)] },
    ],
  },
  {
    id: 'captain_moment', title: 'Captain Steps Up', subject: 'captain',
    text: 'After a rough loss, {player} asks to address the team. You can hear the whiteboard marker squeaking.',
    choices: [
      {
        label: 'Let him speak', result: 'He talks for ten minutes. People actually listen.',
        effects: [tm(7), mo(3)],
        byTrait: {
          Leader: { result: 'The room is fired up. Some players are visibly misty.', effects: [tm(11), mo(4)] },
          'Quiet Pro': { result: 'He keeps it short, which somehow lands harder.', effects: [tm(8), mo(2)] },
        },
      },
      { label: 'Handle it yourself', result: 'The captain nods, a little deflated.', effects: [tm(3), mo(-5), rp(1)] },
      { label: 'Cancel the meeting, run film', result: 'Efficient, if joyless.', effects: [tm(-2), rp(1)] },
    ],
  },
  {
    id: 'veteran_mentor', title: 'Vet Takes a Kid Under His Wing', subject: 'veteran',
    text: '{player} offers to mentor the rookie class. He has a binder. It is a very large binder.',
    choices: [
      {
        label: 'Encourage it', result: 'The rookies learn, the vet feels needed.',
        effects: [mo(6), tm(5), cr(-1)],
        byTrait: {
          Leader: { result: 'He turns it into a tradition. The younger guys eat it up.', effects: [mo(8), tm(8), cr(-1)] },
          Lazy: { result: 'The binder is mostly blank. The rookies find out.', effects: [mo(-2), tm(-2)] },
        },
      },
      { label: 'Keep it informal', result: 'A few chats happen over breakfast.', effects: [mo(2), tm(2)] },
      { label: 'Say no, focus on games', result: 'He puts the binder away, slowly.', effects: [mo(-6), tm(-2)] },
    ],
  },
  {
    id: 'sponsor_offer', title: 'Sponsor Knocking', subject: 'star',
    text: 'A sports-drink company wants {player} in a commercial. The drink is bright green and nobody knows why.',
    choices: [
      {
        label: 'Take the deal', result: 'Cash arrives. So does a bright green stain.',
        effects: [cr(5), mo(3), tm(-3)],
        byTrait: {
          Showman: { result: 'He steals the ad. People are quoting it for weeks.', effects: [cr(5), mo(6), fa(5)] },
          Diva: { result: 'He demands a bigger cut and a trailer.', effects: [cr(3), mo(5), tm(-6)] },
        },
      },
      { label: 'Decline, protect the focus', result: 'He sighs but understands. Mostly.', effects: [mo(-5), tm(4), ow(1)] },
      { label: 'Negotiate a team-wide deal', result: 'Smaller payout, but everyone gets a case of the stuff.', effects: [cr(2), tm(6), mo(1)] },
    ],
  },
  {
    id: 'late_night', title: 'Late Night Incident', subject: 'any',
    text: '{player} was spotted leaving a {city} nightclub at 3 a.m., two days before a game. He says he was "just networking".',
    choices: [
      {
        label: 'Suspend him', result: 'The league office sends a gift basket. The player does not.',
        effects: [sus(1), mo(-8), tm(4), ow(3)],
        byTrait: { Hothead: { result: 'He blows up. Words are exchanged, then doors.', effects: [sus(1), mo(-12), tm(-3)] } },
      },
      { label: 'Fine him, keep him playing', result: 'A reasonable penalty, a reasonable apology.', effects: [cr(3), mo(-3), fa(-2)] },
      {
        label: 'Have a quiet word', result: 'You are the good cop. There is no bad cop.',
        effects: [mo(4), ow(-3), tm(-3)],
        byTrait: { Loyal: { result: 'He is genuinely ashamed and works extra hard all week.', effects: [mo(8), tm(2), ow(-1)] } },
      },
    ],
  },
  {
    id: 'social_media_post', title: 'Ill-Advised Post', subject: 'any',
    text: '{player} tweeted a spicy opinion about {city} traffic, then a spicier one about the mayor. Both are doing numbers.',
    choices: [
      { label: 'Make him delete it', result: 'It is gone but screenshots live forever.', effects: [mo(-5), fa(2), ow(2)] },
      {
        label: 'Let it ride', result: 'Fans love the sass. The front office clenches.',
        effects: [fa(5), ow(-4), mo(3)],
        byTrait: {
          Showman: { result: 'He posts a follow-up. Then a video. The internet erupts.', effects: [fa(8), ow(-6), mo(6)] },
          'Quiet Pro': { result: 'He quietly deletes it himself and apologizes at practice.', effects: [fa(1), ow(1), mo(2)] },
        },
      },
      { label: 'Put out a team statement', result: 'Bland, safe, and long.', effects: [ow(3), fa(-1), rp(1)] },
    ],
  },
  {
    id: 'rivalry_quote', title: 'Bulletin Board Material', subject: 'none',
    text: 'The {opp} coach says {team} are "overrated and overly tall". The clip is on every screen in the locker room.',
    choices: [
      { label: 'Fire back', result: 'You get a good quote and a rowdier crowd.', effects: [fa(5), tm(5), rp(-1)] },
      { label: 'Take the high road', result: 'Classy. Tiny bit boring.', effects: [rp(2), tm(-1), fa(-1)] },
      { label: 'Pin it on the wall', result: 'The team is fired up, and you get a lot of eyes on you.', effects: [tm(9), ow(-2), fa(2)] },
    ],
  },
  {
    id: 'practice_intensity', title: 'Practice Intensity', subject: 'none',
    text: 'The team looks sluggish. {coach} (that is you) suspects it is the new playlist.',
    choices: [
      { label: 'Run them hard', result: 'Sweat, groans, and a tired but sharper team.', effects: [tm(-5), rp(1), ow(2)] },
      { label: 'Light day, team lunch', result: 'Spirits rise. Calves relax.', effects: [tm(7), cr(-1)] },
      { label: 'Let the players choose', result: 'They choose naps.', effects: [tm(5), ow(-2), rp(-1)] },
    ],
  },
  {
    id: 'injury_playthrough', title: 'Play Through It?', subject: 'star',
    text: '{player} has a sore knee but insists he can go. The trainer looks at you and slowly shakes his head.',
    choices: [
      {
        label: 'Play him', result: 'He gives you everything. The knee has opinions.',
        effects: [mo(5), fa(3), inj(1)],
        byTrait: { 'Hard Worker': { result: 'He grits through it and plays brilliantly.', effects: [mo(8), fa(4)] }, Hothead: { result: 'He forces a play and goes down in a heap.', effects: [mo(-3), inj(2)] } },
      },
      { label: 'Rest him', result: 'Safe call. He pouts anyway.', effects: [mo(-5), tm(2), ow(1)] },
      { label: 'Limit his minutes', result: 'A compromise nobody asked for.', effects: [mo(1), tm(1)] },
    ],
  },
  {
    id: 'ownerSuite', title: 'Owner in the Locker Room', subject: 'none',
    text: '{owner} wanders into the locker room before tipoff and delivers a speech about "heart". It runs long.',
    choices: [
      { label: 'Let it play out', result: 'It is awkward but the owner is touched.', effects: [ow(5), tm(-4)] },
      { label: 'Gently escort them out', result: 'You are polite. They are not amused.', effects: [ow(-4), tm(3)] },
      { label: 'Ask for a quick team toast instead', result: 'They love it. Everyone gets back to work.', effects: [ow(2), tm(2), rp(1)] },
    ],
  },
  {
    id: 'fan_selfie', title: 'Fan Meet and Greet', subject: 'any',
    text: 'A fan club wants {player} for a meet-and-greet. They have a banner and a cake that looks like his head.',
    choices: [
      {
        label: 'Go', result: 'Smiles all round. Cake is eaten.',
        effects: [fa(6), mo(2)],
        byTrait: { Showman: { result: 'He signs the cake. The crowd goes bananas.', effects: [fa(8), mo(7)] }, Lazy: { result: 'He phones it in and checks his watch.', effects: [fa(1), mo(-3)] } },
      },
      { label: 'Skip it', result: 'Fans grumble. He gets the afternoon off.', effects: [fa(-5), mo(3)] },
      { label: 'Send a signed ball', result: 'A tidy middle ground.', effects: [fa(2), cr(-1)] },
    ],
  },
  {
    id: 'bench_complaint', title: 'Benched and Bitter', subject: 'benched',
    text: '{player} has not played in a week and is giving the bench towel some very pointed looks.',
    choices: [
      {
        label: 'Give him a shot', result: 'He plays like a man with a point to prove.',
        effects: [mo(9), tm(-3)],
        byTrait: { Lazy: { result: 'He plays a bit too casual and you regret it.', effects: [mo(3), tm(-6)] } },
      },
      {
        label: 'Explain the role', result: 'Honest but flat.',
        effects: [mo(-4), tm(2)],
        byTrait: {
          'Quiet Pro': { result: 'He nods, accepts it, and keeps working.', effects: [mo(3), tm(3)] },
          Diva: { result: 'He says he did not sign up to watch. A fair point, and a rude one.', effects: [mo(-9), trd] },
        },
      },
      { label: 'Tell him to stay ready', result: 'Phrases like this are the baseline of coaching.', effects: [mo(1), tm(0)] },
    ],
  },
  {
    id: 'team_dinner', title: 'Team Dinner', subject: 'none',
    text: 'The team wants a dinner on the road. You can pay, or you can suggest a very sad buffet.',
    choices: [
      { label: 'Pay for a nice dinner', result: 'Spirits soar. The tab does not.', effects: [tm(8), cr(-3)] },
      { label: 'Cheap and cheerful', result: 'Nobody complains, loudly.', effects: [tm(2), cr(-1)] },
      { label: 'Skip it, save the cash', result: 'Credits saved. Faces fell.', effects: [tm(-5), cr(2), ow(2)] },
    ],
  },
  {
    id: 'agent_call', title: 'The Agent Calls', subject: 'star',
    text: '{player}\'s agent phones with a "hypothetical" about moving to a bigger market. He wants to know your thoughts on hypotheticals.',
    choices: [
      {
        label: 'Hear them out', result: 'You listen. The agent takes notes.',
        effects: [mo(5), ow(-2)],
        byTrait: { Mercenary: { result: 'He now has leverage and knows it.', effects: [mo(5), ow(-4), cr(-2)] } },
      },
      {
        label: 'Say you are building around him', result: 'Flattery works, usually.',
        effects: [mo(8), tm(-2)],
        byTrait: { Loyal: { result: 'He is moved by the vote of confidence.', effects: [mo(12), tm(0)] } },
      },
      { label: 'Hang up', result: 'A bold move, with a cost.', effects: [mo(-8), ow(2)] },
    ],
  },
  {
    id: 'shoe_deal', title: 'Signature Shoe', subject: 'star',
    text: '{player} wants to wear a custom, flamboyant sneaker for the next home game. The league office says the color is "not a color".',
    choices: [
      { label: 'Allow it', result: 'Fans love it. Sales spike.', effects: [fa(5), mo(6), cr(1)], byTrait: { Showman: { result: 'He debuts a matching cape. You pretend not to see.', effects: [fa(7), mo(8), ow(-2)] } } },
      { label: 'Ban it', result: 'The league office thanks you. The player does not.', effects: [mo(-6), ow(2)] },
      { label: 'Tone it down', result: 'Half the neon, all the grumbling.', effects: [mo(1), fa(1)] },
    ],
  },
  {
    id: 'post_loss_fan_anger', title: 'Angry Fans', subject: 'none',
    text: 'Fans are booing at the end of the game. One of them threw a pretzel at the tunnel. It was a good throw.',
    choices: [
      { label: 'Apologize to fans', result: 'A heartfelt statement soothes the crowd.', effects: [fa(5), rp(1), tm(-2)] },
      { label: 'Defend the players', result: 'Loyalty is appreciated in the locker room.', effects: [tm(7), fa(-5)] },
      { label: 'Offer a ticket giveaway', result: 'Free seats make for friendlier fans.', effects: [fa(7), cr(-3)] },
    ],
  },
  {
    id: 'tough_love', title: 'Tough Love Talk', subject: 'any',
    text: '{player} has been coasting in practice. You have a speech prepared. It begins with "Son".',
    choices: [
      {
        label: 'Give the speech', result: 'The room shifts. The coaching staff is impressed.',
        effects: [mo(-4), tm(4), rp(1)],
        byTrait: {
          Lazy: { result: 'He sulks, then picks up the pace.', effects: [mo(-2), tm(5)] },
          Diva: { result: 'He sulks and tells the media you "have never played".', effects: [mo(-10), fa(-3)] },
          'Hard Worker': { result: 'He is confused. He is already working hard. You apologize.', effects: [mo(2), tm(-1)] },
        },
      },
      { label: 'Arm around the shoulder', result: 'Friendly and warm, and a little ineffective.', effects: [mo(5), tm(-3)] },
      { label: 'Ignore it', result: 'You will deal with it later. Or never.', effects: [tm(-4), mo(1)] },
    ],
  },
  {
    id: 'travel_woes', title: 'Travel Chaos', subject: 'none',
    text: 'The team bus broke down on the way to the airport. The replacement bus smells like a damp gym bag.',
    choices: [
      { label: 'Charter a plane', result: 'Comfort costs money, but no one complains.', effects: [tm(7), cr(-3)] },
      { label: 'Make everyone tough it out', result: 'They tough it out. Resentfully.', effects: [tm(-5), cr(1), rp(1)] },
      { label: 'Turn it into team bonding', result: 'Singing happens. It is not good singing, but it counts.', effects: [tm(4), fa(1)] },
    ],
  },
  {
    id: 'hometown_visit', title: 'Hometown Hero', subject: 'any',
    text: '{player} is playing in his old hometown, and half of his family is in the crowd. They have matching shirts.',
    choices: [
      {
        label: 'Let him start', result: 'He plays on emotion. The crowd roars.',
        effects: [mo(8), fa(3)],
        byTrait: { Clutch: { result: 'He hits a big shot and points to the stands.', effects: [mo(10), fa(5)] } },
      },
      { label: 'Keep the usual rotation', result: 'Fair is fair. He quietly sulks.', effects: [mo(-4), tm(2)] },
      { label: 'Arrange extra family tickets', result: 'A happy player, a lighter wallet.', effects: [mo(6), cr(-2), fa(1)] },
    ],
  },
  {
    id: 'rookie_hazing', title: 'Rookie Hazing', subject: 'rookie',
    text: 'The veterans have {player} carrying their bags and singing the team song. His voice cracks on every high note.',
    choices: [
      { label: 'Let tradition run', result: 'He survives. The vets are pleased.', effects: [tm(5), mo(-5)], byTrait: { Hothead: { result: 'He loses his cool. Words, shoves, and an awkward apology.', effects: [tm(-6), mo(-8), sus(1)] } } },
      { label: 'Shut it down', result: 'The rookie is relieved. The vets are insulted.', effects: [mo(7), tm(-5)] },
      { label: 'Keep it light, no bags', result: 'A song and a pie. Seems fair.', effects: [tm(3), mo(2)] },
    ],
  },
  {
    id: 'ref_dispute', title: 'Ref Rage', subject: 'any',
    text: '{player} picked up a technical foul for telling the ref what he thought of his eyesight. It was an accurate take, too.',
    choices: [
      {
        label: 'Defend him', result: 'The locker room loves it. The league does not.',
        effects: [mo(6), tm(4), rp(-2), cr(-2)],
        byTrait: { Hothead: { result: 'He is encouraged. Another tech is practically guaranteed.', effects: [mo(8), tm(2), rp(-3)] } },
      },
      { label: 'Scold him publicly', result: 'The refs approve. He does not.', effects: [mo(-7), rp(2), tm(-1)] },
      { label: 'Say nothing', result: 'It blows over, mostly.', effects: [mo(1), rp(0)] },
    ],
  },
  {
    id: 'doc_vs_player', title: 'Medical Advice', subject: 'any',
    text: 'The team doctor wants {player} to sit out a week "just to be sure". {player} says he feels great, which is what they all say.',
    choices: [
      { label: 'Follow the doctor', result: 'Cautious, sensible, boring.', effects: [mo(-4), ow(2), tm(1)] },
      {
        label: 'Let him play', result: 'He plays hard. Nobody is thrilled with the risk.',
        effects: [mo(6), fa(2), inj(1)],
        byTrait: { 'Hard Worker': { result: 'He plays well and stays healthy.', effects: [mo(7), fa(3)] } },
      },
      { label: 'Get a second opinion', result: 'It costs a bit but settles the room.', effects: [cr(-2), mo(2), ow(1)] },
    ],
  },
  {
    id: 'practice_prank', title: 'Practice Prank', subject: 'none',
    text: 'Somebody filled the coach\'s office with balloons. There are a lot. You can no longer open the door.',
    choices: [
      { label: 'Laugh it off', result: 'The team loves the sport. Morale jumps.', effects: [tm(7), rp(1)] },
      { label: 'Find the culprit', result: 'You do. It was the mascot.', effects: [tm(-3), ow(1)] },
      { label: 'Prank them back', result: 'An escalating war begins.', effects: [tm(5), fa(1), rp(-1)] },
    ],
  },
  {
    id: 'tv_special', title: 'TV Feature', subject: 'star',
    text: 'A network wants a documentary crew in the locker room following {player} all week. They have drones.',
    choices: [
      {
        label: 'Say yes', result: 'The cameras roll and the bigger market notices.',
        effects: [fa(7), rp(2), tm(-5)],
        byTrait: {
          Showman: { result: 'He becomes the star of the show.', effects: [fa(8), rp(2), mo(6)] },
          'Quiet Pro': { result: 'He hates every second but plays on.', effects: [fa(5), mo(-6), rp(2)] },
        },
      },
      { label: 'Say no', result: 'Quieter week, smaller profile.', effects: [tm(4), fa(-3)] },
      { label: 'Allow limited access', result: 'The crew gets the hallway and half the weight room.', effects: [fa(3), rp(1), tm(-1)] },
    ],
  },
  {
    id: 'budget_cut', title: 'Owner Wants Savings', subject: 'none',
    text: '{owner} sends a memo asking the {team} to "find efficiencies". The memo has a lot of bullet points.',
    choices: [
      { label: 'Trim travel', result: 'The owner is delighted. The staff is damp-eyed.', effects: [ow(6), cr(3), tm(-5)] },
      { label: 'Push back', result: 'The conversation is tense but you keep the budget.', effects: [ow(-5), tm(3), rp(1)] },
      { label: 'Compromise', result: 'Everyone wins a little and loses a little.', effects: [ow(2), cr(1), tm(-1)] },
    ],
  },
  {
    id: 'youth_clinic', title: 'Youth Clinic', subject: 'any',
    text: 'A youth clinic in {city} wants {player} for the afternoon. Forty kids, one basketball, no plan.',
    choices: [
      {
        label: 'Send him', result: 'He is great with the kids. Cute photos follow.',
        effects: [fa(5), rp(1), mo(2)],
        byTrait: { Leader: { result: 'He runs it like a pro and wins every parent.', effects: [fa(7), rp(2), mo(5)] }, Diva: { result: 'He complains about the gym lighting the entire time.', effects: [fa(-1), mo(-5)] } },
      },
      { label: 'Decline', result: 'He rests. The clinic organizers grumble.', effects: [fa(-3), mo(3)] },
    ],
  },
  {
    id: 'locker_music', title: 'Locker Room Playlist', subject: 'none',
    text: 'The locker room has two playlists and no peace. The rookies want one, the veterans want the other.',
    choices: [
      { label: 'Rookies pick', result: 'It is loud. The veterans put in earplugs.', effects: [tm(2), fa(0)] },
      { label: 'Veterans pick', result: 'Smooth jazz in a locker room. Surprisingly peaceful.', effects: [tm(3)] },
      { label: 'Ban music', result: 'Silence reigns. So does grumbling.', effects: [tm(-6), rp(1)] },
    ],
  },
  {
    id: 'big_win_party', title: 'Victory Lap', subject: 'none',
    text: 'After a big win the team wants a night out. {coach} is allowed to say yes. {coach} is also allowed to say no.',
    choices: [
      { label: 'Allow it', result: 'Great vibes, a little bleary the next morning.', effects: [tm(8), ow(-2)] },
      { label: 'Team curfew, quiet celebration', result: 'Spirits dip but heads are clear.', effects: [tm(-2), rp(1), ow(2)] },
      { label: 'Stay focused', result: 'Business as usual.', effects: [tm(-4), ow(3), rp(1)] },
    ],
  },
  {
    id: 'diva_demands', title: 'Special Treatment', subject: 'star', traits: ['Diva'],
    text: '{player} requests a private chef, a quiet seat on the bus, and a lighter practice load. He has a list.',
    choices: [
      { label: 'Grant some requests', result: 'He is happy. The roster has noticed.', effects: [mo(8), tm(-7), cr(-2)] },
      { label: 'Deny them all', result: 'He pouts for days and tells everyone.', effects: [mo(-10), tm(4), ow(1)] },
      { label: 'Offer a compromise', result: 'A smaller list, a smaller grumble.', effects: [mo(2), tm(-1), cr(-1)] },
    ],
  },
  {
    id: 'hothead_clash', title: 'Hothead Boils Over', subject: 'any', traits: ['Hothead'],
    text: '{player} got into it with a fan courtside. Security was involved. So was a nacho tray.',
    choices: [
      { label: 'Suspend him', result: 'A firm message and a thinner bench.', effects: [sus(1), mo(-8), tm(3), ow(3)] },
      { label: 'Make him apologize publicly', result: 'He does, through gritted teeth.', effects: [mo(-5), fa(4), rp(1)] },
      { label: 'Back him up', result: 'Teammates love it. The league is less amused.', effects: [mo(7), tm(5), rp(-3), ow(-3)] },
    ],
  },
  {
    id: 'clutch_confidence', title: 'Last Shot Debate', subject: 'any', traits: ['Clutch'],
    text: '{player} says he wants the ball in the final minute of every close game. "Every. One."',
    choices: [
      { label: 'Draw up the plays', result: 'He gets his chances. So far, so good.', effects: [mo(8), tm(-3), fa(2)] },
      { label: 'Spread the trust', result: 'Other players appreciate it. He mutters.', effects: [mo(-4), tm(5)] },
      { label: 'Say it depends on matchups', result: 'A very coach thing to say.', effects: [mo(1), rp(1)] },
    ],
  },
  {
    id: 'loyal_extension', title: 'Loyalty Talk', subject: 'veteran', traits: ['Loyal'],
    text: '{player} says he would take less money to stay with {team} forever. He mentions it three times.',
    choices: [
      { label: 'Accept the discount', result: 'The owner is delighted. A veteran feels respected.', effects: [ow(5), mo(7), cr(2)] },
      { label: 'Pay him fairly anyway', result: 'He is touched. The owner is baffled.', effects: [mo(10), ow(-3)] },
      { label: 'Stay noncommittal', result: 'A polite non-answer, as usual.', effects: [mo(-3), ow(1)] },
    ],
  },
  {
    id: 'mercenary_offer', title: 'Tempting Offer', subject: 'any', traits: ['Mercenary'],
    text: '{player} has been quietly shopping around. A rival offered him a signing bonus the size of a small car.',
    choices: [
      { label: 'Match the offer', result: 'He stays, and the owner groans.', effects: [mo(9), ow(-5), cr(-3)] },
      { label: 'Call his bluff', result: 'He might stay, he might not.', effects: [mo(-6), ow(2), trd] },
      { label: 'Appeal to the team', result: 'He shrugs. It is a business.', effects: [mo(-2), tm(2)] },
    ],
  },
  {
    id: 'lazy_conditioning', title: 'Out of Shape', subject: 'any', traits: ['Lazy'],
    text: '{player} was winded after one defensive possession. The trainer has a printout and it is not flattering.',
    choices: [
      { label: 'Put him on extra conditioning', result: 'Groans, sweat, and a slightly lighter player.', effects: [mo(-6), tm(4), rp(1)] },
      { label: 'Shrug it off', result: 'The conditioning coach quits internally.', effects: [mo(3), tm(-5)] },
      { label: 'Give him a diet plan', result: 'Surprisingly effective, until pizza arrives.', effects: [mo(-2), tm(2), cr(-1)] },
    ],
  },
  {
    id: 'quiet_pro_leak', title: 'Quiet Pro Speaks Up', subject: 'any', traits: ['Quiet Pro'],
    text: '{player} rarely says anything. Today he asked to talk. You are suddenly nervous.',
    choices: [
      { label: 'Listen carefully', result: 'He has a pointed, useful opinion about the defense.', effects: [mo(6), tm(4), rp(1)] },
      { label: 'Ask him to keep it internal', result: 'He nods and leaves. Maybe next time.', effects: [mo(-3), tm(1)] },
      { label: 'Promote him to a bigger voice', result: 'He accepts the role, with visible dread.', effects: [tm(4), mo(-2)] },
    ],
  },
  {
    id: 'showman_stunt', title: 'Pregame Stunt', subject: 'any', traits: ['Showman'],
    text: '{player} wants to enter the arena by motorcycle. He has not mentioned a license.',
    choices: [
      { label: 'Approve it', result: 'The crowd loses its mind. So does the arena manager.', effects: [fa(8), mo(8), ow(-4), cr(-2)] },
      { label: 'Veto it', result: 'He pouts like a six-year-old.', effects: [mo(-6), ow(3)] },
      { label: 'Offer a cooler pregame routine', result: 'A dance routine. Nobody saw it coming.', effects: [fa(4), mo(3), tm(-1)] },
    ],
  },
  {
    id: 'hard_worker_gym', title: 'Gym Rat Request', subject: 'any', traits: ['Hard Worker'],
    text: '{player} asks for the keys to the gym at 5 a.m. The janitor is not a fan.',
    choices: [
      { label: 'Give him the keys', result: 'He gets stronger. The janitor sighs.', effects: [mo(7), tm(2), cr(-1)], byTrait: { 'Hard Worker': { result: 'He turns it into a movement; half the team joins.', effects: [mo(9), tm(6), cr(-1)] } } },
      { label: 'Tell him to rest', result: 'He listens, sort of. He is here at 5:15.', effects: [mo(-3), tm(1)] },
      { label: 'Set up a team session', result: 'More people, less peace.', effects: [tm(5), mo(1)] },
    ],
  },
  {
    id: 'press_leak', title: 'Leak in the Locker Room', subject: 'none',
    text: 'Someone leaked your lineup plan to a {city} blogger. The blogger has a lot of confidence and a few typos.',
    choices: [
      { label: 'Hold an inquisition', result: 'You do not find the leaker. Everyone is annoyed.', effects: [tm(-6), rp(1)] },
      { label: 'Ignore it', result: 'The blogger moves on to a different scandal.', effects: [rp(-1), tm(1)] },
      { label: 'Plant a fake lineup next time', result: 'Sneaky, and a tiny bit fun.', effects: [rp(2), tm(2), fa(1)] },
    ],
  },
  {
    id: 'coach_hot_seat', title: 'Hot Seat Rumors', subject: 'none',
    text: 'A columnist suggests {coach} is on the hot seat. {owner} has declined to deny it, which is not a denial.',
    choices: [
      { label: 'Address it head-on', result: 'You stay calm and say the right words.', effects: [rp(1), ow(2), fa(1)] },
      { label: 'Ignore it', result: 'The rumor lingers like a bad smell.', effects: [ow(-3), tm(-2)] },
      { label: 'Call a press conference', result: 'It is a big event for a small story.', effects: [fa(3), rp(-1), ow(-1)] },
    ],
  },
  {
    id: 'rookie_wall', title: 'Rookie Hits the Wall', subject: 'rookie',
    text: '{player} is dragging in his first real season. The long schedule has made its presence known.',
    choices: [
      {
        label: 'Give him a rest week', result: 'He bounces back with a smile.',
        effects: [mo(7), tm(-1)],
        byTrait: { 'Hard Worker': { result: 'He feels guilty about resting but admits he needed it.', effects: [mo(5), tm(1)] } },
      },
      { label: 'Push through', result: 'He powers through, barely.', effects: [mo(-5), tm(2), ow(1)] },
      { label: 'Pair him with a veteran', result: 'The vet takes him under his arm.', effects: [mo(4), tm(3)] },
    ],
  },
  {
    id: 'captain_quits', title: 'Captain Considers Stepping Down', subject: 'captain',
    text: '{player} says the armband is weighing on him. He mentions it like someone describing an old injury.',
    choices: [
      {
        label: 'Convince him to stay', result: 'A warm pep talk and a firm handshake.',
        effects: [mo(7), tm(3)],
        byTrait: { Leader: { result: 'He steels himself and rallies the room.', effects: [mo(9), tm(8)] } },
      },
      { label: 'Let him step down', result: 'It is quiet. It is odd.', effects: [mo(-4), tm(-5)] },
      { label: 'Share the role with a co-captain', result: 'Two hats, one armband.', effects: [mo(3), tm(3), rp(1)] },
    ],
  },
];
