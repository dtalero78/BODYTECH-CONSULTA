// Tipos y utilidades que usan las firmas del .ino. Van aquí y no en el .ino:
// Arduino pone las declaraciones que genera antes de cualquier tipo del .ino.
#pragma once
#include <Arduino.h>

enum Screen { SCR_CEDULA, SCR_CONFIRMA, SCR_REDES, SCR_CLAVE, SCR_CONECTANDO };

struct Rect {
  int x, y, w, h;
  bool contiene(int px, int py) const { return px >= x && px < x + w && py >= y && py < y + h; }
};

struct Tecla {
  Rect r;
  const char *texto;
};

// El dedo: dónde empezó, dónde va y cuánto se movió (separa un toque de un arrastre).
struct Dedo {
  bool abajo;
  int x, y;
  int x0, y0;
  int movido;
  bool usado;  // el gesto ya hizo algo: ignorar el soltar
};

// Teclado de la clave del WiFi (como el de Pixel, a 24 px por tecla).
enum TipoTecla : uint8_t { K_LETRA, K_MAYUS, K_BORRAR, K_PAGINA, K_ESPACIO, K_OK };
enum Pagina : uint8_t { PAG_LETRAS, PAG_NUMEROS, PAG_SIMBOLOS };

struct TeclaClave {
  float x, y, w, h;
  TipoTecla tipo;
  char ch;
  const char *rotulo;
  Pagina pagina;  // a cuál lleva (solo K_PAGINA)
};

constexpr uint16_t rgb(uint8_t r, uint8_t g, uint8_t b) {
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}
