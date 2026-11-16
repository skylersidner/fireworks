# Skill: measuring where test time goes (fireworks)

Use this when someone asks how long the suites take, or before splitting or moving tests between regular and daily runs.

1. **Record the load** (`uptime`) before and after every run, and the core count (`sysctl -n hw.ncpu`). Parallel numbers inflate far more than solo ones (up to 7× at load 20), so give both.
2. **Frontend:** `npx ng test --no-watch --reporters=default --reporters=json --output-file=<scratch>/ngtest.json`. In the JSON, `testResults[].startTime/endTime` and `assertionResults[].duration` cover test bodies only. The console `Duration` line gives the tests/environment/setup split. For a solo file, use `--include=src/<path>.spec.ts`. **The wall is bounded by the slowest single file** (vitest runs a file serially in one worker), so look at the top file first.
3. **Backend:** `dotnet build` first, then `dotnet test --no-build --logger "trx;LogFileName=x.trx" --results-directory <scratch>`. Parse `UnitTestResult/@duration` and map `testId` to a class through `UnitTest/TestMethod/@className`. Run plain and with `FIREWORKS_TEST_POSTGRES` pointed at a uniquely named database, then drop that database.
4. **Browser scripts:** don't re-run long ones. Take durations from the logs as `stat -f %B` (birth) to `%m` (last write). A log appended by later re-runs gives a meaningless span; use the gate run's own folder.
5. **Classify each item:** R (fast, regular), S (slow but splittable), D (daily-only). Note what dominates each slow item: sim steps, fixed waits, timeouts in negative controls, or harness startup.
