#include <Arduino.h>
#include <SPI.h>
#include <SD.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <ESPAsyncWebServer.h>
#include "driver/i2s.h"

/* ─────────────────────────────────────────
   USER CONFIG
   ───────────────────────────────────────── */
#define WIFI_SSID     "TPF_2.4G"
#define WIFI_PASS     "7017138349"
#define BACKEND_HOST  "voice-ai-da3b.onrender.com"
#define BACKEND_PORT  443
#define BACKEND_PATH  "/save"
#define ESP32_API_KEY "replace-with-another-random-key"

/* ─────────────────────────────────────────
   PINS — ESP32 38-pin
   ───────────────────────────────────────── */
#define PIN_I2S_WS   15   // INMP441 WS  (LRCK)
#define PIN_I2S_SCK  14   // INMP441 SCK (BCLK)
#define PIN_I2S_SD   32   // INMP441 SD  (DATA)

#define PIN_SD_CS     5   // MicroSD CS  (default VSPI CS)
// MOSI=23, MISO=19, SCK=18 — hardware VSPI defaults, no SPI.begin() needed

#define PIN_BUTTON   13   // Tactile button (INPUT_PULLUP → GND)

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
char     currentFile[20];

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
  Serial.println("[WAV]  ✓ Header written");
}

void finalizeWav(const char* path) {
  Serial.printf("[WAV]  Finalizing %s\n", path);

  File check = SD.open(path);
  if (!check) { Serial.println("[WAV]  ✗ Cannot open file"); return; }
  uint32_t fileSize = check.size();
  check.close();

  if (fileSize < 44) { Serial.println("[WAV]  ✗ File too small"); return; }

  uint32_t dataSize = fileSize - 44;
  uint32_t riffSize = fileSize - 8;
  Serial.printf("[WAV]  ✓ Audio data: %u bytes\n", dataSize);

  File src = SD.open(path);
  if (!src) { Serial.println("[WAV]  ✗ Cannot reopen source"); return; }
  src.seek(44);

  const char* tmpPath = "/tmp.raw";
  File tmp = SD.open(tmpPath, FILE_WRITE);
  if (!tmp) { src.close(); Serial.println("[WAV]  ✗ Cannot create temp file"); return; }

  uint8_t buf[512];
  uint32_t copied = 0;
  while (src.available()) { int n = src.read(buf, sizeof(buf)); tmp.write(buf, n); copied += n; }
  src.close(); tmp.close();

  SD.remove(path);
  File out = SD.open(path, FILE_WRITE);
  if (!out) { Serial.println("[WAV]  ✗ Cannot recreate WAV"); return; }

  uint32_t fmtSize  = 16;
  uint16_t audioFmt = 1;
  uint16_t channels = CHANNELS;
  uint32_t rate     = SAMPLE_RATE;
  uint16_t bits     = BITS_PER_SAMPLE;
  uint32_t byteRate = rate * channels * (bits / 8);
  uint16_t align    = channels * (bits / 8);

  out.write((const uint8_t*)"RIFF", 4); out.write((uint8_t*)&riffSize, 4);
  out.write((const uint8_t*)"WAVE", 4);
  out.write((const uint8_t*)"fmt ", 4); out.write((uint8_t*)&fmtSize,  4);
  out.write((uint8_t*)&audioFmt, 2);    out.write((uint8_t*)&channels, 2);
  out.write((uint8_t*)&rate,     4);    out.write((uint8_t*)&byteRate, 4);
  out.write((uint8_t*)&align,    2);    out.write((uint8_t*)&bits,     2);
  out.write((const uint8_t*)"data", 4); out.write((uint8_t*)&dataSize, 4);

  File raw = SD.open(tmpPath);
  uint32_t written = 0;
  if (raw) {
    while (raw.available()) { int n = raw.read(buf, sizeof(buf)); out.write(buf, n); written += n; }
    raw.close();
  }
  out.close();
  SD.remove(tmpPath);
  Serial.printf("[WAV]  ✓ Final WAV: %u bytes\n", written + 44);
}

/* ─────────────────────────────────────────
   HTTP UPLOAD
   ───────────────────────────────────────── */
void sendToBackend(const char* path, uint32_t durationSecs) {
  Serial.println("[HTTP] >> sendToBackend()");

  if (WiFi.status() != WL_CONNECTED) { Serial.println("[HTTP] ✗ No WiFi"); return; }

  File f = SD.open(path);
  if (!f) { Serial.println("[HTTP] ✗ Cannot open WAV"); return; }
  Serial.printf("[HTTP] ✓ File size: %u bytes\n", f.size());

  String filename = String(path);
  if (filename.startsWith("/")) filename = filename.substring(1);
  if (!filename.endsWith(".wav")) filename += ".wav";

  String boundary = "----ESP32Boundary";
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
  Serial.printf("[HTTP] Connecting to %s:%d ...\n", BACKEND_HOST, BACKEND_PORT);
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
  Serial.printf("[HTTP] ✓ Streamed %u bytes\n", sent);

  client.print(durPart);
  client.print(endPart);

  Serial.println("[HTTP] Waiting for response...");
  uint32_t t = millis();
  while (!client.available() && millis() - t < 30000) delay(10);

  if (!client.available()) { Serial.println("[HTTP] ✗ No response in 30s"); client.stop(); return; }

  String response = "";
  while (client.available()) response += (char)client.read();
  client.stop();
  Serial.println("[HTTP] Response: " + response.substring(0, 120));

  if (response.indexOf("\"status\":\"ok\"") >= 0)
    Serial.println("[HTTP] ✓ Upload successful");
  else
    Serial.println("[HTTP] ✗ Upload failed");
}

/* ─────────────────────────────────────────
   I2S INIT — ESP32 38-pin
   ───────────────────────────────────────── */
void setupI2S() {
  i2s_config_t cfg = {
    .mode                 = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate          = SAMPLE_RATE,
    .bits_per_sample      = I2S_BITS_PER_SAMPLE_32BIT,
    .channel_format       = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags     = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count        = 8,
    .dma_buf_len          = 512,
    .use_apll             = false,
    .tx_desc_auto_clear   = false,
    .fixed_mclk           = 0
  };
  i2s_pin_config_t pins = {
    .bck_io_num   = PIN_I2S_SCK,
    .ws_io_num    = PIN_I2S_WS,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num  = PIN_I2S_SD
  };

  esp_err_t err = i2s_driver_install(I2S_PORT, &cfg, 0, NULL);
  if (err != ESP_OK) Serial.printf("[I2S]  ✗ Install error: %d\n", err);
  else               Serial.println("[I2S]  ✓ Driver installed");

  err = i2s_set_pin(I2S_PORT, &pins);
  if (err != ESP_OK) Serial.printf("[I2S]  ✗ Pin error: %d\n", err);
  else               Serial.println("[I2S]  ✓ Pins configured");

  i2s_zero_dma_buffer(I2S_PORT);
  Serial.println("[I2S]  ✓ Ready");
}

/* ─────────────────────────────────────────
   SETUP
   ───────────────────────────────────────── */
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("===========================================");
  Serial.println("[BOOT] VoiceNote AI — ESP32 38-pin");
  Serial.println("===========================================");

  // ── Button ──
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  Serial.println("[BTN]  ✓ Button on GPIO13");

  // ── SD Card — ESP32 uses VSPI hardware defaults ──
  Serial.println("[SD]   Initializing SD card...");
  delay(100);

  if (!SD.begin(PIN_SD_CS)) {
    Serial.println("[SD]   ✗ FAIL — SD card init failed");
    Serial.println("[SD]   Check: CS=GPIO5, MOSI=GPIO23, MISO=GPIO19, SCK=GPIO18");
    Serial.println("[SD]   Check: card inserted, FAT32 formatted, 3.3V power");
    while (1) {
      delay(3000);
      Serial.println("[SD]   Retrying...");
      if (SD.begin(PIN_SD_CS)) { Serial.println("[SD]   ✓ OK!"); break; }
      Serial.println("[SD]   ✗ Still failing");
    }
  }
  Serial.println("[SD]   ✓ SD card OK");

  File testFile = SD.open("/sdtest.txt", FILE_WRITE);
  if (testFile) { testFile.println("ok"); testFile.close(); SD.remove("/sdtest.txt"); }
  Serial.println("[SD]   ✓ Read/write verified");

  // ── WiFi ──
  Serial.printf("[WIFI] Connecting to %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  uint32_t wifiStart = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(500); Serial.print(".");
    if (millis() - wifiStart > 15000) {
      Serial.println("\n[WIFI] ✗ Could not connect — upload will be skipped");
      break;
    }
  }
  if (WiFi.status() == WL_CONNECTED)
    Serial.printf("\n[WIFI] ✓ Connected — IP: %s\n", WiFi.localIP().toString().c_str());

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
    Serial.printf("[WEB]  ✓ Local UI: http://%s\n", WiFi.localIP().toString().c_str());

  Serial.println("===========================================");
  Serial.println("[READY] Press button to record");
  Serial.println("===========================================");
}

/* ─────────────────────────────────────────
   HEARTBEAT
   ───────────────────────────────────────── */
uint32_t lastServerPing = 0;
#define  SERVER_PING_INTERVAL 2000

void sendHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) return;
  WiFiClientSecure client;
  client.setInsecure();
  if (!client.connect(BACKEND_HOST, BACKEND_PORT)) return;
  client.printf("POST /device/heartbeat HTTP/1.0\r\n");
  client.printf("Host: %s\r\n",      BACKEND_HOST);
  client.printf("X-Api-Key: %s\r\n", ESP32_API_KEY);
  client.print ("Content-Length: 0\r\n");
  client.print ("Connection: close\r\n\r\n");
  unsigned long t = millis();
  while (client.connected() && millis() - t < 3000) delay(10);
  client.stop();
}

/* ─────────────────────────────────────────
   LOOP
   ───────────────────────────────────────── */
void loop() {
  // ── Heartbeat — skip while recording ──
  if (!recording && millis() - lastServerPing > SERVER_PING_INTERVAL) {
    lastServerPing = millis();
    sendHeartbeat();
  }

  // ── Button: press once to start, press again to stop ──
  static bool lastBtn = HIGH;
  bool btn = digitalRead(PIN_BUTTON);

  if (lastBtn == HIGH && btn == LOW) {
    delay(15);
    if (!recording) {
      // ── START ──
      sprintf(currentFile, "/REC%03u.wav", fileIndex++);
      wavFile = SD.open(currentFile, FILE_WRITE);
      if (!wavFile) {
        Serial.println("[REC]  ✗ Cannot open file on SD");
      } else {
        bytesWritten = 0;
        recStartMs   = millis();
        writeWavHeader(wavFile);
        recording = true;
        Serial.printf("[REC]  ✓ Recording → %s\n", currentFile);
      }
    } else {
      // ── STOP ──
      recording = false;
      uint32_t dur = (millis() - recStartMs) / 1000;
      Serial.printf("[REC]  ✓ Stopped — %us\n", dur);
      wavFile.flush();
      wavFile.close();
      finalizeWav(currentFile);
      sendToBackend(currentFile, dur);
    }
  }

  lastBtn = btn;

  // ── Capture audio samples ──
  if (recording) {
    uint32_t buf[256];
    size_t br = 0;
    i2s_read(I2S_PORT, buf, sizeof(buf), &br, pdMS_TO_TICKS(10));

    if (br == 0) {
      static uint32_t lastWarn = 0;
      if (millis() - lastWarn > 3000) {
        lastWarn = millis();
        Serial.println("[I2S]  ✗ No data — check mic wiring");
      }
    }

    for (size_t i = 0; i < br / 4; i++) {
      int16_t s = (int16_t)((int32_t)buf[i] >> 14);
      wavFile.write((uint8_t*)&s, 2);
      bytesWritten += 2;
    }
  }
}
