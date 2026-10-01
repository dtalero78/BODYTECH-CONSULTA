// Micrófono y parlante (códec ES8311 por I2S), en PCM16 mono a 24 kHz: el
// formato de la transcripción en vivo de OpenAI. Adaptado del de Pixel.
#pragma once
#include <Arduino.h>

namespace audio {

const int RATE = 24000;

bool begin();                                     // códec, I2S y las dos tareas
void setMicStreaming(bool on);                    // encendido: lo grabado se acumula para leerlo
void clearMic();                                  // descarta lo grabado que nadie leyó
size_t micAvailable();                            // muestras grabadas esperando
size_t readMic(int16_t *dst, size_t maxSamples);  // saca muestras grabadas
float micRms();                                   // RMS de los últimos ~100 ms (siempre se mide)
int micPico();                                    // pico de los últimos ~100 ms
bool setMicGain(int db);                          // 0..42 en pasos de 6 dB
int micGain();
void play(const int16_t *pcm, size_t samples);    // encola audio para el parlante
void stopPlayback();
bool isPlaying();

}  // namespace audio
