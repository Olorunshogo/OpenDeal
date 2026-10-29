import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { safeNextPath } from "../src/lib/navigation.ts";

const SRC = new URL("../src", import.meta.url).pathname;
function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
const files = sources(SRC).map((path) => ({ path, text: readFileSync(path, "utf8") }));

test("Demo Mode is gone: no /demo route and no links or redirects to it", () => {
  assert.equal(existsSync(join(SRC, "app/demo")), false);
  for (const { path, text } of files) {
    assert.doesNotMatch(text, /["'`]\/demo(["'`/?#]|$)/m, `${path} still references /demo`);
  }
});

test("normal navigation offers sign-in and onboarding exists", () => {
  const shell = readFileSync(join(SRC, "components/AppShell.tsx"), "utf8");
  assert.match(shell, /<HeaderIdentity \/>/);
  assert.match(shell, /href="\/deals"/, "header links to My deals");
  const header = readFileSync(join(SRC, "components/HeaderIdentity.tsx"), "utf8");
  assert.match(header, /href="\/onboarding"/);
  assert.ok(existsSync(join(SRC, "app/deals/page.tsx")), "My deals page exists");
  assert.ok(existsSync(join(SRC, "app/onboarding/page.tsx")));
  const newDeal = readFileSync(join(SRC, "app/deals/new/NewDealClient.tsx"), "utf8");
  assert.match(newDeal, /\/onboarding\?next=\/deals\/new/);
});

test("no browser code calls the dev session route", () => {
  for (const { path, text } of files) {
    assert.doesNotMatch(text, /auth\/dev\/session/, `${path} calls the dev session route`);
  }
});

test("post-sign-in redirects stay on this site", () => {
  assert.equal(safeNextPath("/deals/abc"), "/deals/abc");
  for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", null]) {
    assert.equal(safeNextPath(bad), "/deals/new");
  }
});
