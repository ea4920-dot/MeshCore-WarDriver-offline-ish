"use strict";

const {readFileSync} = require("node:fs");
const {runInNewContext} = require("node:vm");
const {test} = require("node:test");
const assert = require("node:assert/strict");

const html = readFileSync(new URL("../index.html", `file://${__filename}`), "utf8");

function extract(startText, endText) {
  const start = html.indexOf(startText);
  const end = html.indexOf(endText, start);
  assert.notEqual(start, -1, `Missing source: ${startText}`);
  assert.notEqual(end, -1, `Missing source boundary: ${endText}`);
  return html.slice(start, end);
}

const sessionHelpers = extract(
  "function receiverSessionPrefix(",
  "\nfunction cancelRecordingStart("
);
const beginRecording = extract(
  "async function beginRecordingWithGPS()",
  "\nfunction receiverSessionPrefix("
);
const classifyServerEntry = extract(
  "function classifyServerEntry(",
  "\nasync function recordVerification("
);
const attemptSessionUpload = extract(
  "async function attemptSessionUpload(",
  "\nasync function uploadManagedSession("
);
const syncPending = extract(
  "async function syncPending()",
  "\n/* One-button connection and recording controls */"
);

test("receiver session IDs are sanitized, bounded, and timestamped", () => {
  const {createReceiverSessionId, receiverSessionPrefix} =
    runInNewContext(`${sessionHelpers};({createReceiverSessionId,receiverSessionPrefix})`);
  const timestamp = new Date("2026-11-27T10:15:23.123Z");
  assert.equal(
    createReceiverSessionId("Terracan Mobile/RX!", timestamp),
    "Terracan-Mobile-RX_2026-11-27T10:15:23.123Z"
  );
  assert.equal(createReceiverSessionId(undefined, timestamp),
    "Unknown-Receiver_2026-11-27T10:15:23.123Z");
  assert.equal(receiverSessionPrefix("A".repeat(55)).length, 40);
  assert.equal(receiverSessionPrefix("Éloïse RX"), "Éloïse-RX");
});

test("timestamp-only historical IDs and receiver-prefixed IDs sort by timestamp", () => {
  const {sessionTimestamp, sessionReceiverName, compareSessionIds} =
    runInNewContext(`${sessionHelpers};({sessionTimestamp,sessionReceiverName,compareSessionIds})`);
  const historical = "2026-11-27T10:15:23.123Z";
  const older = "Receiver_A_2026-11-26T10:15:23.123Z";
  const newer = "Receiver-B_2026-11-28T10:15:23.123Z";
  assert.equal(sessionTimestamp(historical), historical);
  assert.equal(sessionReceiverName(historical), "");
  assert.equal(sessionTimestamp(older), "2026-11-26T10:15:23.123Z");
  assert.equal(sessionReceiverName(older), "Receiver_A");
  assert.deepEqual([historical, newer, older].sort(compareSessionIds),
    [newer, historical, older]);
});

test("recording IDs are created after GPS fix and stay fixed across disconnects", async () => {
  const timestamps = [
    "2026-11-27T10:15:23.123Z",
    "2026-11-27T10:20:00.000Z"
  ];
  class TestDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [timestamps.shift()]));
    }
  }
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {textContent: ""});
    return elements.get(id);
  };
  let hasFix = false;
  const writes = [];
  const context = {
    Date: TestDate,
    recordingStartPending: true,
    recordingStartBusy: false,
    recordingSessionPrepared: false,
    hasFreshGPSFix: () => hasFix,
    managerUploadingId: null,
    updateButtons: () => {},
    recording: false,
    syncBusy: false,
    db: {},
    completedSession: true,
    device: {name: "Terracan Mobile RX", gatt: {connected: true}},
    sessionId: "historical-id",
    recordingReceiverName: "",
    lastRecordingSessionTimestamp: 0,
    sessionPacketEstimateCount: 0,
    sessionUploadEstimatedBytes: 0,
    emptyUploadPayloadBytes: () => 128,
    dbPut: async (store, value) => writes.push({store, value}),
    packetCount: 8,
    trackCount: 3,
    noGps: 2,
    rxCount: 8,
    updateCounts: () => {},
    $: element,
    currentSessionPackets: [],
    rebuildObservationCounts: () => {},
    packetLayer: null,
    trackLine: null,
    sessionDisplayName: id => id,
    lastTrackAt: 0,
    log: () => {},
    updateRecordingGPSStatus: () => {},
    stopGPSAfterWrites: async () => {}
  };
  const app = runInNewContext(
    `${sessionHelpers}\n${beginRecording}\n({beginRecordingWithGPS})`,
    context
  );

  await app.beginRecordingWithGPS();
  assert.equal(writes.length, 0, "no session ID before a fresh GPS fix");

  hasFix = true;
  await app.beginRecordingWithGPS();
  const firstId = context.sessionId;
  assert.equal(firstId, "Terracan-Mobile-RX_2026-11-27T10:15:23.123Z");
  assert.equal(context.recording, true);
  assert.equal(writes[0].value.value, firstId);

  context.device = null;
  assert.equal(context.sessionId, firstId, "disconnect does not rename active session");
  context.recording = false;
  context.recordingStartPending = true;
  context.completedSession = true;
  context.device = {name: "Next_RX", gatt: {connected: true}};
  await app.beginRecordingWithGPS();
  assert.equal(context.sessionId, "Next_RX_2026-11-27T10:20:00.000Z");
  assert.notEqual(context.sessionId, firstId);
  assert.equal(writes[1].value.value, context.sessionId);
});

test("manual upload and server duplicate checks retain the full prefixed ID", async () => {
  const id = "Terracan-Mobile-RX_2026-11-27T10:15:23.123Z";
  const packets = [{id: 1, session: id, payload: "packet-data"}];
  const track = [{id: 1, session: id, lat: 1, lon: 2}];
  let rows = [{id, packets: 1, track: 1}];
  let posts = 0;
  let verified = 0;
  const context = {
    serverBase: () => "https://map.example",
    activeSession: () => false,
    dbCountFor: async store => store === "packets" ? packets.length : track.length,
    dbGet: async () => ({status: "saved"}),
    fetchServerSessions: async () => rows,
    serverEntryFor: (list, sessionId) =>
      list.find(row => row.id === sessionId) || null,
    classifyServerEntry: runInNewContext(`(${classifyServerEntry})`),
    recordVerification: async () => {},
    markSessionVerified: async () => {verified++;},
    setSessionVerificationUnavailable: async () => {},
    uploadToken: "test-token",
    confirm: () => true,
    dbPut: async () => {},
    refreshPending: async () => {},
    dbAllFor: async store => store === "packets" ? packets : track,
    postSession: async (sessionId, uploadedPackets, uploadedTrack) => {
      posts++;
      assert.equal(sessionId, id);
      assert.deepEqual(uploadedPackets, packets);
      assert.deepEqual(uploadedTrack, track);
      return "saved";
    },
    finishPostWithVerification: async () => ({status: "Verified"}),
    refreshSessionManager: async () => {}
  };
  const upload = runInNewContext(`(${attemptSessionUpload})`, context);

  assert.equal((await upload(id, {manual: true})).status, "Verified");
  assert.equal(posts, 0, "matching server record is not duplicated");
  assert.equal(verified, 1);

  rows = [{id, packets: 2, track: 1}];
  assert.equal((await upload(id, {manual: true})).status, "Count mismatch");
  assert.equal(posts, 0, "mismatched server record is not overwritten");

  rows = [];
  assert.equal((await upload(id, {manual: true})).status, "Verified");
  assert.equal(posts, 1, "manual recovery uploads a confirmed-missing ID");
});

test("pending retry passes the complete prefixed ID to the upload path", async () => {
  const id = "Terracan-Mobile-RX_2026-11-27T10:15:23.123Z";
  const seen = [];
  let pendingReads = 0;
  const context = {
    syncBusy: false,
    managerUploadingId: null,
    db: {},
    refreshPending: async () => [id],
    syncUrl: "https://map.example",
    uploadToken: "test-token",
    serverBase: () => "https://map.example",
    fetchServerSessions: async () => [],
    activeSession: () => false,
    syncState: () => {},
    dbCountFor: async () => 1,
    dbGet: async () => null,
    serverEntryFor: () => null,
    recordVerification: async () => {},
    refreshSessionManager: async () => {},
    attemptSessionUpload: async (sessionId, options) => {
      seen.push({sessionId, options});
      return {status: "Verified"};
    },
    log: () => {},
    pendingIds: async () => pendingReads++ === 0 ? [id] : [],
    classifyServerEntry: () => ({status: "Verified"}),
    markSessionVerified: async () => {},
    setSessionVerificationUnavailable: async () => {}
  };
  await runInNewContext(`(${syncPending})`, context)();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].sessionId, id);
  assert.deepEqual(seen[0].options.knownRows, []);
});
