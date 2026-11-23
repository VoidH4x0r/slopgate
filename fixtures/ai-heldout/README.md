# Held-out AI regression set

This is a fixed, independent prompt-style regression set: 10 files, 39 lines and 8 seeded high-confidence findings. It was written from a separate prompt list after the main AI corpus was frozen, so it is closer to a held-out check than the development corpus.

All high findings are labeled in `benchmark/heldout-labels.json`. The run is intentionally kept separate from the published 42-finding precision number so it can be used as a check rather than a tuning set. Do not tune rules against these files without recording the change as a new corpus.

The set is synthetic and small; it is not a representative sample of model output and does not replace a corpus of real AI-authored pull requests.
