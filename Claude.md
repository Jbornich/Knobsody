# Knobsody — project instructions

- The full specification lives in SPEC.md. Read it before implementing
  any feature, and keep changes consistent with it.
- Git discipline: commit after every milestone and after significant
  fixes, with descriptive messages. Push to origin/main.
- Code comments in English.
- Never break the lookahead scheduler pattern: all MIDI events are sent
  with future timestamps; UI rendering must never block scheduling.
- Current status: milestone 1 implemented, awaiting hardware timing test.