# Tuning notes

## 2026-10-25 — first recording (Steelers–Saints on NFL Network via seasons4u, ESPN score bug)

Fixture: 500 s tab recording, one drive → one full break → game returns. Ground truth from a
10 s frame montage: break ≈ 318 s → 437 s (black frame at 437), sponsor billboard/name banners
437–478 s, normal scoreboard back at 478 s. Full-screen stat packages (no scoreboard) at ≈50–65 s
and ≈100 s, field-goal graphic layout 302–318 s.

Run with defaults (`tools/fixture-player.html` raw mode, headless):

| | |
|---|---|
| scoreboard learned | t = 31 s, components: Steelers panel 29×13 @ (82,158), Saints logo 17×9 @ (233,160) at 320×180 |
| COMMERCIAL | t = 319 s (reason `audio`), 1 s after the break began |
| GAME | t = 450 s (reason `audio`); scoreboard itself returned at 478 s |
| ad heard | 1 s of 119 |
| game muted | 13 s, all inside the 437–450 s return billboard |
| false mutes during play | none (the 50–65 s stat package with music reached adProb ≈ 0.6–0.9 for a few seconds but never 7 of 10) |

What mattered, in order:
1. **YAMNet embedding instead of class scores.** Scores-only: 41 s of ad heard, 19 s of play muted, six flaps.
2. **z-score similarity.** Raw cosine between all-positive embeddings sits at 0.80–0.90 for everything; the
   game bank's own spread (mean 0.876, sd 0.029 here) is the only usable scale. Ads land at z ≈ 2–5 (first
   seconds of a break: z 14–18); play at z ≈ −1–1.5; produced packages with music z ≈ 2.5–3.6 for a few seconds.
3. **ambientMax 0.2.** YAMNet "Speech" for announcers peaks ≈ 0.45; the original 0.5 cutoff threw away the
   two blatant seconds at the top of the break.
4. **Majority vote (7 of last 10 ≥ 0.5)** for streaky ad audio; the 2-consecutive ≥ 0.75 rule still catches
   clean breaks instantly.
5. **Learner:** stableFrac 0.6 (the bug was absent ~40% of the first window), thin-line filter (letterbox
   edges at rows 2 and 176–177 were being learned as "logos"), retry on an empty window.

Known gaps:
- Return-from-break billboard (≈13 s) stays muted until game audio wins 5 of 6 s. Acceptable for v1.
- Black cuts at 2 fps are hit-and-miss (caught 346, 410, 421, 431, 437; missed the one at ≈318 if it existed).
  The extension samples at 2 fps too; 4 fps would be cheap if this matters.
- One game, one network, one break. Thresholds are defaults, not truth.

## 2026-10-25 — second live run (same game, live tab, log `s4u-log-2026-10-25T17-31-14-970Z`)

Reported: "took about two commercials to switch." Replay of the exported log (no labels; break
start read off scoreboard loss + music at t ≈ 184):

| | |
|---|---|
| scoreboard learned | t = 29 s |
| t = 118 | black-cut → COMMERCIAL (the stream was paused by hand; fine), back at 123 |
| t = 184 | scoreboard leaves for good, music starts: break begins |
| t = 190–219 | talking ad: adProb noisy 0.25–1.0, never ≥ 0.75 twice, vote peaked 5–6 of 10 |
| t = 220 | black cut, goneSec 37 → **ignored** (blackCutWindowSec was 20) |
| t = 236–248 | near-silent ad (speech ≤ 0.1, music ≤ 0.27): gameSim 0.8–1.0 |
| t = 250 | COMMERCIAL (`audio`) — really the silent ad-to-ad cut (rms 0.004), 66 s late |

Two root causes, both fixed by replay:
1. **blackCutWindowSec 20 → 60.** Caught the break at 220. No change on run4; run3 gains one break.
2. **Ambient seconds no longer count toward audio recovery.** With the window alone the detector
   un-muted at 242 (`audio`): the quiet ad scored as game. Skipping speech<0.2 ∧ music<0.2 seconds
   from the recovery vote keeps 220 → 309 muted. run4 return moves 450 → 451 (13 → 14 s billboard).

Then, leaning toward muting too often (owner's call), four more changes, scored on the same logs:

| change | live log | run4 fixture (headless, real audio) |
|---|---|---|
| black cut mutes at any `goneSec` (no window), carried one second across a mid-second cut | — | 346 and 437 cuts now count (run3) |
| `adVoteHits` 7 → 6 | mutes at **206** (was 250, then 220) | unchanged: 319 → 451, 1 s heard, 14 s muted |
| ad bank: feeds after 20 s on any speech/music; only ever *raises* adProb via (game z − ad z)/2 | n/a (no embeddings logged) | ad seconds ≥ 0.75 while the bank is active: 35 % → 87 %; game before the break unchanged (0 %) |
| frames 2 → 4 fps in the live extension | n/a | n/a (fixture is 2 fps) |

Cost seen so far: the 14 s return billboard (437–451) is banked as "ad", so the game right after the
break scores a little more ad-like (≥ 0.75 on 14 % of seconds vs 0 %); the scoreboard hold rule kept it
from flapping. The old nearest-cosine ad comparison sat at ≈ 0.5 for everything and halved the score
once the bank existed — that is why run4's ad seconds were *less* ad-like after t = 360.

New setting **Keep audio embeddings in the log** (≈ 4 KB/s) so the next live break can be studied offline.

## 2026-10-25 — third live run (log `s4u-log-2026-10-25T18-11-08-104Z`, 1068 s, two breaks)

Reported: un-mutes in the middle of commercials. Replay of the log:

| t | rule | what the data shows |
|---|---|---|
| 276 → 289 | audio recovery 5/6 | talking ad scored gameSim 0.86–1.0 with speech 0.14–0.30 |
| 322 → 324 | slow scoreboard 0.4 × 3 | scoreboard sat at 0.41–0.42 inside the break |
| 942 → 948 | audio recovery 5/6 | talking ad, gameSim 0.92–1.0, speech ≈ 0.5 (announcer level) |
| 383 → 392 | *false mute* in play | primary graphic absent 20 s during play, two adProb spikes ≥ 0.75 |

Underneath: this session's learner chose a weak primary graphic. During play the "scoreboard" was
≥ 0.8 on 8 % of seconds; the secondary "logo" was ≥ 0.9 on 65 % and never during a break. Open item:
let every learned component vouch for recovery (contradicts the "never on the logo alone" rule; needs
another game of data).

Changes (owner's direction: be sure the game is back before un-muting):
- `recoverSimHits/Window` 5/6 → **10/12**; `recoverVisSlow` 0.4 → **0.5**; new **flap guard** (`flapGuardSec` 20).

| log | before | after |
|---|---|---|
| this run | 218C 276G 289C 322G 324C 360G 383C 392G 901C 942G 948C 1051G | 218C 360G 383C 398G 901C 1056G |
| 17:31 run | 118C 123G 206C 309G | 118C 128G 206C (no return by log end; scoreboard never came back) |
| run4 fixture | 319C 451G, 14 s billboard muted | 319C 457G, 20 s billboard muted |
