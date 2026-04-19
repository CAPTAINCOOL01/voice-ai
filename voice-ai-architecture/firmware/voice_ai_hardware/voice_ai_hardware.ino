#include <Arduino.h>
#include <SPI.h>
#include <SD.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <ESPAsyncWebServer.h>
#include "driver/i2s.h"
#include <time.h>

/* ─────────────────────────────────────────
   USER CONFIG
   ───────────────────────────────────────── */
#define WIFI_SSID     "TPF_2.4G"
#define WIFI_PASS     "7017138349"
#define BACKEND_HOST  "voice-ai-da3b.onrender.com"
#define BACKEND_PORT  443
#define BACKEND_PATH  "/save"
#define ESP32_API_KEY "47dd2cc5700acd20f3f90b9cc7e6821014abf93c41d32c76e00a446ad80cf267"

/* ─────────────────────────────────────────
   PINS — ESP32-C3 Mini
   ───────────────────────────────────────── */
#define PIN_I2S_WS    4   // INMP441 WS  (LRCK)
#define PIN_I2S_SCK   5   // INMP441 SCK (BCLK)
#define PIN_I2S_SD    3   // INMP441 SD  (DATA)

#define PIN_SD_CS    10   // MicroSD CS
#define PIN_SD_MOSI   7   // MicroSD MOSI
#define PIN_SD_MISO   2   // MicroSD MISO
#define PIN_SD_SCK    6   // MicroSD SCK

#define PIN_TOGGLE    8   // Toggle switch Common pin (HIGH = record, LOW = stop)

/* ─────────────────────────────────────────
   AUDIO CONFIG
   ───────────────────────────────────────── */
#define SAMPLE_RATE      16000
#define BITS_PER_SAMPLE  16
#define CHANNELS         1
#define I2S_PORT         I2S_NUM_0

/* ─────────────────────────────────────────
   GLOBALS
   ───────────────────────────────────────── */
AsyncWebServer webServer(80);

File     wavFile;
bool     recording    = false;
uint32_t bytesWritten = 0;
uint16_t fileIndex    = 0;
uint32_t recStartMs   = 0;
char     currentFile[32];  // e.g. /2026-04-16_09-32-15.wav
bool     firstRead     = true;
uint32_t lastLog       = 0;

// Write buffer — accumulate samples in RAM, write 4KB at a time to SD
#define SD_WRITE_BUF 4096
uint8_t  sdBuf[SD_WRITE_BUF];
uint16_t sdBufPos = 0;

/* ─────────────────────────────────────────
   WAV HELPERS
   ───────────────────────────────────────── */
void writeWavHeader(File &f) {
  uint32_t zero32   = 0;
  uint32_t fmtSize  = 16;
  uint16_t audioFmt = 1;
  uint16_t channels = CHANNELS;
  uint32_t rate     = SAMPLE_RATE;
  uint16_t bits     = BITS_PER_SAMPLE;
  uint32_t byteRate = rate * channels * (bits / 8);
  uint16_t align    = channels * (bits / 8);

  f.write((const uint8_t*)"RIFF", 4); f.write((uint8_t*)&zero32,   4);
  f.write((const uint8_t*)"WAVE", 4);
  f.write((const uint8_t*)"fmt ", 4); f.write((uint8_t*)&fmtSize,  4);
  f.write((uint8_t*)&audioFmt, 2);    f.write((uint8_t*)&channels, 2);
  f.write((uint8_t*)&rate,     4);    f.write((uint8_t*)&byteRate, 4);
  f.write((uint8_t*)&align,    2);    f.write((uint8_t*)&bits,     2);
  f.write((const uint8_t*)"data", 4); f.write((uint8_t*)&zero32,   4);
}

void finalizeWav(const char* path) {
  Serial.printf("[WAV]  Finalizing %s ...\n", path);

  // Give SD card time to commit all buffered writes
  delay(300);

  // Check actual file size on SD
  File check = SD.open(path);
  if (!check) { Serial.println("[WAV]  ✗ Cannot open file"); return; }
  uint32_t fileSize = check.size();
  check.close();
  Serial.printf("[WAV]  SD file size: %u bytes\n", fileSize);

  if (fileSize < 100) {
    Serial.println("[WAV]  ✗ File too small — SD did not flush data properly");
    return;
  }

  uint32_t dataSize = fileSize - 44;
  uint32_t riffSize = fileSize - 8;

  // Update the 8 header bytes in-place using r+ (no copy, no delete, no data loss)
  File f = SD.open(path, "r+");
  if (!f) { Serial.println("[WAV]  ✗ Cannot open in r+ mode"); return; }
  f.seek(4);  f.write((uint8_t*)&riffSize, 4);
  f.seek(40); f.write((uint8_t*)&dataSize, 4);
  f.close();

  Serial.printf("[WAV]  ✓ Header updated — %u bytes audio, %u bytes total\n", dataSize, fileSize);
}

/* ─────────────────────────────────────────
   HTTP UPLOAD
   ───────────────────────────────────────── */
void sendToBackend(const char* path, uint32_t durationSecs) {
  Serial.println("[HTTP] Uploading to backend...");

  if (WiFi.status() != WL_CONNECTED) { Serial.println("[HTTP] ✗ No WiFi — skipping upload"); return; }

  File f = SD.open(path);
  if (!f) { Serial.println("[HTTP] ✗ Cannot open WAV file"); return; }
  Serial.printf("[HTTP] File: %s (%u bytes)\n", path, f.size());

  String filename = String(path);
  if (filename.startsWith("/")) filename = filename.substring(1);
  if (!filename.endsWith(".wav")) filename += ".wav";

  String boundary = "----ESP32C3Boundary";
  String filePart =
    "--" + boundary + "\r\n"
    "Content-Disposition: form-data; name=\"audio\"; filename=\"" + filename + "\"\r\n"
    "Content-Type: audio/wav\r\n\r\n";
  String durPart =
    "\r\n--" + boundary + "\r\n"
    "Content-Disposition: form-data; name=\"duration\"\r\n\r\n" +
    String(durationSecs) + "\r\n";
  String endPart = "--" + boundary + "--\r\n";

  uint32_t totalLen = filePart.length() + f.size() + durPart.length() + endPart.length();

  WiFiClientSecure client;
  client.setInsecure();
  Serial.printf("[HTTP] Connecting to %s ...\n", BACKEND_HOST);
  if (!client.connect(BACKEND_HOST, BACKEND_PORT)) {
    Serial.println("[HTTP] ✗ Cannot reach backend");
    f.close(); return;
  }
  Serial.println("[HTTP] ✓ Connected");

  client.printf("POST %s HTTP/1.0\r\n",                               BACKEND_PATH);
  client.printf("Host: %s\r\n",                                       BACKEND_HOST);
  client.printf("X-Api-Key: %s\r\n",                                  ESP32_API_KEY);
  client.printf("Content-Type: multipart/form-data; boundary=%s\r\n", boundary.c_str());
  client.printf("Content-Length: %u\r\n",                             totalLen);
  client.print ("Connection: close\r\n\r\n");
  client.print(filePart);

  uint8_t buf[512];
  size_t sent = 0;
  while (f.available()) {
    int n = f.read(buf, sizeof(buf));
    client.write(buf, n);
    sent += n;
    if (sent % (512 * 16) == 0) delay(1);
  }
  f.close();
  Serial.printf("[HTTP] ✓ Sent %u bytes\n", sent);

  client.print(durPart);
  client.print(endPart);

  Serial.println("[HTTP] Waiting for server response...");
  uint32_t t = millis();
  while (!client.available() && millis() - t < 30000) delay(10);

  if (!client.available()) { Serial.println("[HTTP] ✗ No response — timeout"); client.stop(); return; }

  String response = "";
  while (client.available()) response += (char)client.read();
  client.stop();

  if (response.indexOf("\"status\":\"ok\"") >= 0)
    Serial.println("[HTTP] ✓ Upload successful!");
  else {
    Serial.println("[HTTP] ✗ Upload failed. Server said:");
    Serial.println(response.substring(0, 200));
  }
}

/* ─────────────────────────────────────────
   I2S INIT
   ───────────────────────────────────────── */
void setupI2S() {
  Serial.println("[I2S]  Installing driver...");
  i2s_config_t cfg = {
    .mode                 = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate          = SAMPLE_RATE,
    .bits_per_sample      = I2S_BITS_PER_SAMPLE_32BIT,
    .channel_format       = I2S_CHANNEL_FMT_ONLY_LEFT,   // INMP441 L/R=GND → left channel
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags     = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count        = 8,
    .dma_buf_len          = 512,
    .use_apll             = false,
    .tx_desc_auto_clear   = false,
    .fixed_mclk           = 0
  };
  i2s_pin_config_t pins = {
    .mck_io_num   = I2S_PIN_NO_CHANGE,
    .bck_io_num   = PIN_I2S_SCK,
    .ws_io_num    = PIN_I2S_WS,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num  = PIN_I2S_SD
  };

  esp_err_t err = i2s_driver_install(I2S_PORT, &cfg, 0, NULL);
  if (err != ESP_OK) { Serial.printf("[I2S]  ✗ Driver install failed: %d\n", err); return; }

  err = i2s_set_pin(I2S_PORT, &pins);
  if (err != ESP_OK) { Serial.printf("[I2S]  ✗ Pin config failed: %d\n", err); return; }

  i2s_zero_dma_buffer(I2S_PORT);
  Serial.println("[I2S]  ✓ Microphone ready (WS=4, SCK=5, SD=3)");
}

/* ─────────────────────────────────────────
   DEVICE STATUS — send state to backend
   ───────────────────────────────────────── */
// Send explicit state: "online" | "recording" | "idle"
void sendStatus(const char* state) {
  if (WiFi.status() != WL_CONNECTED) return;
  WiFiClientSecure client;
  client.setInsecure();
  if (!client.connect(BACKEND_HOST, BACKEND_PORT)) return;
  String body = String("{\"status\":\"") + state + "\"}";
  client.printf("POST /device/heartbeat HTTP/1.0\r\n");
  client.printf("Host: %s\r\n",           BACKEND_HOST);
  client.printf("X-Api-Key: %s\r\n",      ESP32_API_KEY);
  client.printf("Content-Type: application/json\r\n");
  client.printf("Content-Length: %d\r\n", body.length());
  client.print ("Connection: close\r\n\r\n");
  client.print(body);
  unsigned long t = millis();
  while (client.connected() && millis() - t < 3000) delay(10);
  client.stop();
}

// Heartbeat task: sends "online" every 3s when idle
// Pauses during recording — HTTPS blocks SD SPI writes
void heartbeatTask(void* param) {
  while (1) {
    sendStatus(recording ? "recording" : "online");
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}

/* ─────────────────────────────────────────
   SETUP
   ───────────────────────────────────────── */
void setup() {
  Serial.begin(115200);
  delay(3000);  // wait so Serial Monitor connects before first print

  Serial.println("\n\n==========================================");
  Serial.println("      VoiceNote AI — ESP32-C3 Mini");
  Serial.println("==========================================");
  Serial.println("[BOOT] ✓ ESP32-C3 started");

  // ── Toggle Switch ──
  pinMode(PIN_TOGGLE, INPUT_PULLDOWN);
  Serial.println("[SW]   ✓ Toggle switch ready on GPIO8 (HIGH=record, LOW=stop)");

  // ── SD Card ──
  Serial.println("[SD]   Initializing SD card (CS=10, MOSI=7, MISO=2, SCK=6)...");
  SPI.begin(PIN_SD_SCK, PIN_SD_MISO, PIN_SD_MOSI, PIN_SD_CS);
  delay(200);

  // Try at 4MHz first (more compatible with cheap modules), then 25MHz
  bool sdOk = SD.begin(PIN_SD_CS, SPI, 4000000);
  if (!sdOk) {
    Serial.println("[SD]   ✗ FAILED at 4MHz — check wiring:");
    Serial.println("[SD]   VCC=5V, GND, CS=GPIO10, MOSI=GPIO7, MISO=GPIO2, SCK=GPIO6");
    Serial.println("[SD]   Also check: FAT32 format, card ≤32GB, card fully inserted");
    Serial.println("[SD]   Common fix: swap MOSI and MISO wires");
    while (1) {
      delay(3000);
      Serial.println("[SD]   Retrying...");
      if (SD.begin(PIN_SD_CS, SPI, 4000000)) {
        Serial.println("[SD]   ✓ SD card OK on retry");
        sdOk = true;
        break;
      }
      Serial.println("[SD]   ✗ Still failing — check wiring");
    }
  } else {
    Serial.println("[SD]   ✓ SD card OK");
  }

  // ── WiFi ──
  Serial.printf("[WIFI] Connecting to: %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  uint32_t wifiStart = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(500); Serial.print(".");
    if (millis() - wifiStart > 15000) break;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WIFI] ✓ Connected! IP: %s\n", WiFi.localIP().toString().c_str());

    // ── NTP Time Sync ──
    Serial.println("[NTP]  Syncing time...");
    configTime(5 * 3600 + 30 * 60, 0, "pool.ntp.org", "time.nist.gov"); // UTC+5:30 India
    struct tm t;
    uint32_t ntpStart = millis();
    while (!getLocalTime(&t)) {
      delay(500); Serial.print(".");
      if (millis() - ntpStart > 8000) { Serial.println("\n[NTP]  ✗ Sync failed — using counter names"); break; }
    }
    if (getLocalTime(&t))
      Serial.printf("\n[NTP]  ✓ Time: %04d-%02d-%02d %02d:%02d:%02d\n",
        t.tm_year+1900, t.tm_mon+1, t.tm_mday, t.tm_hour, t.tm_min, t.tm_sec);

    sendStatus("online");
    Serial.println("[STATUS] ✓ Sent online status to backend");
  } else {
    Serial.println("\n[WIFI] ✗ Could not connect — uploads will be skipped");
  }

  // ── I2S Mic ──
  setupI2S();

  // ── Local Web Server ──
  webServer.on("/", HTTP_GET, [](AsyncWebServerRequest *req) {
    String html = "<!DOCTYPE html><html><head>"
      "<meta name='viewport' content='width=device-width,initial-scale=1'>"
      "<style>body{font-family:Arial;background:#111;color:#eee;padding:20px}"
      ".card{background:#1e1e1e;padding:12px;border-radius:10px;margin-bottom:12px}"
      "audio{width:100%;margin-top:8px}</style></head><body><h2>Recordings</h2>";
    File root = SD.open("/");
    while (true) {
      File f = root.openNextFile(); if (!f) break;
      String n = f.name();
      if (n.endsWith(".wav"))
        html += "<div class='card'><b>" + n + "</b><audio controls src='/play?f=" + n + "'></audio></div>";
      f.close();
    }
    root.close();
    html += "</body></html>";
    req->send(200, "text/html", html);
  });

  webServer.on("/play", HTTP_GET, [](AsyncWebServerRequest *req) {
    if (!req->hasParam("f")) { req->send(400); return; }
    String path = "/" + req->getParam("f")->value();
    if (!SD.exists(path)) { req->send(404); return; }
    req->send(SD, path, "audio/wav");
  });

  webServer.begin();
  if (WiFi.status() == WL_CONNECTED)
    Serial.printf("[WEB]  ✓ Local player: http://%s\n", WiFi.localIP().toString().c_str());

  Serial.println("==========================================");
  Serial.println("[READY] Flip toggle UP  → start recording");
  Serial.println("[READY] Flip toggle DOWN → stop & upload");
  Serial.println("==========================================");

  // Start heartbeat in background
  xTaskCreate(heartbeatTask, "heartbeat", 8192, NULL, 1, NULL);
  Serial.println("[BEAT] ✓ Heartbeat task started");

}

/* ─────────────────────────────────────────
   LOOP
   ───────────────────────────────────────── */
void loop() {
  // ── Toggle switch: HIGH → start recording, LOW → stop recording ──
  // Direct state check with 300ms cooldown to prevent rapid re-triggering
  static uint32_t lastToggleAct = 0;
  bool toggle = digitalRead(PIN_TOGGLE);

  if (millis() - lastToggleAct > 300) {
    if (toggle == HIGH && !recording) {
      lastToggleAct = millis();
      // ── START ──
      struct tm t;
      if (getLocalTime(&t)) {
        sprintf(currentFile, "/%04d-%02d-%02d_%02d-%02d-%02d.wav",
          t.tm_year+1900, t.tm_mon+1, t.tm_mday, t.tm_hour, t.tm_min, t.tm_sec);
      } else {
        sprintf(currentFile, "/REC%03u.wav", fileIndex++);
      }
      wavFile = SD.open(currentFile, FILE_WRITE);
      if (!wavFile) {
        Serial.println("[REC]  ✗ Cannot create file on SD card");
      } else {
        bytesWritten = 0;
        recStartMs   = millis();
        firstRead    = true;
        lastLog      = millis();
        sdBufPos     = 0;
        writeWavHeader(wavFile);
        recording = true;
        sendStatus("recording");
        Serial.printf("[REC]  ✓ Recording started → %s\n", currentFile);
      }

    } else if (toggle == LOW && recording) {
      lastToggleAct = millis();
      // ── STOP ──
      recording = false;
      uint32_t dur = (millis() - recStartMs) / 1000;
      if (sdBufPos > 0) {
        wavFile.write(sdBuf, sdBufPos);
        sdBufPos = 0;
      }
      wavFile.flush();
      wavFile.close();
      Serial.printf("[REC]  ✓ Recording stopped — duration: %us\n", dur);
      finalizeWav(currentFile);
      sendToBackend(currentFile, dur);
      sendStatus("idle");
    }
  }

  // ── Capture audio samples ──
  if (recording) {
    int32_t buf[256];
    size_t br = 0;
    i2s_read(I2S_PORT, buf, sizeof(buf), &br, pdMS_TO_TICKS(100));

    if (firstRead && br > 0) {
      firstRead = false;
      Serial.printf("[I2S]  ✓ Audio flowing — sample[0]=%d\n", buf[0]);
    }

    if (millis() - lastLog > 5000) {
      lastLog = millis();
      Serial.printf("[REC]  Recording... %u bytes so far\n", bytesWritten);
    }

    for (size_t i = 0; i < br / 4; i++) {
      // INMP441: 24-bit audio left-justified in 32-bit word → shift right 14 to get 16-bit
      int16_t s = (int16_t)((int32_t)buf[i] >> 14);
      sdBuf[sdBufPos++] = (uint8_t)(s & 0xFF);
      sdBuf[sdBufPos++] = (uint8_t)(s >> 8);

      // When 4KB buffer is full, write to SD in one efficient block
      if (sdBufPos >= SD_WRITE_BUF) {
        wavFile.write(sdBuf, SD_WRITE_BUF);
        bytesWritten += SD_WRITE_BUF;
        sdBufPos = 0;
      }
    }
  }
}
