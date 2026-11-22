# Visual verification

🇺🇸 English | [🇧🇷 Português](pt-BR/verificacao-visual.md)

How Paprika proves, with numbers, that a screen of the app matches the board that was approved.
The idea is adversarial on purpose: whoever built the screen is not the one who certifies it.

The goal is the row **Assisted adversarial verification in the canvas** in the
[backlog](backlog.md). This page is the part that exists today, the part that does not, and the
exact rules the existing part uses — because in this loop the rules are the thing being fought
over, so they have to be written down and reviewable.

## The loop

1. A **reference** is the approved board: a frame in a Paprika document, one per screen and per
   mode (light and dark).
2. A **generator** changes the app until a screenshot of the real screen reaches at least
   **95 % similarity** against that reference, for every screen and both modes.
3. An independent **discriminator** does the work again from scratch — build, reference,
   capture, compare — and fails the round on:
   - **score**: below the bar for any screen or mode;
   - **cheating**: edited references, masks without a reason, or a comparator changed to make a
     screen pass;
   - **regression**: a screen that passed in the previous round and does not pass now;
   - **contrast**: colours that match pixel-wise but are unreadable.
4. At most **3 rounds**; after that a human decides.

## What exists now

`server-go/internal/visualdiff` — the comparator and the contrast check, in Go:

| Call | What it gives |
| --- | --- |
| `Compare(a, b image.Image, opts)` | score and counts for two pictures |
| `CompareFiles(pathA, pathB, opts)` | the same, reading two PNGs (the discriminator's path) |
| `Result.WriteDiffPNG(w)` | the annotated picture, so a human can see what was forgiven |
| `ContrastRatio`, `MeetsContrast`, `MinContrast` | WCAG 2.1 contrast, the same numbers the loop will gate on |
| `ParseHex` | `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, the way the board writes its tokens |

Everything is in numbers and every exception is counted, because a bare `PASS` is not evidence.

## What does not exist yet

The rest of the row is the next slice: rendering the references out of the boards, capturing the
real screens, the cheat guard that re-runs this package instead of trusting a stored score, and
the round driver with its three-round budget. Nothing in this package decides pass or fail: it
returns the score, and the caller holds the bar.

## The comparison, exactly

**Canvas.** The compared canvas is the larger of the two pictures (`max(width) × max(height)`).
Whatever area one picture does not have is filled with **magenta** (`#ff00ff`), a colour no real
screen produces, and that strip counts as different: a capture that lost its footer is not the
same screen. `Result.SizeMismatch` reports how much of the canvas was only on one side.

**Colour distance.** A pixel is a difference when its perceptual distance passes the threshold.
Distance is measured in **YIQ** (the NTSC rotation of RGB, weighted 0.5053 / 0.2926 / 0.1597),
because the eye separates light from colour far better than it separates RGB channels: a
channel-wise RGB distance flags dithering and anti-aliasing as errors and misses the hue shifts
people do notice. The distance is squared and normalised so identical colours are 0 and black
against white is ≈ 0.505.

**Threshold 0.1.** Default, and the number the maintainer's harness used. Passing no options is
that default; a threshold of 0 counts every visible difference, which is what you want when a
test asserts two renders are byte-equal. Scores are only comparable at the same threshold, so
changing it changes the rules of the game — the discriminator re-runs this code, and that is the
point.

**Anti-aliasing.** A difference at an edge is not a design change: the same diagonal lands on
different pixels depending on where the sub-pixel coverage falls. A pixel is treated as a blend
when its brightness sits strictly between a darker and a lighter neighbour; the difference is
then forgiven when **both** sides are blends (the edge wobbled) or when the other picture has
that same colour within one pixel (the edge moved). A blend that exists on only one side, with
that colour nowhere near, is counted — that is a shape that appeared or disappeared, not a
rounding. `Result.AntiAliased` says how many pixels were forgiven; pass
`IncludeAntiAliasing` to count them anyway.

**Masks.** A rectangle can be excluded from the comparison, and **each one must carry a
reason**: an unexplained skipped area is exactly how a screen is made to pass. Masks with no
reason, with a zero size or with negative coordinates are refused with the mask position in the
error. Overlapping area is excused once, and `Result.MaskedPerMask` keeps the pixel count of
each mask so a mask that covers nothing is visible to the next round. Masks may not cover
everything: a comparison of zero pixels is an error, not a 1.0.

**Similarity.** `1 − DiffPixels / Scored`, where `Scored = Compared − Masked`. The score is
always shown next to `Masked` and `AntiAliased`; a 97 % where half the canvas was masked is a
different fact from a 97 % with no masks, and the numbers say which one it was.

**The diff picture.** Red is a counted difference, yellow an anti-aliased one, blue a masked
one, magenta the strip that only one picture had; everything else is the reference dimmed to 40 %
so the marks read on top of it.

| Field | Meaning |
| --- | --- |
| `width`, `height`, `compared` | the canvas and how many pixels it has |
| `masked`, `maskedPerMask`, `scored` | what was excused, per mask, and what decided the score |
| `diffPixels`, `antiAliased`, `sizeMismatch` | counted differences, forgiven blends, one-sided area |
| `similarity` | `1 − diffPixels/scored`, in 0..1 |
| `maxDelta` | the worst single pixel, on the same 0..1 scale as the threshold |

## Contrast

Pixels can match at 99 % and still ship a label nobody reads. The helpers are WCAG 2.1: relative
luminance from linearised sRGB, ratio `(L1 + 0.05) / (L2 + 0.05)`, minimum 4.5 for body text and
3 for large text (18 px bold or 24 px), one step up at AAA (7 and 4.5). UI parts that carry
meaning (an icon, a border that separates two areas) sit at the large-text bar, which is why the
loop reuses it. A translucent colour is composited over its background before being judged,
because that is the colour the screen paints.

## Cost

Two 1440×900 PNGs, one comparison, on an AMD Ryzen 9 9950X3D (Go benchmark, `-benchtime 10x`):

```
BenchmarkCompareIdentical1440x900        12.5 ms/op   16.9 MB/op    6 allocs/op
BenchmarkCompareEdited1440x900           15.3 ms/op   16.9 MB/op    6 allocs/op
BenchmarkCompareEditedWithMasks1440x900  13.7 ms/op   16.9 MB/op    7 allocs/op
BenchmarkCompareFiles1440x900            21.6 ms/op   27.3 MB/op   56 allocs/op
```

Reading the PNGs costs about 9 ms of that. A whole loop — several screens, two modes, three
rounds, run twice (generator and discriminator) — is a couple of seconds of comparison, so the
cost of the loop lives in building and capturing, not in judging.

## Changing this package

The technique (YIQ distance plus an edge-blend filter) is the one popularised by pixelmatch,
which is ISC-licensed; this is our own implementation and no code was copied. If a rule here
changes — threshold, blend test, what a mask may cover, the similarity denominator — say so in
the pull request: it moves every score that ever was or will be reported.
