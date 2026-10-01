// Dibujo con suavizado sobre el lienzo (el framebuffer RGB565 en PSRAM): letras
// con 4 bits de alfa y rectángulos redondeados. Arduino_GFX dibuja sin
// suavizado, y en esta pantalla (143 ppp) los escalones se notan.
#pragma once
#include <Arduino.h>

struct Glifo {
  uint16_t cp;      // código Unicode
  uint32_t off;     // primer byte en los bits de la fuente
  uint8_t w, h;
  int8_t dx, dy;    // del origen (izquierda, línea base) a la esquina superior izquierda
  uint8_t avance4;  // avance en cuartos de píxel
};

struct Fuente {
  const uint8_t *bits;  // 4 bits por píxel, dos por byte (el alto primero)
  const Glifo *glifos;  // ordenados por código
  uint16_t n;
  uint8_t asc, desc;
};

namespace lienzo {

void begin(uint16_t *fb, int w, int h);
// Las pantallas de la consulta van en horizontal (320x240) sobre el mismo
// framebuffer vertical: el lienzo traduce cada punto. El panel no se toca.
void orientacion(bool horizontal);
bool horizontal();
int ancho();
int alto();
// Un toque del táctil (siempre vertical) a coordenadas de la pantalla actual.
void fisicoALogico(int &x, int &y);
// Copia una imagen RGB565 (el logo) en (x, y).
void imagen(int x, int y, int w, int h, const uint16_t *datos);
void fillRect(int x, int y, int w, int h, uint16_t c);
void fillRoundRect(int x, int y, int w, int h, float r, uint16_t c);
void strokeRoundRect(int x, int y, int w, int h, float r, int grosor, uint16_t c);
void fillCircle(float cx, float cy, float r, uint16_t c);
// Triángulo con suavizado (4x4 muestras por píxel). Para íconos: flechas, la punta de la lupa.
void fillTriangle(float x0, float y0, float x1, float y1, float x2, float y2, uint16_t c);

int anchoTexto(const Fuente &f, const String &s);  // texto en UTF-8 (tildes, ñ)
void texto(const Fuente &f, const String &s, int x, int baseline, uint16_t c);
void textoCentrado(const Fuente &f, const String &s, int cx, int baseline, uint16_t c);
// Centra en el rectángulo. En vertical usa la altura de la "8", para que todas
// las etiquetas queden a la misma altura tengan o no letras con cola.
void textoEnRect(const Fuente &f, const String &s, int x, int y, int w, int h, uint16_t c);
// Recorta con "…" hasta que quepa en `maxW` (sin partir una letra UTF-8).
String recortar(const Fuente &f, const String &s, int maxW);

}  // namespace lienzo
