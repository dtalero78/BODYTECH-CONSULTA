#include "lienzo.h"

namespace lienzo {

static uint16_t *fb = nullptr;
static int FW = 0, FH = 0;  // el framebuffer, siempre vertical (como lo recorre el panel)
static int W = 0, H = 0;    // lo que ven las pantallas: vertical u horizontal
static bool horiz = false;

void begin(uint16_t *framebuffer, int w, int h) {
  fb = framebuffer;
  FW = W = w;
  FH = H = h;
  horiz = false;
}

// Horizontal = la placa girada 90° a la izquierda: el borde derecho de la
// vertical queda arriba. El punto (x, y) de la pantalla horizontal es el
// píxel (FW-1-y, x) del framebuffer.
void orientacion(bool horizontal) {
  horiz = horizontal;
  W = horiz ? FH : FW;
  H = horiz ? FW : FH;
}

bool horizontal() { return horiz; }
int ancho() { return W; }
int alto() { return H; }

void fisicoALogico(int &x, int &y) {
  if (!horiz) return;
  int px = x, py = y;
  x = py;
  y = FW - 1 - px;
}

static inline uint16_t &pixel(int x, int y) { return horiz ? fb[x * FW + (FW - 1 - y)] : fb[y * FW + x]; }

// a: 0 (todo fondo) .. 255 (todo color)
static inline void mezclar(int x, int y, uint16_t c, int a) {
  if (a <= 0 || x < 0 || y < 0 || x >= W || y >= H) return;
  uint16_t &p = pixel(x, y);
  if (a >= 255) {
    p = c;
    return;
  }
  int r = ((c >> 11) * a + (p >> 11) * (255 - a) + 127) / 255;
  int g = (((c >> 5) & 63) * a + ((p >> 5) & 63) * (255 - a) + 127) / 255;
  int b = ((c & 31) * a + (p & 31) * (255 - a) + 127) / 255;
  p = (r << 11) | (g << 5) | b;
}

void fillRect(int x, int y, int w, int h, uint16_t c) {
  int x0 = max(0, x), y0 = max(0, y), x1 = min(W, x + w), y1 = min(H, y + h);
  for (int yy = y0; yy < y1; yy++)
    for (int xx = x0; xx < x1; xx++) pixel(xx, yy) = c;
}

void imagen(int x, int y, int w, int h, const uint16_t *datos) {
  for (int yy = 0; yy < h; yy++) {
    int py = y + yy;
    if (py < 0 || py >= H) continue;
    for (int xx = 0; xx < w; xx++) {
      int px = x + xx;
      if (px >= 0 && px < W) pixel(px, py) = datos[yy * w + xx];
    }
  }
}

// Cuánto del píxel (px, py) cae dentro del rectángulo redondeado (0..1).
// Solo las esquinas dan valores intermedios: los bordes rectos son enteros.
static float cobertura(int px, int py, int x, int y, int w, int h, float r) {
  if (px < x || py < y || px >= x + w || py >= y + h) return 0;
  float fx = px + 0.5f, fy = py + 0.5f;
  bool izq = fx < x + r, der = fx > x + w - r, arr = fy < y + r, aba = fy > y + h - r;
  if (!((izq || der) && (arr || aba))) return 1;
  float dx = fx - (izq ? x + r : x + w - r), dy = fy - (arr ? y + r : y + h - r);
  return constrain(r - sqrtf(dx * dx + dy * dy) + 0.5f, 0.0f, 1.0f);
}

void fillRoundRect(int x, int y, int w, int h, float r, uint16_t c) {
  r = min(r, min(w, h) / 2.0f);
  for (int yy = y; yy < y + h; yy++)
    for (int xx = x; xx < x + w; xx++) mezclar(xx, yy, c, (int)lroundf(cobertura(xx, yy, x, y, w, h, r) * 255));
}

void strokeRoundRect(int x, int y, int w, int h, float r, int grosor, uint16_t c) {
  r = min(r, min(w, h) / 2.0f);
  float ri = max(0.0f, r - grosor);
  for (int yy = y; yy < y + h; yy++)
    for (int xx = x; xx < x + w; xx++) {
      float cov = cobertura(xx, yy, x, y, w, h, r) -
                  cobertura(xx, yy, x + grosor, y + grosor, w - 2 * grosor, h - 2 * grosor, ri);
      mezclar(xx, yy, c, (int)lroundf(cov * 255));
    }
}

void fillCircle(float cx, float cy, float r, uint16_t c) {
  int x0 = (int)floorf(cx - r - 1), x1 = (int)ceilf(cx + r + 1);
  int y0 = (int)floorf(cy - r - 1), y1 = (int)ceilf(cy + r + 1);
  for (int y = y0; y <= y1; y++)
    for (int x = x0; x <= x1; x++) {
      float dx = x + 0.5f - cx, dy = y + 0.5f - cy;
      float cov = constrain(r - sqrtf(dx * dx + dy * dy) + 0.5f, 0.0f, 1.0f);
      mezclar(x, y, c, (int)lroundf(cov * 255));
    }
}

static inline float lado(float ax, float ay, float bx, float by, float px, float py) {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

void fillTriangle(float x0, float y0, float x1, float y1, float x2, float y2, uint16_t c) {
  if (lado(x0, y0, x1, y1, x2, y2) < 0) {  // mismo sentido siempre
    std::swap(x1, x2);
    std::swap(y1, y2);
  }
  int bx0 = (int)floorf(min(x0, min(x1, x2))), bx1 = (int)ceilf(max(x0, max(x1, x2)));
  int by0 = (int)floorf(min(y0, min(y1, y2))), by1 = (int)ceilf(max(y0, max(y1, y2)));
  for (int y = by0; y <= by1; y++)
    for (int x = bx0; x <= bx1; x++) {
      int dentro = 0;
      for (int sy = 0; sy < 4; sy++)
        for (int sx = 0; sx < 4; sx++) {
          float px = x + (sx + 0.5f) / 4, py = y + (sy + 0.5f) / 4;
          if (lado(x0, y0, x1, y1, px, py) >= 0 && lado(x1, y1, x2, y2, px, py) >= 0 &&
              lado(x2, y2, x0, y0, px, py) >= 0)
            dentro++;
        }
      mezclar(x, y, c, dentro * 255 / 16);
    }
}

// Siguiente carácter de un texto en UTF-8.
static uint16_t siguiente(const String &s, int &i) {
  int n = s.length();
  uint8_t c = s[i++];
  if (c < 0x80) return c;
  if ((c & 0xE0) == 0xC0 && i < n) return ((c & 0x1F) << 6) | (s[i++] & 0x3F);
  if ((c & 0xF0) == 0xE0 && i + 1 < n) {
    uint16_t v = ((c & 0x0F) << 12) | ((s[i] & 0x3F) << 6) | (s[i + 1] & 0x3F);
    i += 2;
    return v;
  }
  return '?';
}

static const Glifo *buscar(const Fuente &f, uint16_t cp) {
  int lo = 0, hi = f.n - 1;
  while (lo <= hi) {
    int m = (lo + hi) / 2;
    if (f.glifos[m].cp == cp) return &f.glifos[m];
    if (f.glifos[m].cp < cp) lo = m + 1;
    else hi = m - 1;
  }
  return cp == '?' ? nullptr : buscar(f, '?');
}

int anchoTexto(const Fuente &f, const String &s) {
  int pluma4 = 0;
  for (int i = 0; i < (int)s.length();) {
    const Glifo *g = buscar(f, siguiente(s, i));
    if (g) pluma4 += g->avance4;
  }
  return (pluma4 + 2) / 4;
}

void texto(const Fuente &f, const String &s, int x, int baseline, uint16_t c) {
  int pluma4 = x * 4;
  for (int i = 0; i < (int)s.length();) {
    const Glifo *g = buscar(f, siguiente(s, i));
    if (!g) continue;
    int gx = (pluma4 + 2) / 4 + g->dx, gy = baseline + g->dy;
    const uint8_t *bits = f.bits + g->off;
    for (int yy = 0; yy < g->h; yy++)
      for (int xx = 0; xx < g->w; xx++) {
        int k = yy * g->w + xx;
        int a4 = (k & 1) ? bits[k >> 1] & 0x0F : bits[k >> 1] >> 4;
        mezclar(gx + xx, gy + yy, c, a4 * 17);
      }
    pluma4 += g->avance4;
  }
}

void textoCentrado(const Fuente &f, const String &s, int cx, int baseline, uint16_t c) {
  texto(f, s, cx - anchoTexto(f, s) / 2, baseline, c);
}

void textoEnRect(const Fuente &f, const String &s, int x, int y, int w, int h, uint16_t c) {
  const Glifo *ocho = buscar(f, '8');
  int alto = ocho ? ocho->h : f.asc, arriba = ocho ? ocho->dy : -f.asc;
  textoCentrado(f, s, x + w / 2, y + (h - alto) / 2 - arriba, c);
}

String recortar(const Fuente &f, const String &s, int maxW) {
  if (anchoTexto(f, s) <= maxW) return s;
  String r = s;
  while (r.length() && anchoTexto(f, r + "…") > maxW) {
    int n = r.length();
    while (n > 0 && ((uint8_t)r[n - 1] & 0xC0) == 0x80) n--;  // no partir una letra de dos bytes
    r.remove(n > 0 ? n - 1 : 0);
  }
  return r + "…";
}

}  // namespace lienzo
