# Battery run history

`runs.jsonl` — one line per full `npm run eval`, appended by `tests/agent/run.ts`.

Committed on purpose. The point is a record that outlives a terminal session, so
"is this better than before?" has an answer that isn't someone's memory of a
number. Each line keeps every scenario's verdict, not just the score: two runs
at 35/36 can hide one scenario breaking and another being fixed, and that
movement is the interesting part.

Runs are grouped by **cell** — model · prompt variant · reasoning effort. A run
is only ever compared to the last run of its own cell, so a model change can't
be credited to a prompt edit.

    npm run eval -- --repeat 5     # runs, then prints the diff vs this cell's last run
    npm run eval:history           # every recorded run + the matrix, runs nothing

Filtered runs (`--only`, `--group`) are not recorded — a slice of the suite is
not comparable to the whole of it. `--no-record` opts out explicitly.
