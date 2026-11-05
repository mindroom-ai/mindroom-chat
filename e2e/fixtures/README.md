# e2e fixtures

## agent-call-question.wav

- **Content:** 4.45 s of English speech, 16 kHz mono 16-bit PCM: "What is the capital of France? Please answer in one short sentence."
- **Used by:** `e2e/calls/agent-call.spec.ts`, which plays it into the page's microphone during a call to a real MindRoom agent, and `e2e/messages/reply-quotes.spec.ts`, which sends it as a voice message. It is not part of the build.
- **Added:** commit `f0c4b5c` (2026-11-04, author Bas Nijholt), together with `agent-call.spec.ts`.
- **How it was made: unknown.** Neither that commit's message nor the specs say where the speech came from, and no script in this repository generates it. The file carries one metadata tag, the encoder `Lavf63.1.102` (FFmpeg 9.0's libavformat, the version installed on the development machine), so FFmpeg wrote the last version of it. Whether the voice is text-to-speech output or a recording of a person, and under what terms, is not recorded.
