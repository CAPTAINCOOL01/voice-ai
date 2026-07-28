#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include "SD_MMC.h"
#include "driver/i2s_pdm.h"
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
   PINS — XIAO ESP32-S3 Sense (with expansion board)
   ─────────────────────────────────────────
   Built-in PDM mic   : CLK=GPIO42, DATA=GPIO41  (fixed on module, no wiring)
   Built-in SD (SDMMC): CLK=GPIO7,  CMD=GPIO9,  D0=GPIO8  (fixed on expansion board)
   No external wiring — no buttons, no LEDs, no battery divider. USB-only bring-up.
   Board select: "XIAO_ESP32S3", PSRAM: "OPI PSRAM", Flash Size: 8MB,
                  USB CDC on Boot: Enabled.
   ───────────────────────────────────────── */
#define PDM_CLK_PIN    42
#define PDM_DATA_PIN   41

/* ─────────────────────────────────────────
   AUDIO CONFIG — 16 kHz mono 16-bit, native Sarvam STT input format
   ───────────────────────────────────────── */
#define SAMPLE_RATE      16000
#define BITS_PER_SAMPLE  16
#define CHANNELS         1
#define I2S_PORT         I2S_NUM_0

/* ─────────────────────────────────────────
   GLOBALS
   ───────────────────────────────────────── */
File     wavFile;
bool     recording    = false;
uint32_t bytesWritten = 0;
uint16_t fileIndex    = 0;
uint32_t recStartMs   = 0;
char     currentFile[32];
bool     firstRead    = true;
uint32_t lastLog      = 0;

#define SD_WRITE_BUF 4096
uint8_t  sdBuf[SD_WRITE_BUF];
uint16_t sdBufPos = 0;

static i2s_chan_handle_t rx_handle = NULL;

// ── DSP state — reset when a new recording starts ──
float dcPrevIn  = 0.0f;
float dcPrevOut = 0.0f;

// DSP tuning for STT accuracy (not for human listening):
//   - DC blocker ON  — removes mic bias, always beneficial.
//   - Noise gate OFF — Sarvam handles noise better than the gate's artifacts.
//   - Makeup gain modest with tanh soft-clip — preserves natural dynamics.
#define DSP_DC_ALPHA      0.995f    // ~13 Hz HPF cutoff, kills DC + sub-bass rumble
#define DSP_MAKEUP_GAIN   0.15f     // 24-bit-equivalent → 16-bit scaling (softer than before)

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

  f.write((const uint8_t*)"RIFF", 4); f.write((uint8_t*)&zero32,  4);
  f.write((const uint8_t*)"WAVE", 4);
  f.write((const uint8_t*)"fmt ", 4); f.write((uint8_t*)&fmtSize, 4);
  f.write((uint8_t*)&audioFmt, 2);    f.write((uint8_t*)&channels,2);
  f.write((uint8_t*)&rate,     4);    f.write((uint8_t*)&byteRate, 4);
  f.write((uint8_t*)&align,    2);    f.write((uint8_t*)&bits,     2);
  f.write((const uint8_t*)"data", 4); f.write((uint8_t*)&zero32,  4);
}

// Patch RIFF/data size fields based on current file size — used both after a
// clean stop AND on next-boot for any orphan WAV whose sizes are still zero
// because the device died mid-recording.
void finalizeWav(const char* path) {
  delay(100);
  File check = SD_MMC.open(path);
  if (!check) { Serial.println("[WAV]  ✗ Cannot open file"); return; }
  uint32_t fileSize = check.size();
  check.close();
  if (fileSize < 100) { Serial.println("[WAV]  ✗ File too small"); return; }
  uint32_t dataSize = fileSize - 44;
  uint32_t riffSize = fileSize - 8;
  File f = SD_MMC.open(path, "r+");
  if (!f) { Serial.println("[WAV]  ✗ Cannot open r+ mode"); return; }
  f.seek(4);  f.write((uint8_t*)&riffSize, 4);
  f.seek(40); f.write((uint8_t*)&dataSize, 4);
  f.close();
  Serial.printf("[WAV]  ✓ Sizes patched — %u bytes\n", fileSize);
}

/* ─────────────────────────────────────────
   HTTP UPLOAD
   ───────────────────────────────────────── */
bool sendToBackend(const char* path, uint32_t durationSecs) {
  if (WiFi.status() != WL_CONNECTED) { Serial.println("[HTTP] ✗ No WiFi"); return false; }
  File f = SD_MMC.open(path);
  if (!f) { Serial.println("[HTTP] ✗ Cannot open file"); return false; }
  Serial.printf("[HTTP] Uploading %s (%u bytes)...\n", path, f.size());

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
  client.setTimeout(180);
  if (!client.connect(BACKEND_HOST, BACKEND_PORT)) {
    Serial.println("[HTTP] ✗ Cannot reach backend"); f.close(); return false;
  }

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
  client.print(durPart);
  client.print(endPart);

  Serial.println("[HTTP] Waiting for response...");
  uint32_t t = millis();
  while (!client.available() && millis() - t < 120000) {
    delay(10);
    if ((millis() - t) % 10000 < 10)
      Serial.printf("[HTTP] Waiting... %us\n", (millis() - t) / 1000);
  }
  if (!client.available()) { Serial.println("[HTTP] ✗ Timeout"); client.stop(); return false; }

  String response = "";
  while (client.available()) response += (char)client.read();
  client.stop();

  if (response.indexOf("\"status\":\"ok\"") >= 0) {
    Serial.println("[HTTP] ✓ Upload successful!");
    return true;
  } else {
    Serial.println("[HTTP] ✗ Server error:");
    Serial.println(response.substring(0, 200));
    return false;
  }
}

void markUploaded(const char* wavPath) {
  String p = String(wavPath); p.replace(".wav", ".done");
  File f = SD_MMC.open(p.c_str(), FILE_WRITE); if (f) f.close();
}

bool isUploaded(const char* wavPath) {
  String p = String(wavPath); p.replace(".wav", ".done");
  return SD_MMC.exists(p.c_str());
}

// On boot, walk SD root. For each unmarked WAV: patch RIFF/data sizes if the
// device died mid-recording, then upload. This is why we're always "one
// recording behind" — the previous session uploads at the start of the next.
void retryPendingUploads() {
  if (WiFi.status() != WL_CONNECTED) return;
  File root = SD_MMC.open("/"); if (!root) return;
  bool any = false;
  while (true) {
    File f = root.openNextFile(); if (!f) break;
    String name = f.name(); uint32_t sz = f.size(); f.close();
    if (!name.endsWith(".wav")) continue;
    String fp = "/" + name;
    if (isUploaded(fp.c_str())) continue;
    if (sz <= 1000) { markUploaded(fp.c_str()); continue; }
    any = true;
    // Orphan finalize — patches RIFF/data sizes if they're still zero.
    finalizeWav(fp.c_str());
    uint32_t dur = sz > 44 ? (sz - 44) / 32000 : 0;
    Serial.printf("[RETRY] Uploading %s (%u bytes, ~%us)...\n", fp.c_str(), sz, dur);
    if (sendToBackend(fp.c_str(), dur)) markUploaded(fp.c_str());
    else Serial.println("[RETRY] Failed — will retry on next boot");
  }
  root.close();
  if (!any) Serial.println("[RETRY] No pending uploads.");
}

/* ─────────────────────────────────────────
   I2S — PDM RX (XIAO S3 Sense built-in mic)
   New handle-based driver API (arduino-esp32 3.x / ESP-IDF 5.x).
   ───────────────────────────────────────── */
void setupI2S() {
  i2s_chan_config_t chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(I2S_PORT, I2S_ROLE_MASTER);
  i2s_new_channel(&chan_cfg, NULL, &rx_handle);

  i2s_pdm_rx_config_t pdm_rx_cfg = {
    .clk_cfg  = I2S_PDM_RX_CLK_DEFAULT_CONFIG(SAMPLE_RATE),
    .slot_cfg = I2S_PDM_RX_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO),
    .gpio_cfg = {
      .clk = (gpio_num_t)PDM_CLK_PIN,
      .din = (gpio_num_t)PDM_DATA_PIN,
      .invert_flags = { .clk_inv = false }
    }
  };

  i2s_channel_init_pdm_rx_mode(rx_handle, &pdm_rx_cfg);
  i2s_channel_enable(rx_handle);
  Serial.println("[PDM]  ✓ Mic ready");
}

/* ─────────────────────────────────────────
   HEARTBEAT — device state + ESP32 die temperature
   No battery reading (no divider wired).
   ───────────────────────────────────────── */
void heartbeatTask(void* param) {
  WiFiClientSecure* client = new WiFiClientSecure();
  client->setInsecure();
  while (1) {
    vTaskDelay(pdMS_TO_TICKS(4000));
    if (WiFi.status() != WL_CONNECTED) continue;
    if (!client->connected()) {
      client->stop();
      if (!client->connect(BACKEND_HOST, BACKEND_PORT)) continue;
    }
    const char* state = recording ? "recording" : "online";
    float boxTemp = temperatureRead();
    String body = String("{\"status\":\"") + state
                + "\",\"temperature\":" + String(boxTemp, 1) + "}";
    client->printf("POST /device/heartbeat HTTP/1.1\r\n");
    client->printf("Host: %s\r\n", BACKEND_HOST);
    client->printf("X-Api-Key: %s\r\n", ESP32_API_KEY);
    client->printf("Content-Type: application/json\r\n");
    client->printf("Content-Length: %d\r\n", body.length());
    client->printf("Connection: keep-alive\r\n\r\n");
    client->print(body);
    unsigned long t = millis();
    while (millis() - t < 5000) {
      if (client->available()) { while (client->available()) client->read(); break; }
      delay(10);
    }
  }
}

/* ─────────────────────────────────────────
   Start a new recording — timestamped filename, fresh WAV header,
   DSP state reset. Called once in setup() after everything else is up.
   ───────────────────────────────────────── */
void startRecording() {
  struct tm t;
  if (getLocalTime(&t))
    sprintf(currentFile, "/%04d-%02d-%02d_%02d-%02d-%02d.wav",
      t.tm_year+1900, t.tm_mon+1, t.tm_mday, t.tm_hour, t.tm_min, t.tm_sec);
  else
    sprintf(currentFile, "/REC%03u.wav", fileIndex++);

  if (SD_MMC.exists(currentFile)) SD_MMC.remove(currentFile);
  wavFile = SD_MMC.open(currentFile, FILE_WRITE);
  if (!wavFile) {
    Serial.println("[REC]  ✗ Cannot create file — SD write failed");
    return;
  }
  bytesWritten = 0; recStartMs = millis();
  firstRead = true; lastLog = millis(); sdBufPos = 0;
  dcPrevIn = dcPrevOut = 0.0f;
  writeWavHeader(wavFile);
  recording = true;
  Serial.printf("[REC]  ✓ Started → %s\n", currentFile);
}

/* ─────────────────────────────────────────
   SETUP
   ───────────────────────────────────────── */
void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println("\n=== VoiceNote AI — XIAO ESP32-S3 Sense (auto-record) ===");

  // SD_MMC 1-bit on Sense expansion board (CLK=7, CMD=9, D0=8)
  SD_MMC.setPins(7, 9, 8);
  if (SD_MMC.begin("/sdcard", true)) {
    Serial.println("[SD]   ✓ OK (SDMMC 1-bit)");
    uint8_t ct = SD_MMC.cardType();
    Serial.printf("[SD]   cardType=%u size=%llu MB\n",
                  ct, SD_MMC.cardSize() / (1024ULL * 1024ULL));
  } else {
    Serial.println("[SD]   ✗ FAILED — halting (check card seated, formatted FAT32)");
    while (1) delay(1000);
  }

  // WiFi
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("[WIFI] Connecting to %s...\n", WIFI_SSID);
  uint32_t wStart = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wStart < 15000) delay(500);
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WIFI] ✓ Connected — IP: %s\n", WiFi.localIP().toString().c_str());
    configTime(5 * 3600 + 30 * 60, 0, "pool.ntp.org");
    struct tm t;
    uint32_t ntpStart = millis();
    while (!getLocalTime(&t) && millis() - ntpStart < 8000) delay(500);
    if (getLocalTime(&t))
      Serial.printf("[NTP]  ✓ %04d-%02d-%02d %02d:%02d:%02d\n",
        t.tm_year+1900, t.tm_mon+1, t.tm_mday, t.tm_hour, t.tm_min, t.tm_sec);
    // Always drain any orphans from the previous session before starting fresh.
    retryPendingUploads();
  } else {
    Serial.println("[WIFI] ✗ Failed — recording will still work, upload deferred to next boot");
  }

  setupI2S();
  xTaskCreate(heartbeatTask, "heartbeat", 16384, NULL, 1, NULL);

  // Auto-start recording. Runs until power is cut — the half-written WAV will
  // be finalised + uploaded on the next boot.
  startRecording();

  Serial.println("[READY] Recording. Unplug USB to stop; next boot uploads this file.");
}

/* ─────────────────────────────────────────
   LOOP — read audio, DSP, buffered write to SD.
   No button poll, no stop path. Recording ends only when power is cut.
   ───────────────────────────────────────── */
void loop() {
  if (!recording) { delay(100); return; }

  int16_t buf[512];
  size_t br = 0;
  i2s_channel_read(rx_handle, buf, sizeof(buf), &br, pdMS_TO_TICKS(100));

  if (firstRead && br > 0) {
    firstRead = false;
    Serial.println("[PDM]  ✓ Audio flowing");
  }

  if (millis() - lastLog > 5000) {
    lastLog = millis();
    Serial.printf("[REC]  %u bytes\n", bytesWritten);
    // Flush periodically so a mid-recording power-cut loses at most ~5s
    // of audio instead of the full SD write buffer.
    if (sdBufPos > 0) {
      wavFile.write(sdBuf, sdBufPos);
      bytesWritten += sdBufPos;
      sdBufPos = 0;
    }
    wavFile.flush();
  }

  for (size_t i = 0; i < br / 2; i++) {
    // Upscale 16-bit PDM sample to 24-bit-equivalent range for the DC blocker,
    // then scale back down at the end. Keeps float math in a comfortable range.
    float x = (float)((int32_t)buf[i] << 8);

    // DC blocker — single-pole HPF, removes mic DC bias.
    float y = x - dcPrevIn + DSP_DC_ALPHA * dcPrevOut;
    dcPrevIn  = x;
    dcPrevOut = y;

    // Modest makeup gain + tanh soft-clip. Preserves natural dynamics
    // (better for STT than a hard limiter) while smoothly saturating peaks.
    float scaled = y * DSP_MAKEUP_GAIN;
    float out    = 32767.0f * tanhf(scaled / 32767.0f);
    int16_t s    = (int16_t)out;

    sdBuf[sdBufPos++] = (uint8_t)(s & 0xFF);
    sdBuf[sdBufPos++] = (uint8_t)(s >> 8);
    if (sdBufPos >= SD_WRITE_BUF) {
      wavFile.write(sdBuf, SD_WRITE_BUF);
      bytesWritten += SD_WRITE_BUF;
      sdBufPos = 0;
    }
  }
}
