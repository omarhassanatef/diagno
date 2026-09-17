// Simulates a real Jest run whose actual outcome depends on jest.config.js:
// fails with Jest's real unresolved-alias message until moduleNameMapper is
// added, then "passes" -- so the Fix Engine's apply+rerun loop is exercised
// against genuinely different behavior, not a script that always fails.
const fs = require("fs");
const path = require("path");
const configPath = path.join(__dirname, "jest.config.js");
const config = fs.readFileSync(configPath, "utf8");

if (config.includes("moduleNameMapper")) {
  console.log("PASS src/users.test.ts");
  process.exit(0);
} else {
  console.error("FAIL src/users.test.ts");
  console.error("  Cannot find module '@/modules/users' from 'src/users.test.ts'");
  process.exit(1);
}
