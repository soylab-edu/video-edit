import test from "node:test";
import assert from "node:assert/strict";
import {
  keepRanges,
  silenceIntervals,
  tempoFilters,
  validateAssetBounds,
} from "../server/core.mjs";
import { localPlan, applyPlan } from "../server/auto-edit.mjs";
import { styles } from "../server/styles.mjs";
test("silence at the end is closed and keeps speech padding", () => {
  const intervals = silenceIntervals(
    "silence_start: 1\nsilence_end: 2\nsilence_start: 3",
    4,
  );
  assert.deepEqual(intervals, [
    [1, 2],
    [3, 4],
  ]);
  assert.deepEqual(keepRanges(4, intervals), [
    [0, 1.12],
    [1.88, 3.12],
  ]);
});
test("speed filters stay inside FFmpeg supported atempo range", () => {
  assert.equal(tempoFilters(0.25), "atempo=0.5,atempo=0.5");
  assert.equal(tempoFilters(4), "atempo=2,atempo=2");
});
const clip = {
  id: "a",
  assetId: "video",
  name: "talk",
  in: 0,
  out: 10,
  speed: 1,
  volume: 1,
  saturation: 1,
  brightness: 0,
};
const project = {
  name: "Test",
  ratio: "16:9",
  clips: [clip],
  audio: [],
  titles: [],
  normalize: false,
};
test("local auto edit preserves speech even when shorter duration is requested", () => {
  const style = styles[1],
    plan = localPlan(
      project,
      [{ clipId: "a", hasAudio: true, duration: 10, silences: [[2, 4]] }],
      style,
      3,
      true,
    );
  assert.equal(plan.cuts.length, 2);
  assert.equal(plan.cuts[1].out, 10);
  assert.deepEqual(plan.repairs, []);
});
test("AI cuts outside source bounds are rejected without mutating source", () => {
  assert.throws(
    () =>
      applyPlan(
        project,
        { cuts: [{ clipId: "a", in: 0, out: 20 }] },
        styles[0],
        true,
      ),
    /범위/,
  );
  assert.equal(project.clips[0].out, 10);
});
test("export rejects absent and out-of-range assets", () => {
  assert.throws(() => validateAssetBounds(project, []), /영상/);
  assert.throws(
    () =>
      validateAssetBounds(project, [
        { id: "video", type: "video", duration: 9 },
      ]),
    /초과/,
  );
});
