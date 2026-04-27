#include <Arduino.h>
#include <SPI.h>
#include <SD.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
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
   PINS — ESP32-WROOM-32
   ───────────────────────────────────────── */
#define PIN_I2S_WS   25
#define PIN_I2S_SCK  26
#define PIN_I2S_SD   35

#define PIN_SD_CS     5
#define PIN_SD_MOSI  23
#define PIN_SD_MISO  19
#define PIN_SD_SCK   18

#define PIN_TOGGLE    4   // momentary button: one pin to GPIO4, other pin to GND. Press = start/stop.
#define PIN_LED_STATUS  2
#define PIN_LED_REC    15
#define PIN_BAT_ADC    34   // battery voltage divider midpoint (100kΩ/100kΩ)

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

float hpInPrev  = 0.0f;
float hpOutPrev = 0.0f;
float peePrev   = 0.0f;

#define NOISE_GATE_THRESHOLD 200

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

void finalizeWav(const char* path) {
  delay(300);
  File check = SD.open(path);
  if (!check) { Serial.println("[WAV]  ✗ Cannot open file"); return; }
  uint32_t fileSize = check.size();
  check.close();
  if (fileSize < 100) { Serial.println("[WAV]  ✗ File too small"); return; }
  uint32_t dataSize = fileSize - 44;
  uint32_t riffSize = fileSize - 8;
  File f = SD.open(path, "r+");
  if (!f) { Serial.println("[WAV]  ✗ Cannot open r+ mode"); return; }
  f.seek(4);  f.write((uint8_t*)&riffSize, 4);
  f.seek(40); f.write((uint8_t*)&dataSize, 4);
  f.close();
  Serial.printf("[WAV]  ✓ Saved — %u bytes\n", fileSize);
}

/* ─────────────────────────────────────────
   HTTP UPLOAD
   ───────────────────────────────────────── */
bool sendToBackend(const char* path, uint32_t durationSecs) {
  if (WiFi.status() != WL_CONNECTED) { Serial.println("[HTTP] ✗ No WiFi"); return false; }
  File f = SD.open(path);
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
  File f = SD.open(p.c_str(), FILE_WRITE); if (f) f.close();
}

bool isUploaded(const char* wavPath) {
  String p = String(wavPath); p.replace(".wav", ".done");
  return SD.exists(p.c_str());
}

void retryPendingUploads() {
  if (WiFi.status() != WL_CONNECTED) return;
  File root = SD.open("/"); if (!root) return;
  bool any = false;
  while (true) {
    File f = root.openNextFile(); if (!f) break;
    String name = f.name(); uint32_t sz = f.size(); f.close();
    if (!name.endsWith(".wav")) continue;
    String fp = "/" + name;
    if (isUploaded(fp.c_str())) continue;
    if (sz <= 1000) { markUploaded(fp.c_str()); continue; }
    any = true;
    uint32_t dur = sz > 44 ? (sz - 44) / 32000 : 0;
    Serial.printf("[RETRY] Uploading %s...\n", fp.c_str());
    if (sendToBackend(fp.c_str(), dur)) markUploaded(fp.c_str());
  }
  root.close();
  if (!any) Serial.println("[RETRY] No pending uploads.");
}

/* ─────────────────────────────────────────
   I2S
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
    .use_apll             = true,
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
  i2s_driver_install(I2S_PORT, &cfg, 0, NULL);
  i2s_set_pin(I2S_PORT, &pins);
  i2s_zero_dma_buffer(I2S_PORT);
  Serial.println("[I2S]  ✓ Mic ready");
}

/* ─────────────────────────────────────────
   BATTERY
   ───────────────────────────────────────── */
uint8_t readBatteryPercent() {
  int raw    = analogRead(PIN_BAT_ADC);
  float adcV = (raw / 4095.0f) * 3.3f;
  float batV = adcV * 2.0f;  // undo 100k/100k voltage divider
  float pct  = (batV - 3.0f) / (4.2f - 3.0f) * 100.0f;
  if (pct > 100.0f) pct = 100.0f;
  if (pct <   0.0f) pct =   0.0f;
  return (uint8_t)pct;
}

/* ─────────────────────────────────────────
   HEARTBEAT TASK
   ───────────────────────────────────────── */
void sendStatus(const char* state) {
  if (WiFi.status() != WL_CONNECTED) return;
  WiFiClientSecure client; client.setInsecure();
  if (!client.connect(BACKEND_HOST, BACKEND_PORT)) return;
  String body = String("{\"status\":\"") + state + "\",\"battery\":" + String(readBatteryPercent()) + "}";
  client.printf("POST /device/heartbeat HTTP/1.0\r\n");
  client.printf("Host: %s\r\n", BACKEND_HOST);
  client.printf("X-Api-Key: %s\r\n", ESP32_API_KEY);
  client.printf("Content-Type: application/json\r\n");
  client.printf("Content-Length: %d\r\n", body.length());
  client.print("Connection: close\r\n\r\n");
  client.print(body);
  unsigned long t = millis();
  while (client.connected() && millis() - t < 3000) delay(10);
  client.stop();
}

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
    String body = String("{\"status\":\"") + state + "\",\"battery\":" + String(readBatteryPercent()) + "}";
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
   SETUP
   ───────────────────────────────────────── */
void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println("\n=== VoiceNote AI — ESP32-WROOM-32 ===");

  pinMode(PIN_LED_STATUS, OUTPUT); digitalWrite(PIN_LED_STATUS, LOW);
  pinMode(PIN_LED_REC,    OUTPUT); digitalWrite(PIN_LED_REC,    LOW);
  pinMode(PIN_TOGGLE, INPUT_PULLDOWN);  // slider: HIGH = record, LOW = stop

  // SD
  SPI.begin(PIN_SD_SCK, PIN_SD_MISO, PIN_SD_MOSI, PIN_SD_CS);
  delay(200);
  if (SD.begin(PIN_SD_CS, SPI, 4000000)) {
    Serial.println("[SD]   ✓ OK");
  } else {
    Serial.println("[SD]   ✗ FAILED");
    while (1) { delay(3000); if (SD.begin(PIN_SD_CS, SPI, 4000000)) { Serial.println("[SD]   ✓ OK on retry"); break; } }
  }

  // WiFi
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("[WIFI] Connecting to %s...\n", WIFI_SSID);
  uint32_t wStart = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wStart < 15000) delay(500);
  if (WiFi.status() == WL_CONNECTED) {
    digitalWrite(PIN_LED_STATUS, HIGH);
    Serial.printf("[WIFI] ✓ Connected — IP: %s\n", WiFi.localIP().toString().c_str());
    configTime(5 * 3600 + 30 * 60, 0, "pool.ntp.org");
    struct tm t;
    uint32_t ntpStart = millis();
    while (!getLocalTime(&t) && millis() - ntpStart < 8000) delay(500);
    if (getLocalTime(&t))
      Serial.printf("[NTP]  ✓ %04d-%02d-%02d %02d:%02d:%02d\n",
        t.tm_year+1900, t.tm_mon+1, t.tm_mday, t.tm_hour, t.tm_min, t.tm_sec);
    sendStatus("online");
    retryPendingUploads();
  } else {
    Serial.println("[WIFI] ✗ Failed — will upload on next boot");
  }

  setupI2S();
  xTaskCreate(heartbeatTask, "heartbeat", 16384, NULL, 1, NULL);

  Serial.println("[READY] Flip UP to record, DOWN to stop & upload.");
}

/* ─────────────────────────────────────────
   LOOP
   ───────────────────────────────────────── */
void loop() {
  static uint32_t lastToggleAct = 0;
  bool toggle = digitalRead(PIN_TOGGLE);

  if (millis() - lastToggleAct > 300) {
    if (toggle == HIGH && !recording) {
      lastToggleAct = millis();
      struct tm t;
      if (getLocalTime(&t))
        sprintf(currentFile, "/%04d-%02d-%02d_%02d-%02d-%02d.wav",
          t.tm_year+1900, t.tm_mon+1, t.tm_mday, t.tm_hour, t.tm_min, t.tm_sec);
      else
        sprintf(currentFile, "/REC%03u.wav", fileIndex++);

      if (SD.exists(currentFile)) SD.remove(currentFile);
      wavFile = SD.open(currentFile, FILE_WRITE);
      if (!wavFile) {
        Serial.println("[REC]  ✗ Cannot create file");
      } else {
        bytesWritten = 0; recStartMs = millis();
        firstRead = true; lastLog = millis(); sdBufPos = 0;
        writeWavHeader(wavFile);
        recording = true;
        digitalWrite(PIN_LED_REC, HIGH);
        Serial.printf("[REC]  ✓ Started → %s\n", currentFile);
      }

    } else if (toggle == LOW && recording) {
      lastToggleAct = millis();
      recording = false;
      digitalWrite(PIN_LED_REC, LOW);
      uint32_t dur = (millis() - recStartMs) / 1000;
      if (sdBufPos > 0) { wavFile.write(sdBuf, sdBufPos); sdBufPos = 0; }
      wavFile.flush();
      wavFile.close();
      Serial.printf("[REC]  ✓ Stopped — %us\n", dur);
      sendStatus("idle");
      finalizeWav(currentFile);
      if (sendToBackend(currentFile, dur)) markUploaded(currentFile);
      else Serial.println("[REC]  Will retry on next boot");
    }
  }

  if (recording) {
    int32_t buf[256];
    size_t br = 0;
    i2s_read(I2S_PORT, buf, sizeof(buf), &br, pdMS_TO_TICKS(100));

    if (firstRead && br > 0) {
      firstRead = false;
      hpInPrev = hpOutPrev = peePrev = 0.0f;
      Serial.println("[I2S]  ✓ Audio flowing");
    }

    if (millis() - lastLog > 5000) {
      lastLog = millis();
      Serial.printf("[REC]  %u bytes\n", bytesWritten);
    }

    for (size_t i = 0; i < br / 4; i++) {
      // Shift 24-bit left-justified sample to 16-bit with gain
      int32_t s32 = (int32_t)buf[i] >> 11;
      if (s32 >  32767) s32 =  32767;
      if (s32 < -32768) s32 = -32768;
      int16_t s = (int16_t)s32;
      sdBuf[sdBufPos++] = (uint8_t)(s & 0xFF);
      sdBuf[sdBufPos++] = (uint8_t)(s >> 8);
      if (sdBufPos >= SD_WRITE_BUF) { wavFile.write(sdBuf, SD_WRITE_BUF); bytesWritten += SD_WRITE_BUF; sdBufPos = 0; }
    }
  }
}
