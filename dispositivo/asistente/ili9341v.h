// Arranque del panel IPS 2,8" de la ES3C28P, copiado de la secuencia que publica
// lcdwiki para esta placa (res/ES3C28P/ILI9341V_Init.txt). La de Arduino_GFX es
// genérica: deja la curva de gamma de fábrica del controlador y otros voltajes,
// y la imagen salía opaca. La inversión de color (0x21) no va aquí: la manda la
// librería al ver ips = true.
#pragma once
#include "Arduino_GFX_Library.h"

static const uint8_t ILI9341V_ES3C28P_INIT[] = {
  BEGIN_WRITE,
  WRITE_C8_BYTES, 0xCF, 3, 0x00, 0xC1, 0x30,
  WRITE_C8_BYTES, 0xED, 4, 0x64, 0x03, 0x12, 0x81,
  WRITE_C8_BYTES, 0xE8, 3, 0x85, 0x00, 0x78,
  WRITE_C8_BYTES, 0xCB, 5, 0x39, 0x2C, 0x00, 0x34, 0x02,
  WRITE_C8_D8, 0xF7, 0x20,
  WRITE_C8_D16, 0xEA, 0x00, 0x00,
  WRITE_C8_D8, 0xC0, 0x13,         // Power control 1: VRH
  WRITE_C8_D8, 0xC1, 0x13,         // Power control 2: SAP, BT
  WRITE_C8_D16, 0xC5, 0x22, 0x35,  // VCOM 1
  WRITE_C8_D8, 0xC7, 0xBD,         // VCOM 2
  WRITE_C8_D8, 0x36, 0x08,         // orden BGR
  // Display function control. lcdwiki manda 0xA2 (SS = 1, barrido horizontal
  // invertido) y lo compensa con MX = 0; Arduino_GFX pone MX = 1 en setRotation,
  // así que con 0xA2 la imagen sale en espejo. Con 0x82 (SS = 0) se ve derecha.
  WRITE_C8_D16, 0xB6, 0x0A, 0x82,
  WRITE_C8_D8, 0x3A, 0x55,         // 16 bits por píxel
  WRITE_C8_D16, 0xF6, 0x01, 0x30,  // Interface control
  WRITE_C8_D16, 0xB1, 0x00, 0x1B,  // Frame rate
  WRITE_C8_D8, 0xF2, 0x00,         // sin 3-gamma
  WRITE_C8_D8, 0x26, 0x01,         // curva de gamma 1
  WRITE_C8_BYTES, 0xE0, 15,        // gamma positiva
  0x0F, 0x35, 0x31, 0x0B, 0x0E, 0x06, 0x49, 0xA7, 0x33, 0x07, 0x0F, 0x03, 0x0C, 0x0A, 0x00,
  WRITE_C8_BYTES, 0xE1, 15,        // gamma negativa
  0x00, 0x0A, 0x0F, 0x04, 0x11, 0x08, 0x36, 0x58, 0x4D, 0x07, 0x10, 0x0C, 0x32, 0x34, 0x0F,
  WRITE_COMMAND_8, 0x11,           // salir del modo sueño
  END_WRITE,
  DELAY, 120,
  BEGIN_WRITE,
  WRITE_COMMAND_8, 0x29,           // encender la imagen
  END_WRITE,
};
