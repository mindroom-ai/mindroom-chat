#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
ruby scripts/ios-routing-test-project.rb
cd .claude/evidence/ios-routing
pod install

device_id=$(xcrun simctl list devices available --json | node --input-type=commonjs -e '
  let input = "";
  process.stdin.on("data", chunk => input += chunk);
  process.stdin.on("end", () => {
    const devices = Object.entries(JSON.parse(input).devices)
      .filter(([runtime]) => runtime.includes("iOS"))
      .sort(([a], [b]) => b.localeCompare(a, undefined, { numeric: true }))
      .flatMap(([, devices]) => devices);
    const phone = devices.find(device => device.name.startsWith("iPhone"));
    if (!phone) throw new Error("No available iPhone simulator");
    process.stdout.write(phone.udid);
  });
')

# Keep every run, including the failing baseline, as an inspectable result bundle.
result_name="Routing-$(date -u +%Y%m%dT%H%M%SZ).xcresult"
xcodebuild test \
  -workspace Routing.xcworkspace \
  -scheme Routing \
  -configuration Debug \
  -destination "platform=iOS Simulator,id=$device_id" \
  -parallel-testing-enabled NO \
  -derivedDataPath DerivedData \
  -resultBundlePath "$result_name" \
  CODE_SIGNING_ALLOWED=NO 2>&1 | tee xcodebuild.log
