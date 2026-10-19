# Test media fixtures

`eac3-test.mp4` (about 147 KB) is self-generated (no third-party material): 6 s of ffmpeg `testsrc2` picture (320x180, 12 fps, H.264 Constrained Baseline) with a 440 Hz sine tone as E-AC-3 5.1 (`-c:a eac3 -ac 6`, 96 kbps). It reproduces "the picture plays, but the browser cannot decode the audio codec" (Chrome, Brave, Firefox) for `tests/e2e/unsupported-audio.spec.ts`. It is not Dolby Atmos material and is never shipped (`tests/` is not part of the plugin ZIP). The dev harness serves it as `/demo/eac3-test.mp4`.

```
ffmpeg -f lavfi -i "testsrc2=size=320x180:rate=12:duration=6" -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=6" \
  -c:v libx264 -profile:v baseline -pix_fmt yuv420p -crf 36 -preset veryfast -g 12 \
  -c:a eac3 -ac 6 -b:a 96k -movflags +faststart -shortest eac3-test.mp4
```
