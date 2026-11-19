# The Beacon

One line of plain text that says whether the bird is up. Built for
Home Assistant, a lamp on the garage bench, or anything else that can
make an HTTP GET.

```
GET https://smokysignal.app/api/status.txt
```

```
up
count=1
fetched_at=2026-11-18T15:11:50.000Z
age_s=10
```

The first line is the whole answer. Read it and stop if that's all you need.

| First line | Means |
|---|---|
| `up` | At least one Smokey-class bird is up (WSP, sheriff or federal patrol). |
| `down` | Nothing up, or only rescue and transport flights. |
| `stale` | We can't vouch for the read: no data, every feed failed, or the last read is more than 2 minutes old. Treat it as unknown, not as clear. |

| Field | Meaning |
|---|---|
| `count` | Smokey-class birds up in the last read. Rescue and transport flights are not counted. On `stale` this is the last known count. |
| `fetched_at` | ISO 8601 UTC time of the last read. Empty when there is none. |
| `age_s` | Seconds since that read. Empty when there is none. |

JSON variant, same fields:

```
GET https://smokysignal.app/api/status.json
{"state":"up","count":1,"fetched_at":"2026-11-18T15:11:50.000Z","age_s":10}
```

On `stale`, `fetched_at` and `age_s` are `null` when there is no read at all.

### Caching and polling

- Healthy reads carry `Cache-Control: public, s-maxage=15, stale-while-revalidate=15`
  and a weak `ETag`. Send `If-None-Match` and you get a `304` until the next read lands.
- `stale` responses carry `Cache-Control: no-store`, so you see recovery on the next poll.
- Poll every 30 seconds. Faster than 15 seconds gets you the same cached answer.
- `?mock=up`, `?mock=down` and `?mock=stale` return fixed states for testing your rig.
  Don't leave a mock URL on a live light.
- `?region=puget_sound` (any id from `/embed/help`) counts only birds inside that region.
  Unknown ids and `all_wa` mean the whole state.

## Home Assistant

REST sensor in `configuration.yaml`. One request every 30 seconds feeds a state
sensor and a count sensor.

```yaml
rest:
  - resource: https://smokysignal.app/api/status.json
    scan_interval: 30
    timeout: 10
    sensor:
      - name: "SmokySignal"
        unique_id: smokysignal_state
        icon: mdi:airplane
        value_template: "{{ value_json.state }}"
        json_attributes:
          - count
          - fetched_at
          - age_s
      - name: "SmokySignal birds up"
        unique_id: smokysignal_count
        icon: mdi:counter
        state_class: measurement
        value_template: "{{ value_json.count }}"

template:
  - binary_sensor:
      - name: "Smokey up"
        unique_id: smokysignal_up
        state: "{{ is_state('sensor.smokysignal', 'up') }}"
        # Unavailable instead of "off" when the feed is stale or unreachable.
        availability: "{{ states('sensor.smokysignal') in ['up', 'down'] }}"
```

Drive a light off it:

```yaml
automation:
  - alias: "Shop lamp follows Smokey"
    trigger:
      - platform: state
        entity_id: sensor.smokysignal
    action:
      - choose:
          - conditions: "{{ trigger.to_state.state == 'up' }}"
            sequence:
              - service: light.turn_on
                target: { entity_id: light.shop_lamp }
                data: { rgb_color: [255, 80, 0] }
          - conditions: "{{ trigger.to_state.state == 'down' }}"
            sequence:
              - service: light.turn_on
                target: { entity_id: light.shop_lamp }
                data: { rgb_color: [0, 220, 90] }
        default:
          - service: light.turn_on
            target: { entity_id: light.shop_lamp }
            data: { rgb_color: [255, 255, 255], brightness_pct: 30 }
```

## ESP32 light

An ESP32 dev board and one RGB LED. Orange when Smokey's up, green when down,
dim white when the read is stale or the board can't reach us.

Arduino IDE, ESP32 board package 2.x or 3.x. No extra libraries.

```cpp
// SmokySignal Beacon light. Polls /api/status.txt every 30 s.
//   orange = up, green = down, white = stale or error
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

const char* WIFI_SSID = "your-ssid";
const char* WIFI_PASS = "your-password";
const char* URL       = "https://smokysignal.app/api/status.txt";

// Common-cathode RGB LED. For common-anode, set this to true.
const bool COMMON_ANODE = false;
const int PIN_R = 25;
const int PIN_G = 26;
const int PIN_B = 27;

const unsigned long POLL_MS = 30000;

void setColor(int r, int g, int b) {
  if (COMMON_ANODE) { r = 255 - r; g = 255 - g; b = 255 - b; }
  analogWrite(PIN_R, r);
  analogWrite(PIN_G, g);
  analogWrite(PIN_B, b);
}

void showUp()    { setColor(255, 60, 0); }   // orange
void showDown()  { setColor(0, 255, 40); }   // green
void showStale() { setColor(90, 90, 90); }   // dim white

String fetchState() {
  if (WiFi.status() != WL_CONNECTED) return "";
  WiFiClientSecure client;
  // Skips TLS certificate checks to keep the sketch short. The response
  // is public and read-only. Pin a root CA with client.setCACert() if
  // you want the check.
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(10000);
  if (!http.begin(client, URL)) return "";
  int code = http.GET();
  String state = "";
  if (code == 200) {
    String body = http.getString();
    int nl = body.indexOf('\n');
    state = (nl >= 0 ? body.substring(0, nl) : body);
    state.trim();
  }
  http.end();
  return state;
}

void setup() {
  pinMode(PIN_R, OUTPUT);
  pinMode(PIN_G, OUTPUT);
  pinMode(PIN_B, OUTPUT);
  showStale();
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    showStale();
    WiFi.reconnect();
    delay(5000);
    return;
  }
  String s = fetchState();
  if (s == "up") showUp();
  else if (s == "down") showDown();
  else showStale();  // "stale", HTTP error, timeout, anything unexpected
  delay(POLL_MS);
}
```

### Wiring

```
ESP32 GPIO25 ──[ 220 Ω ]── R ┐
ESP32 GPIO26 ──[ 100 Ω ]── G ├─ RGB LED (common cathode)
ESP32 GPIO27 ──[ 100 Ω ]── B ┘
ESP32 GND ─────────────── common (longest leg)
```

- One resistor per colour leg. Never wire an LED straight to a pin.
- Green and blue drop about 3 V, which leaves little headroom on a 3.3 V pin,
  so they get the smaller resistor. Red drops about 2 V and gets 220 Ω. That
  keeps every leg well under 10 mA.
- Common-anode LED: the long leg goes to 3V3 instead of GND, and set
  `COMMON_ANODE = true`.
- GPIO 25, 26 and 27 are safe output pins on most dev boards. Avoid 6 to 11
  (flash) and 34 to 39 (input only).
- Want it visible across the shop? Swap the LED for a short WS2812 strip, or
  drive a 12 V strip through three logic-level MOSFETs. Don't pull more than
  a few milliamps through a GPIO.
- Power it from any USB charger. Draw is under 1 W.

### Troubleshooting

- Stays white: check the serial monitor for Wi-Fi, then load the URL in a
  browser. If the browser also reads `stale`, the feed is quiet on our end.
- Test without waiting for a flight: point `URL` at
  `https://smokysignal.app/api/status.txt?mock=up` and you should see orange.
