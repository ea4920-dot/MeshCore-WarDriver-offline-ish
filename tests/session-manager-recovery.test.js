"use strict";

const {readFileSync} = require("node:fs");
const {runInNewContext} = require("node:vm");
const {test} = require("node:test");
const assert = require("node:assert/strict");

const html = readFileSync(new URL("../index.html", `file://${__filename}`), "utf8");
const start = html.indexOf("async function attemptSessionUpload(");
const end = html.indexOf("\nasync function uploadManagedSession(", start);
const uploadFunction = html.slice(start, end);

test("manual recovery retries an acknowledged session only after definitive absence", async () => {
  const sessionId = "2026-01-02T03:04:05.000Z";
  const packets = [{id: 1, session: sessionId, payload: "unchanged"}];
  const track = [{id: 1, session: sessionId, lat: 1, lon: 2}];
  let serverRows = [];
  let requests = 0;
  const context = {
    serverBase: () => "https://map.example",
    activeSession: () => false,
    dbCountFor: async store => store === "packets" ? packets.length : track.length,
    dbGet: async () => ({status: "saved"}),
    fetchServerSessions: async () => {
      if (serverRows === null) throw new Error("offline");
      return serverRows;
    },
    serverEntryFor: (rows, id) => rows.find(row => row.id === id) || null,
    classifyServerEntry: () => ({status: "Verified"}),
    recordVerification: async () => {},
    markSessionVerified: async () => {},
    setSessionVerificationUnavailable: async () => {},
    uploadToken: "test-token",
    confirm: () => true,
    dbPut: async () => {},
    refreshPending: async () => {},
    dbAllFor: async store => store === "packets" ? packets : track,
    postSession: async (id, uploadedPackets, uploadedTrack) => {
      requests++;
      assert.equal(id, sessionId);
      assert.deepEqual(uploadedPackets, packets);
      assert.deepEqual(uploadedTrack, track);
      return "saved";
    },
    finishPostWithVerification: async () => ({status: "Verified"}),
    refreshSessionManager: async () => {}
  };
  const attemptSessionUpload = runInNewContext(`(${uploadFunction})`, context);

  const recovered = await attemptSessionUpload(sessionId, {manual: true});
  assert.equal(recovered.status, "Verified");
  assert.equal(requests, 1);

  const automatic = await attemptSessionUpload(sessionId, {manual: false});
  assert.equal(automatic.status, "Verification unavailable");
  assert.equal(requests, 1);

  serverRows = Array.from({length: 500}, (_, index) => ({
    id: `other-${index}`,
    packets: 0,
    track: 0
  }));
  const limited = await attemptSessionUpload(sessionId, {manual: true});
  assert.equal(limited.status, "Not confirmed — server list limit");
  assert.equal(requests, 1);

  serverRows = null;
  const unavailable = await attemptSessionUpload(sessionId, {manual: true});
  assert.equal(unavailable.status, "Verification unavailable");
  assert.equal(requests, 1);
});
