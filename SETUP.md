# Recreating the idea

This is a wiring guide for the included examples, not an installer. Start with working [Home Assistant MQTT](https://www.home-assistant.io/integrations/mqtt/), [Mosquitto](https://mosquitto.org/documentation/), [Caddy](https://caddyserver.com/docs/), [Companion](https://companion.free/), and [Edge Overlays](https://edgeoverlays.com/). The reference used Mosquitto 2.0.x, Caddy 2, Companion's Generic MQTT connection, and Edge Overlays 2.0.1. Exact Companion/HA versions weren't recorded; check your installed version's UI and validation.

## 1. Pick the connection route

The example uses one HTTPS origin, `rig-messages.example.com`, for both `/overlay/` and `/mqtt`. Supply a real hostname, working DNS, and a certificate trusted by the rig. This is not an instruction to expose anything publicly.

Merge [the Caddy example](../examples/Caddyfile) into your existing configuration, replacing the hostname in both the site address and the Content Security Policy. Mount the contents of `overlay/` at its configured file root. If using Docker, Caddy must be able to resolve/reach the broker service; mount paths and service names depend on your deployment. A new bind mount requires recreating the container; changing an already-mounted static file does not.

Mosquitto needs a WebSocket listener; [the fragment](../examples/mosquitto/listener.conf.example) shows the shape for 2.0.x. Preserve existing listeners, authentication, persistence, and clients. The `mqtt-broker:9001` upstream is an internal example; the rig only connects to Caddy over HTTPS/WSS on 443. Caddy's [reverse proxy handles WebSocket upgrades](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#streaming).

Use your own access policy for that route. Interactive browser login redirects do not authenticate an MQTT WebSocket client. Caddy TLS protects transport; broker credentials and ACLs restrict MQTT access. A dedicated hostname doesn't itself prevent access to other proxied services.

Create two broker accounts using your installation's password-management method: `simrig` for Companion and `simrig_overlay` for the display. Merge [their ACL entries](../examples/mosquitto/acl.example), keeping HA's existing permissions. **Do not use a password-file creation option that overwrites an existing file.** The overlay has only `read simrig/message`; it cannot send commands. No HA token goes on the rig. Follow your broker version's documentation if ACL configuration differs from 2.0.x.

Validate/reload Caddy and Mosquitto using your installation's normal process, then verify existing clients still work. Do not disable certificate verification to make a connection succeed.

## 2. Add Home Assistant's side

Copy [simrig.yaml](../examples/home-assistant/simrig.yaml) into your HA packages directory. If packages aren't enabled, merge this into the existing `homeassistant:` block in `configuration.yaml`:

```yaml
homeassistant:
  packages: !include_dir_named packages
```

Avoid a duplicate `homeassistant:` key. Check for existing `simrig_*` helpers before adding this package. See [HA's packages documentation](https://www.home-assistant.io/docs/configuration/packages/). Validate configuration and restart HA so the new helpers, scripts, timer, and automations load together.

Use [dashboard.yaml](../examples/home-assistant/dashboard.yaml) for a new empty dashboard, or copy its view into an existing dashboard's raw configuration. It shows availability, a message draft and priority, Send, the active message and last reply, and a Clear button only while pending.

Send a message from HA before touching the Deck. Inspect the retained `simrig/message` topic using HA's MQTT tools or an authorized MQTT client. The package republishes state on HA startup/MQTT reconnect. You can also run `script.simrig_control` from Developer Tools → Actions with `operation: publish`. Don't use Developer Tools' Set state as a substitute for running the scripts.

## 3. Connect the Deck through Companion

Install Companion on the rig and use the Elgato Companion plugin to assign individual Companion buttons to Deck keys. That lets the normal Elgato software keep its other iRacing/Discord/audio actions. Avoid having two applications compete for direct USB control. Keep Companion's administration interface restricted to the access you actually need.

Add a **Generic MQTT** connection in Companion with the broker's WSS URL, port 443 if requested separately, and the `simrig` account. Use the module's current help for how it splits protocol, host, path, and port. [Module source/help](https://github.com/bitfocus/companion-module-generic-mqtt). Confirm it connects before adding actions.

These recipes use QoS 1 and **retain off for all commands and heartbeat**. Retained state/messages are published only by HA.

| Item | Publish topic | Payload / behavior |
| --- | --- | --- |
| Status button press | `simrig/command` | `{"command":"cycle_status"}` |
| Heartbeat trigger | `simrig/heartbeat` | Plain text `online`, every 30 seconds |
| Message button short release | `simrig/command` | ACK JSON below |
| Message button held for 1 second | `simrig/command` | Coming shortly JSON below |

The heartbeat needs an enabled **Time interval** event on the trigger, not just a publish action. No condition is necessary for this version. See [Companion triggers](https://companion.free/user-guide/beta/config/triggers/). HA times out after 90 seconds without one; a heartbeat alone does not change Out of rig to Available. Availability still cycles through all three states manually.

For status feedback, use **Get MQTT** with `simrig/state`, JSON parsing off. Map `0` → gray / Out of rig, `1` → green / Available, and `2` → red / Racing. These are confirmed HA values, not a local optimistic counter. Show a distinct unknown-data appearance until a value arrives. A previously retained value is not a live connectivity indicator.

For the message button, use **Get MQTT** on `simrig/message`, JSON parsing on, and expose the parsed object as the button-local variable `message`. The exact variable/feedback controls depend on Companion's version. The following expressions assume `$(local:message)` is that object.

Background-color expression, including an optional attention pulse:

```javascript
$(local:message) && $(local:message).pending && blink(1000)
  ? ($(local:message).priority == 'urgent' ? 0xCC0000 : 0xFFAA00)
  : 0x303030
```

For an always-lit pending indicator, remove `&& blink(1000)`. The on-screen overlay itself doesn't flash.

ACK publish payload, in **expression mode**:

```javascript
jsonstringify({command:"ack",message_id:$(local:message)?$(local:message).id:""})
```

Coming shortly publish payload, in expression mode:

```javascript
jsonstringify({command:"coming_shortly",message_id:$(local:message)?$(local:message).id:""})
```

Leave Press empty. Put ACK under **Short release**, and Coming shortly under a **1,000 ms duration/hold group**. Verify a hold does not also fire ACK on release. If your version doesn't distinguish short release, use separate buttons until you can configure mutually exclusive tap/hold actions. Use the current message ID; don't hard-code it.

## 4. Show the message in Edge Overlays

Open `https://YOUR-HOST/overlay/` in a browser first. On HTTPS, the page proposes `wss://YOUR-HOST/mqtt`; enter the **read-only** account. Send from HA, reply on the Deck, and confirm the page clears. The MQTT client files are included in `overlay/vendor/`; transfer those files intact instead of pasting minified code. No CDN or build step is required.

Add a **Webview** to your active Edge Overlays layout using that URL. Log in inside its Webview as well: don't assume it shares your regular browser's storage. Enable **Transparent Background** in the overlay's settings, then use:

```text
https://YOUR-HOST/overlay/?compact=1
```

Compact mode centers the card in the Webview, caps the card at 420 CSS pixels, and hides the extra instructions/settings gear. Use `?compact=1&settings=1` to reopen login settings. Font, maximum card width, spacing, and colors are in [overlay.css](../overlay/overlay.css). The card is centered; its text is left-aligned.

Place it clear of important racing information, enable it in the layout variations you use, and lock the overlays so clicks pass through. Test while locked: editing mode adds controls/outlines. The Webview can remain larger than the visible card. Don't assume its corner scale handle independently changes viewport dimensions.

**Remember** persists the read-only login in this Webview profile's local storage; otherwise it's session storage. Both are readable by scripts on the same origin, so use the scoped account and only trusted content there. **Forget login** removes this page's saved login. Verify persistence after an Edge Overlays restart if you choose Remember.

## 5. Check the behavior, not just “connected”

- Normal and urgent messages appear, including a full 180-character message without clipping.
- Tap ACK and hold Coming shortly each clear the page and update HA; a hold sends one reply.
- HA Clear removes a message. A cleared message stays gone after reload; a pending one reappears.
- Sending a second message replaces the first. A reply with the first ID cannot clear the second.
- Stopping Companion resets availability within the timeout. Leaving Companion running does not prove presence.
- Disconnecting MQTT shows an offline/stale notice and reconnects. This does not monitor HA end to end.
- Existing services still work; the overlay account can't publish commands or read unrelated topics.
- Compare game frame times/FPS with the display enabled and disabled on your hardware.

## MQTT contract and local previews

Keep these names consistent across HA, Companion, and broker ACLs:

| Topic | Writer → reader | Retained | Format |
| --- | --- | --- | --- |
| `simrig/state` | HA → Companion | Yes | Text `0`, `1`, or `2` |
| `simrig/message` | HA → Companion + Webview | Yes | JSON below |
| `simrig/command` | Companion → HA | No | `cycle_status`, `ack`, or `coming_shortly` command JSON |
| `simrig/heartbeat` | Companion → HA | No | Text `online` |

```json
{"id":"sample-001","text":"Dinner in 10 minutes.","priority":"normal","pending":true,"reply":"Awaiting acknowledgement."}
```

HA clears by publishing a replacement with `pending:false` and empty `id`/`text`. MQTT retention is the latest value per topic, not a conversation queue. The overlay renders message text literally, not as HTML.

For offline previews, serve the `overlay/` folder with a local static server, then append `?compact=1&demo=normal` or `?compact=1&demo=urgent`. For example, if Python is installed, run `python -m http.server 8080 --bind 127.0.0.1 --directory overlay` from the repository root and open `http://127.0.0.1:8080/?compact=1&demo=normal`. These sample modes do not connect to MQTT. Optional offline checks: `node tests/overlay.cjs` (no npm install required). They test parsing and page behavior with a fake MQTT client, not your live integrations.
