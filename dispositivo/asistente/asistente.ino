// Asistente médico de Bodytech para la consulta presencial (UMV presencial y
// médico corporativo), en la LCDWIKI ES3C28P.
//
// Pantallas: la cédula del paciente (logo + teclado + el ícono del WiFi), y la
// configuración del WiFi (lista de redes, teclado de la clave, conectando). La
// lógica de la red vive en red.cpp. Por serie (115200) hay pruebas de una
// letra: ? diagnóstico, m medidor del micrófono, g graba 5 s y los manda al Mac
// (tools/placa.py), + / - ganancia del micrófono, t tono por el parlante, l LED,
// r coordenadas crudas del táctil, f captura de la pantalla.
#include <Arduino.h>
#include <Wire.h>
#include "Arduino_GFX_Library.h"
#include "pines.h"
#include "ili9341v.h"
#include "tipos.h"
#include "lienzo.h"
#include "fuentes.h"
#include "tactil.h"
#include "audio.h"
#include "red.h"
#include "logo.h"

// ---------- Pantalla ----------

Arduino_DataBus *bus = new Arduino_ESP32SPI(LCD_DC, LCD_CS, LCD_SCK, LCD_MOSI, LCD_MISO);
// El cuarto parámetro es "IPS": este panel necesita los colores invertidos.
// Arranca con la secuencia del fabricante (ili9341v.h), no con la genérica.
Arduino_ILI9341 *gfx = new Arduino_ILI9341(bus, GFX_NOT_DEFINED, 0, true, LCD_W, LCD_H, 0, 0, 0, 0,
                                           ILI9341V_ES3C28P_INIT, sizeof(ILI9341V_ES3C28P_INIT));
// Un lienzo del tamaño de la pantalla (150 KB, en PSRAM); al panel se mandan solo las filas que cambian.
Arduino_Canvas *cv = new Arduino_Canvas(LCD_W, LCD_H, gfx);

const uint32_t SPI_HZ = 40000000;  // a 80 MHz la imagen sale con basura

void flushRows(int y0, int y1) {
  y0 = max(0, y0);
  y1 = min((int)LCD_H, y1);
  if (y1 <= y0) return;
  gfx->draw16bitRGBBitmap(0, y0, cv->getFramebuffer() + y0 * LCD_W, LCD_W, y1 - y0);
}

void flushAll() { flushRows(0, LCD_H); }

// ¿Pasaron `ms` desde `desde`? Con signo, para que una marca tomada durante la
// vuelta (unos ms después de `now`) no dé un plazo vencido al instante.
bool pasaron(uint32_t desde, uint32_t ms, uint32_t now) { return (int32_t)(now - desde) >= (int32_t)ms; }

// Paleta de la app (zinc de Tailwind), un paso más oscura que en la web: en este
// LCD los grises claros se pierden contra el blanco.
const uint16_t C_BG = rgb(255, 255, 255);
const uint16_t C_TEXT = rgb(9, 9, 11);         // #09090b
const uint16_t C_MUTED = rgb(82, 82, 91);      // #52525b
const uint16_t C_KEY = rgb(234, 234, 237);
const uint16_t C_BORDER = rgb(190, 190, 197);
const uint16_t C_PRESSED = rgb(200, 200, 206);
const uint16_t C_ERROR = rgb(220, 38, 38);
const uint16_t C_OK = rgb(22, 128, 61);        // #16803d

const int RADIO_TECLA = 9, RADIO_CAMPO = 11;
const int TOQUE_HOLGURA = 10;  // px que puede moverse el dedo y seguir siendo un toque

// La librería pide un puntero no constante, pero solo lee la imagen (que vive en la flash).
void drawLogo(int y) { cv->draw16bitRGBBitmap((LCD_W - LOGO_W) / 2, y, (uint16_t *)LOGO, LOGO_W, LOGO_H); }

void boton(const Rect &r, const String &rotulo, bool principal) {
  if (principal) {
    lienzo::fillRoundRect(r.x, r.y, r.w, r.h, RADIO_CAMPO, C_TEXT);
    lienzo::textoEnRect(F_TITULO, rotulo, r.x, r.y, r.w, r.h, C_BG);
  } else {
    lienzo::strokeRoundRect(r.x, r.y, r.w, r.h, RADIO_CAMPO, 2, C_TEXT);
    lienzo::textoEnRect(F_TITULO, rotulo, r.x, r.y, r.w, r.h, C_TEXT);
  }
}

// Escribe en varias líneas de ancho maxW, partiendo por espacios. Devuelve la línea base siguiente.
int textoEnVarias(const Fuente &f, const String &s, int x, int base, int maxW, int alto, uint16_t c) {
  String linea;
  int i = 0;
  while (i < (int)s.length()) {
    int sp = s.indexOf(' ', i);
    if (sp < 0) sp = s.length();
    String palabra = s.substring(i, sp);
    String prueba = linea.length() ? linea + " " + palabra : palabra;
    if (linea.length() && lienzo::anchoTexto(f, prueba) > maxW) {
      lienzo::texto(f, linea, x, base, c);
      base += alto;
      linea = palabra;
    } else {
      linea = prueba;
    }
    i = sp + 1;
  }
  if (linea.length()) {
    lienzo::texto(f, linea, x, base, c);
    base += alto;
  }
  return base;
}

// Barras de señal: `n` llenas de 4. Abajo a la izquierda en (x, abajo).
void barrasSenal(int x, int abajo, int n, uint16_t lleno, uint16_t vacio) {
  for (int i = 0; i < 4; i++) {
    int h = 6 + i * 5;
    lienzo::fillRoundRect(x + i * 7, abajo - h, 5, h, 1.5f, i < n ? lleno : vacio);
  }
}

Screen screen = SCR_CEDULA;
bool repintar = false;
Dedo dedo = {};
void goTo(Screen s);

// ---------- Pantalla de la cédula ----------

const int LOGO_Y = 10;
const Rect CAMPO = {12, 104, 216, 44};
const Rect BTN_WIFI = {194, 4, 44, 44};  // arriba a la derecha, al lado del logo
const int TECLADO_Y = 156, TECLA_H = 36, TECLA_GAP = 5, TECLA_W = 68, MARGEN = 12;
const int MAX_DIGITOS = 12;
const int MIN_DIGITOS = 5;

Tecla teclas[12];
String cedula;
String aviso;  // texto rojo bajo el campo (p. ej. "Faltan dígitos")
int teclaApretada = -1;
bool wifiPintado = false;  // lo que muestra hoy el ícono, para repintarlo solo si cambia
int barrasPintadas = -1;

void armarTeclado() {
  static const char *TEXTOS[12] = {"1", "2", "3", "4", "5", "6", "7", "8", "9", "Borrar", "0", "OK"};
  for (int i = 0; i < 12; i++) {
    int fila = i / 3, col = i % 3;
    teclas[i] = {{MARGEN + col * (TECLA_W + 6), TECLADO_Y + fila * (TECLA_H + TECLA_GAP), TECLA_W, TECLA_H}, TEXTOS[i]};
  }
}

bool esOk(int i) { return i == 11; }
bool esBorrar(int i) { return i == 9; }

void drawTecla(int i) {
  const Tecla &t = teclas[i];
  bool ok = esOk(i), apretada = i == teclaApretada;
  uint16_t fondo = ok ? (apretada ? C_MUTED : C_TEXT) : (apretada ? C_PRESSED : C_KEY);
  lienzo::fillRect(t.r.x, t.r.y, t.r.w, t.r.h, C_BG);
  lienzo::fillRoundRect(t.r.x, t.r.y, t.r.w, t.r.h, RADIO_TECLA, fondo);
  lienzo::textoEnRect(esBorrar(i) || ok ? F_TECLA_CHICA : F_TECLA, t.texto, t.r.x, t.r.y, t.r.w, t.r.h,
                      ok ? C_BG : C_TEXT);
}

void drawCampo() {
  lienzo::fillRect(0, CAMPO.y - 30, LCD_W, CAMPO.h + 36, C_BG);
  lienzo::textoCentrado(F_ETIQUETA, aviso.length() ? aviso : String("Cédula del paciente"), LCD_W / 2,
                        CAMPO.y - 10, aviso.length() ? C_ERROR : C_MUTED);
  lienzo::strokeRoundRect(CAMPO.x, CAMPO.y, CAMPO.w, CAMPO.h, RADIO_CAMPO, 2, C_BORDER);
  if (cedula.length()) lienzo::textoEnRect(F_CIFRAS, cedula, CAMPO.x, CAMPO.y, CAMPO.w, CAMPO.h, C_TEXT);
  else lienzo::textoEnRect(F_TEXTO, "Escriba el número", CAMPO.x, CAMPO.y, CAMPO.w, CAMPO.h, C_MUTED);
}

// El ícono del WiFi: barras con la señal, o grises con un punto rojo si no hay internet.
void drawIconoWifi() {
  const Rect &b = BTN_WIFI;
  lienzo::fillRect(b.x, b.y, b.w, b.h, C_BG);
  bool ok = red::conectada();
  int n = ok ? red::barras(red::rssi()) : 0;
  barrasSenal(b.x + 9, b.y + 34, n, C_TEXT, C_BORDER);
  if (!ok) lienzo::fillCircle(b.x + 36, b.y + 10, 4.5f, C_ERROR);
  wifiPintado = ok;
  barrasPintadas = n;
}

void drawCedula() {
  lienzo::fillRect(0, 0, LCD_W, LCD_H, C_BG);
  drawLogo(LOGO_Y);
  drawIconoWifi();
  drawCampo();
  for (int i = 0; i < 12; i++) drawTecla(i);
  flushAll();
}

void pulsarTecla(int i) {
  aviso = "";
  if (esBorrar(i)) {
    if (cedula.length()) cedula.remove(cedula.length() - 1);
  } else if (esOk(i)) {
    if ((int)cedula.length() < MIN_DIGITOS) aviso = "Faltan dígitos";
    else if (!red::conectada()) aviso = "Sin internet: toque el WiFi arriba";
    else {
      Serial.printf("[cedula] %s\n", cedula.c_str());
      goTo(SCR_CONFIRMA);
      return;
    }
  } else if ((int)cedula.length() < MAX_DIGITOS) {
    cedula += teclas[i].texto;
  }
  drawCampo();
  flushRows(CAMPO.y - 30, CAMPO.y + CAMPO.h + 6);
}

void abrirRedes();

void cedulaAbajo() {
  if (BTN_WIFI.contiene(dedo.x, dedo.y)) {
    dedo.usado = true;
    abrirRedes();
    return;
  }
  for (int i = 0; i < 12; i++) {
    if (!teclas[i].r.contiene(dedo.x, dedo.y)) continue;
    teclaApretada = i;
    drawTecla(i);
    flushRows(teclas[i].r.y, teclas[i].r.y + teclas[i].r.h);
    pulsarTecla(i);
    if (screen != SCR_CEDULA) teclaApretada = -1;
    break;
  }
}

void cedulaArriba() {
  if (teclaApretada < 0) return;
  int i = teclaApretada;
  teclaApretada = -1;
  drawTecla(i);
  flushRows(teclas[i].r.y, teclas[i].r.y + teclas[i].r.h);
}

void tickCedula(uint32_t now) {
  static uint32_t ultimo = 0;
  if (!pasaron(ultimo, 1000, now)) return;
  ultimo = now;
  bool ok = red::conectada();
  int n = ok ? red::barras(red::rssi()) : 0;
  if (ok != wifiPintado || n != barrasPintadas) {
    drawIconoWifi();
    if (ok && aviso.startsWith("Sin internet")) {
      aviso = "";
      drawCampo();
      flushRows(CAMPO.y - 30, CAMPO.y + CAMPO.h + 6);
    }
    flushRows(BTN_WIFI.y, BTN_WIFI.y + BTN_WIFI.h);
  }
}

// ---------- Pantalla de confirmación (mientras no hay servidor) ----------

const Rect BOTON_VOLVER = {MARGEN, 262, LCD_W - 2 * MARGEN, 44};

void drawConfirma() {
  lienzo::fillRect(0, 0, LCD_W, LCD_H, C_BG);
  drawLogo(LOGO_Y);
  lienzo::textoCentrado(F_ETIQUETA, "Cédula", LCD_W / 2, 120, C_MUTED);
  lienzo::textoCentrado(F_CIFRAS, cedula, LCD_W / 2, 158, C_TEXT);
  lienzo::textoCentrado(F_TEXTO, "Lista para buscar al paciente.", LCD_W / 2, 198, C_TEXT);
  lienzo::textoCentrado(F_ETIQUETA, "(Todavía sin servidor)", LCD_W / 2, 220, C_MUTED);
  boton(BOTON_VOLVER, "Nueva cédula", true);
  flushAll();
}

void confirmaArriba() {
  if (dedo.movido > TOQUE_HOLGURA || !BOTON_VOLVER.contiene(dedo.x0, dedo.y0)) return;
  cedula = "";
  goTo(SCR_CEDULA);
}

// ---------- Lista de redes ----------

const int LISTA_Y = 44, LISTA_H = 220, FILA_H = 52;
const Rect BTN_BUSCAR = {12, 272, 104, 40};
const Rect BTN_SALIR = {124, 272, 104, 40};
const int AYUDA_H = 120;
const char *AYUDA =
    "iPhone: en Ajustes > Hotspot personal active Maximizar compatibilidad y deje esa pantalla "
    "abierta. Android: comparta en la banda de 2,4 GHz.";

int scrollLista = 0, scrollAlTocar = 0;
bool arrastrando = false;
uint8_t puntos = 0;
uint32_t puntosEn = 0;
String redElegida;
bool redAbierta = false;

int altoLista() { return red::redes().size() * FILA_H + AYUDA_H; }

void abrirRedes() {
  red::buscar();
  scrollLista = 0;
  goTo(SCR_REDES);
}

void salirDeRedes() {
  red::salirDeConfiguracion();
  goTo(SCR_CEDULA);
}

void drawAyuda(int y) {
  lienzo::texto(F_TITULO, "¿No aparece el celular?", 14, y + 28, C_TEXT);
  int base = textoEnVarias(F_ETIQUETA, AYUDA, 14, y + 48, LCD_W - 28, 17, C_MUTED);
  if (red::refinando()) lienzo::texto(F_ETIQUETA, String("Sigo buscando") + String("...").substring(0, puntos + 1),
                                      14, base + 4, C_TEXT);
}

void drawFilaRed(const red::Red &r, int y) {
  lienzo::texto(F_TITULO, lienzo::recortar(F_TITULO, r.ssid, 168), 14, y + 24, C_TEXT);
  static const char *SENAL[] = {"", "Señal débil", "Señal regular", "Señal buena", "Señal excelente"};
  String sub = SENAL[red::barras(r.rssi)];
  sub += r.abierta ? " · abierta" : " · con clave";
  if (red::guardada(r.ssid)) sub = "Guardada · " + sub;
  lienzo::texto(F_ETIQUETA, lienzo::recortar(F_ETIQUETA, sub, 180), 14, y + 42, C_MUTED);
  barrasSenal(198, y + 38, red::barras(r.rssi), C_TEXT, C_BORDER);
  lienzo::fillRect(14, y + FILA_H - 1, LCD_W - 28, 1, C_KEY);
}

void drawRedes() {
  lienzo::fillRect(0, 0, LCD_W, LCD_H, C_BG);
  const auto &redes = red::redes();
  int medio = LISTA_Y + LISTA_H / 2;
  if (red::buscando()) {
    lienzo::textoCentrado(F_TITULO, String("Buscando redes") + String("...").substring(0, puntos + 1), LCD_W / 2,
                          medio, C_MUTED);
  } else if (red::busquedaFallo()) {
    lienzo::textoCentrado(F_TITULO, "No pude buscar redes", LCD_W / 2, medio, C_MUTED);
  } else if (redes.empty()) {
    lienzo::textoCentrado(F_TITULO, "No encontré redes", LCD_W / 2, LISTA_Y + 30, C_MUTED);
    drawAyuda(LISTA_Y + 50);
  } else {
    for (size_t i = 0; i < redes.size(); i++) {
      int y = LISTA_Y + i * FILA_H - scrollLista;
      if (y + FILA_H <= LISTA_Y || y >= LISTA_Y + LISTA_H) continue;
      drawFilaRed(redes[i], y);
    }
    int ayudaY = LISTA_Y + redes.size() * FILA_H - scrollLista;
    if (ayudaY < LISTA_Y + LISTA_H) drawAyuda(ayudaY);
    int total = altoLista();
    if (total > LISTA_H) {  // barrita de desplazamiento
      int barH = max(20, LISTA_H * LISTA_H / total);
      int barY = LISTA_Y + (LISTA_H - barH) * scrollLista / (total - LISTA_H);
      lienzo::fillRoundRect(LCD_W - 5, barY, 3, barH, 1.5f, C_BORDER);
    }
  }
  // Cabecera y pie van encima: tapan las filas que se salen al desplazar.
  lienzo::fillRect(0, 0, LCD_W, LISTA_Y, C_BG);
  lienzo::textoCentrado(F_TITULO, "Elija la red WiFi", LCD_W / 2, 30, C_TEXT);
  lienzo::fillRect(0, LISTA_Y - 1, LCD_W, 1, C_KEY);
  lienzo::fillRect(0, LISTA_Y + LISTA_H, LCD_W, LCD_H - LISTA_Y - LISTA_H, C_BG);
  boton(BTN_BUSCAR, "Buscar", false);
  boton(BTN_SALIR, "Salir", true);
}

void tickRedes(uint32_t now) {
  if (red::listaCambio()) repintar = true;
  if ((red::buscando() || red::refinando()) && pasaron(puntosEn, 400, now)) {
    puntosEn = now;
    puntos = (puntos + 1) % 3;
    repintar = true;
  }
  if (repintar) {
    repintar = false;
    drawRedes();
    flushAll();
  }
}

void abrirClave(const String &inicial);

void elegirRed(const red::Red &r) {
  redElegida = r.ssid;
  redAbierta = r.abierta;
  Serial.printf("[red] elegida: %s (%s)\n", r.ssid.c_str(), r.abierta ? "abierta" : "con clave");
  if (r.abierta) {
    red::conectar(r.ssid, "");
    goTo(SCR_CONECTANDO);
  } else {
    // Si ya estaba guardada, la clave viene escrita: basta con OK.
    abrirClave(red::claveGuardada(r.ssid));
  }
}

void redesAbajo() {
  scrollAlTocar = scrollLista;
  arrastrando = false;
}

void redesMovio() {
  bool enLista = dedo.y0 >= LISTA_Y && dedo.y0 < LISTA_Y + LISTA_H;
  if (!enLista || red::buscando() || dedo.movido <= TOQUE_HOLGURA) return;
  arrastrando = true;
  int s = constrain(scrollAlTocar - (dedo.y - dedo.y0), 0, max(0, altoLista() - LISTA_H));
  if (s != scrollLista) {
    scrollLista = s;
    repintar = true;
  }
}

void redesArriba() {
  if (dedo.usado || arrastrando || dedo.movido > TOQUE_HOLGURA) return;
  int x = dedo.x0, y = dedo.y0;
  if (BTN_BUSCAR.contiene(x, y)) {
    red::buscar();
    scrollLista = 0;
    repintar = true;
  } else if (BTN_SALIR.contiene(x, y)) {
    salirDeRedes();
  } else if (!red::buscando() && y >= LISTA_Y && y < LISTA_Y + LISTA_H) {
    int i = (y - LISTA_Y + scrollLista) / FILA_H;
    if (i >= 0 && i < (int)red::redes().size()) elegirRed(red::redes()[i]);
  }
}

// ---------- Teclado de la clave ----------

TeclaClave teclasClave[40];
int nTeclas = 0;
Pagina pagina = PAG_LETRAS;
uint8_t mayus = 0;  // 0 = minúsculas, 1 = una mayúscula, 2 = mayúsculas fijas
uint32_t ultimoMayus = 0;
String clave;
String mensajeClave;
uint16_t colorMensaje = C_MUTED;
int teclaClaveApretada = -1;
uint32_t repetirBorrarEn = 0;

const int KB_Y = 122, KB_FILA = 49;
const float KW = LCD_W / 10.0f;  // 24 px ≈ 4,3 mm por tecla
const int CLAVE_MAX = 63;        // lo máximo que acepta WPA2
const Rect CAMPO_CLAVE = {12, 54, 216, 42};
const Rect BTN_A_REDES = {0, 0, 100, 30};

void agregarTecla(float x, int fila, float w, TipoTecla tipo, char ch, const char *rotulo, Pagina pag) {
  teclasClave[nTeclas++] = {x, (float)(KB_Y + fila * KB_FILA), w, (float)KB_FILA, tipo, ch, rotulo, pag};
}

void filaDeLetras(const char *letras, int fila, float x0, float w) {
  for (int i = 0; letras[i]; i++) agregarTecla(x0 + i * w, fila, w, K_LETRA, letras[i], nullptr, PAG_LETRAS);
}

// Entre las tres páginas están los 95 caracteres ASCII: todo lo que puede llevar una clave de WiFi.
void armarTeclasClave() {
  nTeclas = 0;
  if (pagina == PAG_LETRAS) {
    bool up = mayus != 0;
    filaDeLetras(up ? "QWERTYUIOP" : "qwertyuiop", 0, 0, KW);
    filaDeLetras(up ? "ASDFGHJKL" : "asdfghjkl", 1, KW / 2, KW);
    agregarTecla(0, 2, KW * 1.5f, K_MAYUS, 0, nullptr, PAG_LETRAS);
    filaDeLetras(up ? "ZXCVBNM" : "zxcvbnm", 2, KW * 1.5f, KW);
    agregarTecla(0, 3, 56, K_PAGINA, 0, "123", PAG_NUMEROS);
  } else {
    if (pagina == PAG_NUMEROS) {
      filaDeLetras("1234567890", 0, 0, KW);
      filaDeLetras("-/:;()$&@", 1, KW / 2, KW);
      agregarTecla(0, 2, KW * 1.5f, K_PAGINA, 0, "#+=", PAG_SIMBOLOS);
    } else {
      filaDeLetras("[]{}#%^*+=", 0, 0, KW);
      filaDeLetras("_\\|~<>\"`", 1, KW, KW);
      agregarTecla(0, 2, KW * 1.5f, K_PAGINA, 0, "123", PAG_NUMEROS);
    }
    filaDeLetras(".,?!'", 2, KW * 1.5f, KW * 7 / 5.0f);
    agregarTecla(0, 3, 56, K_PAGINA, 0, "ABC", PAG_LETRAS);
  }
  agregarTecla(KW * 8.5f, 2, KW * 1.5f, K_BORRAR, 0, nullptr, PAG_LETRAS);
  agregarTecla(56, 3, 128, K_ESPACIO, ' ', "espacio", PAG_LETRAS);
  agregarTecla(184, 3, 56, K_OK, 0, "OK", PAG_LETRAS);
}

// La tecla más cercana al dedo (no hace falta caer exactamente dentro).
int teclaEn(int px, int py) {
  if (py < KB_Y - 20) return -1;  // subió el dedo fuera del teclado: cancelar
  int mejor = -1;
  float mejorD = 1e9;
  for (int i = 0; i < nTeclas; i++) {
    const TeclaClave &k = teclasClave[i];
    float dx = max(max(k.x - px, 0.0f), px - (k.x + k.w));
    float dy = max(max(k.y - py, 0.0f), py - (k.y + k.h));
    float d = dx * dx + dy * dy;
    if (d < mejorD) {
      mejorD = d;
      mejor = i;
    }
  }
  return mejorD <= 24 * 24 ? mejor : -1;
}

void abrirClave(const String &inicial) {
  clave = inicial;
  pagina = PAG_LETRAS;
  mayus = 0;
  mensajeClave = "";
  teclaClaveApretada = -1;
  armarTeclasClave();
  goTo(SCR_CLAVE);
}

void iconoMayus(float cx, float cy, uint16_t c) {
  lienzo::fillTriangle(cx - 7, cy + 1, cx + 7, cy + 1, cx, cy - 7, c);
  lienzo::fillRect((int)cx - 3, (int)cy + 1, 6, 6, c);
  if (mayus == 2) lienzo::fillRect((int)cx - 7, (int)cy + 9, 14, 2, c);
}

void iconoBorrar(float cx, float cy, uint16_t c, uint16_t fondo) {
  lienzo::fillTriangle(cx - 10, cy, cx - 4, cy - 7, cx - 4, cy + 7, c);
  lienzo::fillRect((int)cx - 4, (int)cy - 7, 14, 14, c);
  lienzo::textoEnRect(F_ETIQUETA, "x", (int)cx - 4, (int)cy - 7, 14, 14, fondo);
}

void drawTeclaClave(const TeclaClave &k, bool apretada) {
  int x = (int)(k.x + 1.5f), y = (int)(k.y + 3), w = (int)(k.w - 3), h = (int)(k.h - 6);
  bool ok = k.tipo == K_OK;
  uint16_t fondo = ok ? (apretada ? C_MUTED : C_TEXT) : (apretada ? C_PRESSED : C_KEY);
  uint16_t tinta = ok ? C_BG : C_TEXT;
  lienzo::fillRoundRect(x, y, w, h, 6, fondo);
  float cx = x + w / 2.0f, cy = y + h / 2.0f;
  switch (k.tipo) {
    case K_LETRA:
      lienzo::textoEnRect(F_TECLA_CHICA, String(k.ch), x, y, w, h, tinta);
      break;
    case K_MAYUS:
      iconoMayus(cx, cy, mayus == 0 ? C_MUTED : C_TEXT);
      break;
    case K_BORRAR:
      iconoBorrar(cx, cy, tinta, fondo);
      break;
    default:
      lienzo::textoEnRect(k.tipo == K_ESPACIO ? F_ETIQUETA : F_TECLA_CHICA, k.rotulo, x, y, w, h, tinta);
      break;
  }
}

// La lupa: la letra en grande encima del dedo, que tapa la tecla.
void drawLupa(const TeclaClave &k) {
  const int LW = 40, LH = 50;
  float cx = k.x + k.w / 2;
  int bx = constrain((int)cx - LW / 2, 2, LCD_W - LW - 2);
  int by = (int)k.y - LH - 4;
  lienzo::fillRoundRect(bx, by, LW, LH, 10, C_TEXT);
  lienzo::fillTriangle(cx - 6, by + LH - 1, cx + 6, by + LH - 1, cx, by + LH + 5, C_TEXT);
  lienzo::textoEnRect(F_LUPA, String(k.ch), bx, by, LW, LH, C_BG);
}

void drawClave() {
  lienzo::fillRect(0, 0, LCD_W, LCD_H, C_BG);
  lienzo::texto(F_ETIQUETA, "‹ Redes", 12, 20, C_MUTED);
  lienzo::texto(F_TITULO, lienzo::recortar(F_TITULO, "Clave de " + redElegida, LCD_W - 24), 12, 46, C_TEXT);

  // La clave se ve mientras se escribe: en una pantalla de escritorio solo la ve quien la escribe.
  const Rect &c = CAMPO_CLAVE;
  lienzo::strokeRoundRect(c.x, c.y, c.w, c.h, RADIO_CAMPO, 2, C_BORDER);
  int caben = (c.w - 24) / 11;  // JetBrains Mono a 18 px: ~11 px por carácter
  String vista = (int)clave.length() > caben ? clave.substring(clave.length() - caben) : clave;
  lienzo::texto(F_CLAVE, vista, c.x + 10, c.y + 28, C_TEXT);
  int cursorX = c.x + 10 + lienzo::anchoTexto(F_CLAVE, vista) + 1;
  lienzo::fillRect(cursorX, c.y + 10, 2, 22, C_TEXT);

  lienzo::texto(F_ETIQUETA, mensajeClave.length() ? mensajeClave : String("La letra se escribe al soltar el dedo"), 12,
                114, mensajeClave.length() ? colorMensaje : C_MUTED);

  for (int i = 0; i < nTeclas; i++) drawTeclaClave(teclasClave[i], i == teclaClaveApretada);
  if (teclaClaveApretada >= 0 && teclasClave[teclaClaveApretada].tipo == K_LETRA) drawLupa(teclasClave[teclaClaveApretada]);
}

void enviarClave() {
  if (clave.length() < 8) {
    mensajeClave = "La clave tiene mínimo 8 caracteres";
    colorMensaje = C_ERROR;
    return;
  }
  red::conectar(redElegida, clave);
  goTo(SCR_CONECTANDO);
}

void activarTecla(const TeclaClave &k) {
  mensajeClave = "";
  switch (k.tipo) {
    case K_LETRA:
    case K_ESPACIO:
      if ((int)clave.length() < CLAVE_MAX) clave += k.ch;
      if (mayus == 1) {
        mayus = 0;
        armarTeclasClave();
      }
      break;
    case K_MAYUS: {
      uint32_t now = millis();
      // Doble toque rápido = mayúsculas fijas, como en el celular.
      if (mayus == 1 && now - ultimoMayus < 400) mayus = 2;
      else mayus = mayus ? 0 : 1;
      ultimoMayus = now;
      armarTeclasClave();
      break;
    }
    case K_PAGINA:
      pagina = k.pagina;
      mayus = 0;
      armarTeclasClave();
      break;
    case K_OK:
      enviarClave();
      break;
    case K_BORRAR:
      break;  // borra al apretar, no al soltar (ver claveAbajo)
  }
}

void borrarUltima() {
  if (clave.length()) clave.remove(clave.length() - 1);
  mensajeClave = "";
}

void claveAbajo() {
  teclaClaveApretada = teclaEn(dedo.x, dedo.y);
  if (teclaClaveApretada >= 0 && teclasClave[teclaClaveApretada].tipo == K_BORRAR) {
    borrarUltima();
    repetirBorrarEn = millis() + 500;  // dejándolo apretado sigue borrando
  }
  repintar = true;
}

void claveMovio() {
  if (teclaClaveApretada >= 0 && teclasClave[teclaClaveApretada].tipo == K_BORRAR) return;
  int k = teclaEn(dedo.x, dedo.y);
  if (k != teclaClaveApretada) {
    teclaClaveApretada = k;
    repintar = true;
  }
}

void claveArriba() {
  int k = teclaClaveApretada;
  teclaClaveApretada = -1;
  repintar = true;
  if (dedo.usado) return;
  if (k >= 0) activarTecla(teclasClave[k]);
  else if (dedo.movido <= TOQUE_HOLGURA && BTN_A_REDES.contiene(dedo.x0, dedo.y0)) goTo(SCR_REDES);
}

void tickClave(uint32_t now) {
  if (dedo.abajo && teclaClaveApretada >= 0 && teclasClave[teclaClaveApretada].tipo == K_BORRAR &&
      pasaron(repetirBorrarEn, 0, now)) {
    borrarUltima();
    repetirBorrarEn = now + 90;
    repintar = true;
  }
  if (repintar) {
    repintar = false;
    drawClave();
    flushAll();
  }
}

// ---------- Conectando ----------

const Rect BTN_REINTENTAR = {12, 212, 216, 44};
const Rect BTN_OTRA_RED = {12, 264, 216, 44};
uint32_t conectadaEn = 0;

void drawConectando() {
  lienzo::fillRect(0, 0, LCD_W, LCD_H, C_BG);
  drawLogo(LOGO_Y);
  String nombre = lienzo::recortar(F_TITULO, redElegida, LCD_W - 24);
  switch (red::resultado()) {
    case red::RES_PENDIENTE:
      lienzo::textoCentrado(F_TEXTO, "Conectando a", LCD_W / 2, 140, C_MUTED);
      lienzo::textoCentrado(F_TITULO, nombre, LCD_W / 2, 168, C_TEXT);
      for (int i = 0; i < 3; i++) lienzo::fillCircle(LCD_W / 2 - 16 + i * 16, 196, 4, i == puntos ? C_TEXT : C_BORDER);
      break;
    case red::RES_OK:
      lienzo::textoCentrado(F_TITULO, "¡Conectado!", LCD_W / 2, 146, C_OK);
      lienzo::textoCentrado(F_TEXTO, nombre, LCD_W / 2, 174, C_TEXT);
      lienzo::textoCentrado(F_ETIQUETA, red::ip(), LCD_W / 2, 196, C_MUTED);
      break;
    case red::RES_FALLO:
      lienzo::textoCentrado(F_TITULO, "No se pudo conectar", LCD_W / 2, 120, C_TEXT);
      lienzo::textoCentrado(F_TEXTO, red::motivoFallo(), LCD_W / 2, 148, C_ERROR);
      lienzo::textoCentrado(F_ETIQUETA, nombre, LCD_W / 2, 172, C_MUTED);
      boton(BTN_REINTENTAR, redAbierta ? "Reintentar" : "Corregir la clave", true);
      boton(BTN_OTRA_RED, "Elegir otra red", false);
      break;
  }
}

void tickConectando(uint32_t now) {
  static red::Resultado antes = red::RES_PENDIENTE;
  red::Resultado r = red::resultado();
  if (r != antes) {
    antes = r;
    if (r == red::RES_OK) conectadaEn = now;
    repintar = true;
  }
  if (r == red::RES_PENDIENTE && pasaron(puntosEn, 300, now)) {
    puntosEn = now;
    puntos = (puntos + 1) % 3;
    repintar = true;
  }
  if (r == red::RES_OK && pasaron(conectadaEn, 2000, now)) {
    salirDeRedes();
    return;
  }
  if (repintar) {
    repintar = false;
    drawConectando();
    flushAll();
  }
}

void conectandoArriba() {
  if (red::resultado() != red::RES_FALLO || dedo.usado || dedo.movido > TOQUE_HOLGURA) return;
  if (BTN_REINTENTAR.contiene(dedo.x0, dedo.y0)) {
    if (redAbierta) {
      red::conectar(redElegida, "");
      repintar = true;
    } else {
      mensajeClave = red::motivoFallo();  // la clave que escribió sigue ahí para corregirla
      colorMensaje = C_ERROR;
      goTo(SCR_CLAVE);
    }
  } else if (BTN_OTRA_RED.contiene(dedo.x0, dedo.y0)) {
    abrirRedes();
  }
}

// ---------- Máquina de pantallas ----------

bool logTactil = false;

void goTo(Screen s) {
  screen = s;
  repintar = true;
  if (s == SCR_CEDULA) {
    repintar = false;
    drawCedula();
  } else if (s == SCR_CONFIRMA) {
    repintar = false;
    drawConfirma();
  }
}

void tickTactil() {
  int x, y;
  bool abajo = tactil::leer(x, y);
  if (abajo && logTactil) Serial.printf("[tactil] crudo=%d,%d pantalla=%d,%d\n", tactil::rawX, tactil::rawY, x, y);
  if (abajo && !dedo.abajo) {
    dedo = {true, x, y, x, y, 0, false};
    switch (screen) {
      case SCR_CEDULA: cedulaAbajo(); break;
      case SCR_REDES: redesAbajo(); break;
      case SCR_CLAVE: claveAbajo(); break;
      default: break;
    }
  } else if (abajo) {
    dedo.x = x;
    dedo.y = y;
    dedo.movido = max(dedo.movido, max(abs(x - dedo.x0), abs(y - dedo.y0)));
    if (screen == SCR_REDES) redesMovio();
    else if (screen == SCR_CLAVE) claveMovio();
  } else if (dedo.abajo) {
    dedo.abajo = false;
    switch (screen) {
      case SCR_CEDULA: cedulaArriba(); break;
      case SCR_CONFIRMA: confirmaArriba(); break;
      case SCR_REDES: redesArriba(); break;
      case SCR_CLAVE: claveArriba(); break;
      case SCR_CONECTANDO: conectandoArriba(); break;
    }
  }
}

// ---------- Pruebas por serie ----------

bool hayTactil = false, hayAudio = false;
bool medidor = false;
uint32_t ultimoMedidor = 0;

void escanearI2C() {
  Serial.print("[i2c]");
  for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) Serial.printf(" 0x%02X", a);
  }
  Serial.println();
}

void diagnostico() {
  Serial.printf("[diag] tactil=%d audio=%d mic_gain=%ddB mic_rms=%.0f mic_pico=%d heap=%u psram=%u\n",
                hayTactil, hayAudio, audio::micGain(), audio::micRms(), audio::micPico(),
                ESP.getFreeHeap(), ESP.getFreePsram());
  if (red::conectada())
    Serial.printf("[diag] red=%s ip=%s senal=%d dBm\n", red::ssid().c_str(), red::ip().c_str(), red::rssi());
  else
    Serial.printf("[diag] red=sin conexion guardadas=%d\n", red::hayGuardadas());
  uint32_t t0 = millis();
  flushAll();
  Serial.printf("[diag] refresco completo: %lu ms\n", millis() - t0);
  escanearI2C();
}

// Graba `segundos` y los manda crudos: "#PCM <bytes> <hz>\n" + PCM16 mono + "\n#FIN\n".
void grabarYEnviar(int segundos) {
  size_t total = (size_t)audio::RATE * segundos;
  int16_t *pcm = (int16_t *)ps_malloc(total * 2);
  if (!pcm) {
    Serial.println("[grabar] sin memoria");
    return;
  }
  Serial.printf("[grabar] %d s...\n", segundos);
  audio::clearMic();
  audio::setMicStreaming(true);
  size_t n = 0;
  while (n < total) {
    n += audio::readMic(pcm + n, total - n);
    delay(5);
  }
  audio::setMicStreaming(false);
  Serial.printf("#PCM %u %d\n", (unsigned)(total * 2), audio::RATE);
  Serial.write((const uint8_t *)pcm, total * 2);
  Serial.print("\n#FIN\n");
  free(pcm);
}

// Manda el lienzo tal cual: "#FB <ancho> <alto>\n" + RGB565 (little endian) + "\n#FIN\n".
void enviarCaptura() {
  Serial.printf("#FB %d %d\n", LCD_W, LCD_H);
  Serial.write((const uint8_t *)cv->getFramebuffer(), LCD_W * LCD_H * 2);
  Serial.print("\n#FIN\n");
}

void tono(int hz, int ms) {
  size_t n = (size_t)audio::RATE * ms / 1000;
  int16_t *pcm = (int16_t *)ps_malloc(n * 2);
  if (!pcm) return;
  for (size_t i = 0; i < n; i++) pcm[i] = (int16_t)(8000 * sinf(2 * PI * hz * i / audio::RATE));
  audio::play(pcm, n);
  free(pcm);
}

void tickSerie() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '?') diagnostico();
    else if (c == 'm') medidor = !medidor;
    else if (c == 'g') grabarYEnviar(5);
    else if (c == 'G') grabarYEnviar(15);
    else if (c == '+' || c == '-') {
      audio::setMicGain(audio::micGain() + (c == '+' ? 6 : -6));
      Serial.printf("[mic] ganancia %d dB\n", audio::micGain());
    } else if (c == 't') tono(1000, 400);
    else if (c == 'f') enviarCaptura();
    else if (c == 'r') {
      logTactil = !logTactil;
      Serial.printf("[tactil] registro %s\n", logTactil ? "encendido" : "apagado");
    } else if (c == 'l') {
      static int paso = 0;
      static const uint8_t COLORES[4][3] = {{40, 0, 0}, {0, 40, 0}, {0, 0, 40}, {0, 0, 0}};
      rgbLedWrite(LED_RGB, COLORES[paso][0], COLORES[paso][1], COLORES[paso][2]);
      paso = (paso + 1) % 4;
    }
  }
  if (medidor && millis() - ultimoMedidor >= 250) {
    ultimoMedidor = millis();
    Serial.printf("[mic] rms=%.0f pico=%d\n", audio::micRms(), audio::micPico());
  }
}

// ---------- Arranque ----------

void setup() {
  Serial.begin(115200);
  pinMode(LCD_BL, OUTPUT);
  digitalWrite(LCD_BL, HIGH);
  rgbLedWrite(LED_RGB, 0, 0, 0);

  if (!cv->begin(SPI_HZ)) Serial.println("Fallo al iniciar la pantalla o al reservar el lienzo");
  lienzo::begin(cv->getFramebuffer(), LCD_W, LCD_H);
  armarTeclado();

  Wire.begin(I2C_SDA, I2C_SCL, 400000);
  hayTactil = tactil::begin();
  hayAudio = audio::begin();
  red::begin();
  Serial.printf("[arranque] tactil=%d audio=%d\n", hayTactil, hayAudio);

  // Sin ninguna red guardada no hay nada que hacer: directo a elegir el WiFi.
  if (red::hayGuardadas()) goTo(SCR_CEDULA);
  else abrirRedes();
}

void loop() {
  uint32_t now = millis();
  tickSerie();
  red::tick(now);
  tickTactil();
  switch (screen) {
    case SCR_CEDULA: tickCedula(now); break;
    case SCR_REDES: tickRedes(now); break;
    case SCR_CLAVE: tickClave(now); break;
    case SCR_CONECTANDO: tickConectando(now); break;
    default: break;
  }
  delay(10);
}
