#include "audio.h"
#include <Wire.h>
#include "ESP_I2S.h"
#include "freertos/stream_buffer.h"
#include "pines.h"
#include "es8311.h"

namespace audio {

const int VOLUME = 80;
// En Pixel la boca va a un palmo del micrófono y bastaban 12 dB. Aquí la placa
// está en el escritorio y el paciente al frente: se arranca más alto y se
// ajusta con la prueba de distancia.
const int MIC_GAIN_DB_INICIAL = 24;

const int CHUNK = 480;                       // 20 ms
const size_t MIC_BYTES = RATE * 2 * 5;       // 5 s de colchón
const size_t SPK_BYTES = RATE * 2 * 10;

static I2SClass i2s;
static es8311_handle_t es = nullptr;
static StreamBufferHandle_t micSb, spkSb;
static volatile bool micOn = false;
static volatile bool flushSpk = false;
static volatile bool chunkPlaying = false;
static volatile float rmsReciente = 0;
static volatile int picoReciente = 0;
static int gainDb = MIC_GAIN_DB_INICIAL;

static StreamBufferHandle_t makeBuffer(size_t bytes) {
  // El espacio va en PSRAM: la RAM interna la necesitan el WiFi y el TLS.
  uint8_t *storage = (uint8_t *)ps_malloc(bytes + 1);
  StaticStreamBuffer_t *ctrl = (StaticStreamBuffer_t *)malloc(sizeof(StaticStreamBuffer_t));
  if (!storage || !ctrl) return nullptr;
  return xStreamBufferCreateStatic(bytes, 1, storage, ctrl);
}

static bool codecInit() {
  es = es8311_create(0, ES8311_ADDRRES_0);
  if (!es) return false;
  const es8311_clock_config_t clk = {
    .mclk_inverted = false,
    .sclk_inverted = false,
    .mclk_from_mclk_pin = true,
    .mclk_frequency = RATE * 256,
    .sample_frequency = RATE,
  };
  return es8311_init(es, &clk, ES8311_RESOLUTION_16, ES8311_RESOLUTION_16) == ESP_OK &&
         es8311_sample_frequency_config(es, clk.mclk_frequency, clk.sample_frequency) == ESP_OK &&
         es8311_microphone_config(es, false) == ESP_OK &&
         es8311_voice_volume_set(es, VOLUME, NULL) == ESP_OK && setMicGain(gainDb);
}

// El I2S va en estéreo; el códec es mono y pone lo mismo en los dos canales.
static void micTask(void *) {
  static int16_t stereo[2 * CHUNK];
  int16_t mono[CHUNK];
  double suma = 0;
  int pico = 0, bloques = 0;
  for (;;) {
    size_t got = 0;
    i2s_channel_read(i2s.rxChan(), stereo, sizeof stereo, &got, 100);
    if (!got) continue;
    size_t n = got / 4;
    for (size_t i = 0; i < n; i++) {
      mono[i] = stereo[2 * i];
      suma += (double)mono[i] * mono[i];
      pico = max(pico, abs((int)mono[i]));
    }
    if (++bloques == 5) {  // ~100 ms
      rmsReciente = sqrt(suma / (5.0 * n));
      picoReciente = pico;
      suma = 0;
      pico = bloques = 0;
    }
    if (micOn) xStreamBufferSend(micSb, mono, n * 2, 0);  // si nadie lo lee, se pierde
  }
}

static void speakerTask(void *) {
  static int16_t mono[CHUNK];
  static int16_t stereo[2 * CHUNK];
  for (;;) {
    if (flushSpk) {
      while (xStreamBufferReceive(spkSb, mono, sizeof mono, 0) > 0) {}
      flushSpk = false;
    }
    size_t got = xStreamBufferReceive(spkSb, mono, sizeof mono, pdMS_TO_TICKS(60));
    if (!got) {
      chunkPlaying = false;
      continue;
    }
    chunkPlaying = true;
    size_t n = got / 2;
    for (size_t i = 0; i < n; i++) stereo[2 * i] = stereo[2 * i + 1] = mono[i];
    size_t written = 0;
    i2s_channel_write(i2s.txChan(), stereo, n * 4, &written, 500);  // marca el ritmo real
  }
}

bool begin() {
  micSb = makeBuffer(MIC_BYTES);
  spkSb = makeBuffer(SPK_BYTES);
  if (!micSb || !spkSb) return false;
  pinMode(PA_EN, OUTPUT);
  digitalWrite(PA_EN, HIGH);
  i2s.setPins(I2S_BCK, I2S_WS, I2S_DO, I2S_DI, I2S_MCK);
  if (!i2s.begin(I2S_MODE_STD, RATE, I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO, I2S_STD_SLOT_BOTH)) return false;
  if (!codecInit()) return false;
  xTaskCreatePinnedToCore(micTask, "mic", 4096, nullptr, 5, nullptr, 0);
  xTaskCreatePinnedToCore(speakerTask, "parlante", 4096, nullptr, 5, nullptr, 0);
  return true;
}

void setMicStreaming(bool on) { micOn = on; }

void clearMic() {
  int16_t junk[CHUNK];
  while (xStreamBufferReceive(micSb, junk, sizeof junk, 0) > 0) {}
}

size_t micAvailable() { return xStreamBufferBytesAvailable(micSb) / 2; }

size_t readMic(int16_t *dst, size_t maxSamples) {
  return xStreamBufferReceive(micSb, dst, maxSamples * 2, 0) / 2;
}

float micRms() { return rmsReciente; }
int micPico() { return picoReciente; }

bool setMicGain(int db) {
  db = constrain(db, 0, 42) / 6 * 6;
  if (!es || es8311_microphone_gain_set(es, (es8311_mic_gain_t)(ES8311_MIC_GAIN_0DB + db / 6)) != ESP_OK) return false;
  gainDb = db;
  return true;
}

int micGain() { return gainDb; }

void play(const int16_t *pcm, size_t samples) {
  const uint8_t *p = (const uint8_t *)pcm;
  size_t left = samples * 2;
  for (int tries = 0; left && tries < 40; tries++) {  // si el colchón se llena, espera (máx. 2 s)
    size_t sent = xStreamBufferSend(spkSb, p, left, pdMS_TO_TICKS(50));
    p += sent;
    left -= sent;
  }
}

void stopPlayback() { flushSpk = true; }

bool isPlaying() { return chunkPlaying || xStreamBufferBytesAvailable(spkSb) > 0; }

}  // namespace audio
