import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { createAppServer } from "./server.mjs";

let server;
let baseUrl;

before(async () => {
  server = createAppServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

async function post(body, signal) {
  const response = await fetch(`${baseUrl}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal,
  });
  return { status: response.status, body: await response.json() };
}

for (const body of [
  "", "{", "null", "[]", '"text"', "42", "true", "{}",
  '{"text":null}', '{"text":42}', '{"text":false}',
  '{"text":[]}', '{"text":{}}', '{"text":""}', '{"text":" \\n\\t "}',
]) {
  test(`rejects invalid input ${JSON.stringify(body)}`, async () => {
    assert.deepEqual(await post(body), {
      status: 400,
      body: { status: "invalid_input" },
    });
  });
}

for (const [text, topic] of [
  ["Когда доставка?", "delivery"],
  ["Какая стоимость?", "pricing"],
  ["  Добрый день  ", "other"],
]) {
  test(`returns a validated ${topic} suggestion`, async () => {
    assert.deepEqual(await post(JSON.stringify({ text })), {
      status: 200,
      body: {
        status: "ready",
        topic,
        draft: "Спасибо за обращение. Уточним детали заявки.",
      },
    });
  });
}

for (const marker of ["[timeout]", "[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
  test(`falls back to manual review for ${marker}`, async () => {
    const start = performance.now();
    const response = await post(JSON.stringify({ text: marker }), AbortSignal.timeout(2_000));
    const elapsed = performance.now() - start;
    assert.deepEqual(response, {
      status: 200,
      body: { status: "manual_review", topic: null, draft: null },
    });
    if (marker === "[timeout]") {
      // Allow HTTP/scheduler overhead while detecting the mock's full 1,200 ms wait.
      assert.ok(elapsed >= 250 && elapsed < 1_000, `Timeout took ${elapsed.toFixed(0)} ms`);
    }
    const next = await post(JSON.stringify({ text: "Доставка" }));
    assert.equal(next.body.status, "ready", "The server must remain usable after a failure");
  });
}

test("serves the page", async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(await response.text(), /Входящие заявки/);
});

test("returns 404 for an unknown route", async () => {
  const response = await fetch(`${baseUrl}/missing`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { status: "not_found" });
});
