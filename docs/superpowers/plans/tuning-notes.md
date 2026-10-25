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
