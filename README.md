# MeshCore WarDriver

**A browser-based, GPS-enabled MeshCore reception and repeater-coverage recorder.**

MeshCore WarDriver connects to a compatible MeshCore companion node using Web Bluetooth, records received radio packets alongside GPS coordinates and signal measurements, and displays reception observations on an interactive map. It is designed for mobile wardriving and can synchronise completed sessions to a separate coverage-map server.

**Current documented version:** v0.7.8.1

> WarDriver measures reception at your own radio. Its *likely last-hop* repeater matches are estimates based on MeshCore flood-routing identifiers, not proof of direct RF reception or continuous coverage.

## Features

- Connect to a MeshCore companion node over Web Bluetooth, with reconnect controls.
- Start and stop GPS tracking and recording independently.
- Record received packet timestamps, RSSI, SNR, GPS position, GPS accuracy, and raw packet data.
- Show RSSI-coloured reception dots on a Leaflet / OpenStreetMap map.
- Import a MeshCore discovered-contacts JSON file; retain **type 2 repeaters only**.
- Show a searchable, alphabetically sorted **Repeaters** tab containing only repeaters with recorded, attributable reception evidence in the current session.
- Select a heard repeater to filter its reception observations on the map.
- Switch between **Both / Direct / Likely** evidence views.
- Export packets as CSV, GPS track points as CSV, and mapped observations as GeoJSON.
- Save recordings locally in browser IndexedDB and queue completed sessions for optional server upload.
- Name new session IDs with the connected receiver's sanitized Bluetooth name and recording timestamp; historical session IDs remain unchanged.
- Automatically rotate recordings at 500 packets or an estimated 5 MB upload payload (with a safety margin), queueing completed sessions for server sync while GPS and Bluetooth recording continue.
- Show synchronisation state, including pending uploads and failures.

## Quick start

1. Open the hosted WarDriver page in a browser with working Web Bluetooth support.
2. Tap **Connect Node** and select your compatible MeshCore companion device.
3. Tap **Start GPS** and allow location access.
4. Optional: under **Settings**, import your MeshCore discovered-contacts JSON file to enable repeater names and likely last-hop matching.
5. Tap **Start recording** before your survey and **Stop recording** when finished.
6. Use the **Map** and **Repeaters** tabs to inspect observations, then export a backup from **Settings**.

For iPhone use, Safari with a suitable Bluetooth bridge such as Beacio has been used in testing; Bluefy has also been used. Browser and bridge capabilities vary, so confirm Bluetooth and file-export behaviour on your own device before relying on it for a long survey. Other browsers must support the required Web Bluetooth and geolocation APIs.

**Keep the browser in the foreground while recording.** iOS can suspend Bluetooth, GPS, or page execution when the screen locks. Keeping the screen awake may be necessary for uninterrupted recording.

## Repeater identification: what the labels mean

WarDriver reads supported MeshCore packet routing fields and compares **1-, 2-, or 3-byte** routing identifiers with the imported repeater directory.

| Classification | Meaning |
| --- | --- |
| **Likely** | The final flood-routing identifier uniquely matches one repeater in the imported directory. This is an estimate of the last relay, not authenticated transmitter identity. |
| **Ambiguous** | The identifier matches multiple imported repeaters. It is not attributed to a single repeater. |
| **Unknown** | The packet does not provide sufficient supported evidence for repeater attribution. |
| **Direct** | Reserved for verified direct-transmitter evidence. The current decoder does **not** establish this from ordinary routing information. |

A unique match in your local directory is not necessarily globally unique. Short hashes can collide, and the directory may be incomplete. Direct-routed packets must not be treated as if their route list identifies the previous RF transmitter.

The **Repeaters** tab shows only repeaters with at least one uniquely attributed likely last-hop observation (or verified direct evidence, if supported in future). The full imported directory remains available internally for matching and map markers. Published repeater locations are directory data, **not** evidence that your node received them.

## Map and measurements

The map uses colour thresholds for received RSSI:

| RSSI at receiving node | Display colour |
| --- | --- |
| âˆ’90 dBm or stronger | Green |
| âˆ’110 to below âˆ’90 dBm | Yellow |
| âˆ’120 to below âˆ’110 dBm | Orange |
| Below âˆ’120 dBm | Red |

These are visual thresholds, not validated coverage grades. RSSI and SNR describe what **your receiving node** measured at a particular place and time. The absence of a dot does not necessarily mean there is no radio coverage: no packet may have been transmitted during that interval.

The blue GPS driving line is hidden; the map focuses on reception dots. The **Both / Direct / Likely** selector controls evidence filtering. With no repeater selected, **Both** shows general receptions, including unknown observations.

## Recording and storage

WarDriver stores packets, GPS track points, and session metadata in the browser's **IndexedDB**. Data is local to that browser and website origin: Safari and Bluefy do not automatically share the same recordings or repeater directory.

- **Stopping recording** finishes the session and can queue it for upload.
- **New session** starts a fresh active session; older data may remain stored but is not necessarily shown or exported by the current-session interface.
- **Clearing browser website data** can delete locally stored recordings and imported repeater information.

Export important recordings before changing browser settings or clearing site data. On iPhone, an export may first prepare a file and then show separate **Download** and **Share** actions. Saving a file should be verified in the Files app.

## Optional server synchronisation

WarDriver can optionally upload **completed sessions** to a compatible **self-hosted Docker map server**. You can run your own map server on a home server, NAS, VPS, or another Docker-capable machine. WarDriver does not stream live Bluetooth packets to the server, and a server is not required for local recording or exports.

In **Settings â†’ Map server synchronisation**:

1. Enter the HTTPS base URL of your map server, for example `https://your-map-server.example`.
2. Enter the upload token provided by the server administrator.
3. Stop a recording to queue/synchronise the completed session, or use **Retry pending uploads**.
4. Check the sync indicator for uploading, pending, completed, or failed status.
5. Use **Session Manager** to find any locally saved session, verify its packet and track counts against the server, or upload/retry it individually. Session discovery includes recordings without a pending-upload marker.

The upload API uses `POST /api/sessions` with bearer-token authentication. A compatible self-hosted Docker map server can combine historical sessions and generate RSSI heatmaps and repeater-specific coverage comparisons. The server needs its **own repeater directory** for centralised identification; importing repeaters into WarDriver does not automatically import them to the server.

Session verification uses `GET /api/sessions`. The current server returns at most 500 sessions, so an absent ID cannot be confirmed missing when that list is full. WarDriver reports this limit rather than treating the session as missing. A local synced marker alone is not considered server verification.

**Security:** Do not commit upload tokens or private recordings to a public GitHub repository. Use HTTPS for the public upload endpoint.

## Hosting on GitHub Pages

WarDriver is a client-side web application, primarily contained in `index.html`. To publish it:

1. Put `index.html` in your GitHub repository.
2. Enable **GitHub Pages** for the intended branch and folder.
3. Open the published HTTPS URL in a compatible browser.

The map uses Leaflet and OpenStreetMap tiles loaded from online services. GPS and packet storage can continue locally, but map tiles may not be available without an internet connection or an existing browser cache.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| **Connect Node** unavailable | Browser/bridge supports Web Bluetooth; page is served over HTTPS; companion node is powered on. |
| Bluetooth disconnects when locked | Keep iPhone awake and WarDriver in the foreground. |
| **Storage: Ready**, but no export | Check the active session's saved-packet count, then use the prepared Download/Share action. |
| Repeaters list empty | Import the discovered-contacts JSON and record packets with uniquely attributable last-hop evidence. |
| **Direct** view empty | Expected until the application has independently verified direct-transmitter evidence. |
| Map tiles missing | Check internet access and availability of the tile provider. |
| Upload remains pending | Confirm HTTPS server URL, token, server availability, and completed-session status. |

## Limitations and safety

- Repeater coverage shown by likely last-hop matching is **estimated** and may be affected by hash collisions, missing directory entries, or unsupported packet forms.
- Reception dots and server heatmaps represent **observations**, not guaranteed or predicted RF coverage.
- Browser backgrounding and screen locking may interrupt mobile recording.
- Location and radio reception data can reveal journeys and places visited. Review exports before sharing them publicly.
- Configure the device before driving. Do not interact with the phone while driving; have a passenger operate it if necessary.

## Related project

You can optionally run your own **MeshCore Map Server** using Docker to combine uploaded wardrives, display historical coverage, and compare likely last-hop repeater observations. Set up your own HTTPS endpoint and upload token, then configure them in WarDriver under **Settings â†’ Map server synchronisation**. WarDriver itself does not require Docker or a server for local recording or exports.

## Project status

v0.7.8.1 is the currently documented WarDriver version. New session IDs include the connected receiver name and timestamp; older timestamp-only IDs remain supported and are not migrated. Its Bluetooth, GPS, recording, heard-only repeater selection, session management, and export workflows have been exercised during development; behaviour still depends on the browser, Bluetooth bridge, and companion firmware. Server synchronisation should be tested against each deployment before relying on automatic backups.
