#include "red.h"
#include <WiFi.h>
#include <esp_wifi.h>
#include <Preferences.h>
#include <algorithm>

namespace red {

const int MAX_REDES = 5;
const uint32_t CONECTAR_MS = 20000;
const uint32_t REINTENTO_MS = 30000;  // sin WiFi: cada cuánto vuelve a buscar las guardadas
const int PASADAS = 3;

struct Guardada {
  String ssid, clave;
};

enum Estado { APAGADA, BUSCANDO_GUARDADAS, CONECTANDO, CONECTADA, CAIDA };

static Preferences prefs;
static std::vector<Guardada> guardadas;
static Estado estado = APAGADA;
static String conSsid, conClave;
static bool porPersona = false;      // lo pidió desde el teclado: hay que mostrarle el resultado
static bool enConfiguracion = false;  // la persona está en las pantallas de WiFi: no reintentar solo
static uint32_t inicioConexion = 0, caidaEn = 0;
static volatile int motivoDesconexion = 0;
static Resultado res = RES_PENDIENTE;
static String fallo;

static std::vector<Red> lista;
static bool primeraPasada = false, pasadasExtra = false, fallaBusqueda = false, cambio = false;
static int pasada = 0;

// ---------- Redes guardadas ----------

static void escribirGuardadas() {
  for (int i = 0; i < MAX_REDES; i++) {
    String ks = "ssid" + String(i), kp = "pass" + String(i);
    if (i < (int)guardadas.size()) {
      prefs.putString(ks.c_str(), guardadas[i].ssid);
      prefs.putString(kp.c_str(), guardadas[i].clave);
    } else if (prefs.isKey(ks.c_str())) {
      prefs.remove(ks.c_str());
      prefs.remove(kp.c_str());
    }
  }
}

static void leerGuardadas() {
  guardadas.clear();
  for (int i = 0; i < MAX_REDES; i++) {
    String ks = "ssid" + String(i), kp = "pass" + String(i);
    if (!prefs.isKey(ks.c_str())) break;
    guardadas.push_back({prefs.getString(ks.c_str()), prefs.getString(kp.c_str())});
  }
}

static const Guardada *buscarGuardada(const String &s) {
  for (const Guardada &g : guardadas)
    if (g.ssid == s) return &g;
  return nullptr;
}

// La que acaba de conectar pasa a ser la primera; si ya hay 5, sale la más vieja.
static void recordar(const String &s, const String &c) {
  if (!guardadas.empty() && guardadas[0].ssid == s && guardadas[0].clave == c) return;
  guardadas.erase(std::remove_if(guardadas.begin(), guardadas.end(), [&](const Guardada &g) { return g.ssid == s; }),
                  guardadas.end());
  guardadas.insert(guardadas.begin(), {s, c});
  if ((int)guardadas.size() > MAX_REDES) guardadas.resize(MAX_REDES);
  escribirGuardadas();
}

bool hayGuardadas() { return !guardadas.empty(); }
bool guardada(const String &s) { return buscarGuardada(s) != nullptr; }

String claveGuardada(const String &s) {
  const Guardada *g = buscarGuardada(s);
  return g ? g->clave : String();
}

// ---------- Conexión ----------

static bool fallaDeClave(int r) {
  return r == WIFI_REASON_AUTH_FAIL || r == WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT || r == WIFI_REASON_HANDSHAKE_TIMEOUT;
}

static bool noEncontrada(int r) {
  return r == WIFI_REASON_NO_AP_FOUND || r == WIFI_REASON_NO_AP_FOUND_W_COMPATIBLE_SECURITY ||
         r == WIFI_REASON_NO_AP_FOUND_IN_AUTHMODE_THRESHOLD;
}

static void empezar(const String &s, const String &c, bool persona) {
  conSsid = s;
  conClave = c;
  porPersona = persona;
  if (persona) res = RES_PENDIENTE;
  WiFi.disconnect();
  motivoDesconexion = 0;
  WiFi.begin(s.c_str(), c.length() ? c.c_str() : nullptr);
  estado = CONECTANDO;
  inicioConexion = millis();
  Serial.printf("[red] conectando a %s\n", s.c_str());
}

// Sin conexión: mira cuáles guardadas están cerca y entra a la de mejor señal.
static void conectarSola() {
  if (guardadas.empty()) return;
  if (guardadas.size() > 1) {
    WiFi.disconnect();
    if (WiFi.scanNetworks(true) != WIFI_SCAN_FAILED) {
      estado = BUSCANDO_GUARDADAS;
      return;
    }
  }
  empezar(guardadas[0].ssid, guardadas[0].clave, false);
}

static void terminarBusquedaGuardadas(int n) {
  int mejor = 0;
  int32_t mejorRssi = INT32_MIN;
  for (int i = 0; i < n; i++) {
    const Guardada *g = buscarGuardada(WiFi.SSID(i));
    if (g && WiFi.RSSI(i) > mejorRssi) {
      mejor = g - guardadas.data();
      mejorRssi = WiFi.RSSI(i);
    }
  }
  WiFi.scanDelete();
  Guardada g = guardadas[mejor];
  empezar(g.ssid, g.clave, false);
}

static void alConectar() {
  Serial.printf("[red] conectada a %s, IP %s, señal %d dBm\n", conSsid.c_str(), WiFi.localIP().toString().c_str(),
                WiFi.RSSI());
  recordar(conSsid, conClave);  // solo se guarda lo que de verdad conectó
  if (porPersona) {
    porPersona = false;
    res = RES_OK;
  }
}

static void alFallar(int motivo) {
  WiFi.disconnect();
  estado = APAGADA;
  porPersona = false;
  res = RES_FALLO;
  fallo = fallaDeClave(motivo) ? "La clave parece incorrecta"
        : noEncontrada(motivo) ? "No encuentro esa red"
                               : "La red no respondió";
  Serial.printf("[red] no se pudo conectar a %s (motivo %d)\n", conSsid.c_str(), motivo);
}

void begin() {
  prefs.begin("wifi", false);
  leerGuardadas();
  WiFi.persistent(false);  // la clave la guardamos nosotros, no el driver
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);    // con ahorro de energía cada respuesta llega tarde
  WiFi.setAutoReconnect(true);
  WiFi.onEvent([](arduino_event_id_t, arduino_event_info_t info) {
    motivoDesconexion = info.wifi_sta_disconnected.reason;
  }, ARDUINO_EVENT_WIFI_STA_DISCONNECTED);
  Serial.printf("[red] %d redes guardadas\n", (int)guardadas.size());
  conectarSola();
}

void conectar(const String &s, const String &c) {
  enConfiguracion = true;
  empezar(s, c, true);
}

Resultado resultado() { return res; }
String motivoFallo() { return fallo; }
bool conectada() { return WiFi.status() == WL_CONNECTED; }
String ssid() { return conSsid; }
String ip() { return WiFi.localIP().toString(); }
int32_t rssi() { return WiFi.RSSI(); }
int barras(int32_t r) { return r > -55 ? 4 : r > -67 ? 3 : r > -78 ? 2 : 1; }

void salirDeConfiguracion() {
  enConfiguracion = false;
  if (WiFi.scanComplete() == WIFI_SCAN_RUNNING) esp_wifi_scan_stop();
  WiFi.scanDelete();
  primeraPasada = pasadasExtra = false;
  if (!conectada() && estado != CONECTANDO) conectarSola();
}

// ---------- Búsqueda para la lista ----------

static bool pasadaNueva() {
  static const bool pasiva[PASADAS] = {false, true, false};
  static const uint16_t msPorCanal[PASADAS] = {300, 400, 600};
  return WiFi.scanNetworks(true, false, pasiva[pasada], msPorCanal[pasada]) != WIFI_SCAN_FAILED;
}

static bool esEmpresarial(wifi_auth_mode_t a) {
  return a == WIFI_AUTH_WPA2_ENTERPRISE || a == WIFI_AUTH_WPA3_ENTERPRISE || a == WIFI_AUTH_WPA2_WPA3_ENTERPRISE;
}

// Suma lo que encontró una pasada. Con la lista ya en pantalla, las nuevas van
// al final para que nada se mueva debajo del dedo.
static void sumar(int n, bool ordenar) {
  for (int i = 0; i < n; i++) {
    String s = WiFi.SSID(i);
    wifi_auth_mode_t auth = WiFi.encryptionType(i);
    if (s.isEmpty() || esEmpresarial(auth)) continue;  // ocultas, o piden usuario además de clave
    int32_t r = WiFi.RSSI(i);
    auto it = std::find_if(lista.begin(), lista.end(), [&](const Red &x) { return x.ssid == s; });
    if (it != lista.end()) {  // la misma red desde varios routers: queda la señal más fuerte
      it->rssi = max(it->rssi, r);
      continue;
    }
    lista.push_back({s, r, auth == WIFI_AUTH_OPEN || auth == WIFI_AUTH_OWE});
  }
  if (ordenar) std::sort(lista.begin(), lista.end(), [](const Red &a, const Red &b) { return a.rssi > b.rssi; });
}

void buscar() {
  enConfiguracion = true;
  // No se puede buscar mientras intenta conectarse; conectada, sí.
  if (!conectada()) {
    WiFi.disconnect();
    estado = APAGADA;
  }
  if (WiFi.scanComplete() == WIFI_SCAN_RUNNING) esp_wifi_scan_stop();
  WiFi.scanDelete();
  lista.clear();
  pasada = 0;
  fallaBusqueda = !pasadaNueva();
  primeraPasada = !fallaBusqueda;
  pasadasExtra = false;
  cambio = true;
}

bool buscando() { return primeraPasada; }
bool refinando() { return pasadasExtra; }
bool busquedaFallo() { return fallaBusqueda; }
const std::vector<Red> &redes() { return lista; }

bool listaCambio() {
  bool c = cambio;
  cambio = false;
  return c;
}

// ---------- El ciclo ----------

static bool pasaron(uint32_t desde, uint32_t ms, uint32_t now) { return (int32_t)(now - desde) >= (int32_t)ms; }

void tick(uint32_t now) {
  if (primeraPasada || pasadasExtra) {
    int n = WiFi.scanComplete();
    if (n >= 0 || n == WIFI_SCAN_FAILED) {
      sumar(max(n, 0), primeraPasada);
      WiFi.scanDelete();
      pasada++;
      bool mas = pasada < PASADAS && pasadaNueva();
      if (!mas && lista.empty() && n == WIFI_SCAN_FAILED) fallaBusqueda = true;
      primeraPasada = mas && lista.empty();
      pasadasExtra = mas && !lista.empty();
      cambio = true;
    }
    return;  // mientras busca para la lista no se toca la conexión
  }

  bool arriba = conectada();
  switch (estado) {
    case BUSCANDO_GUARDADAS: {
      int n = WiFi.scanComplete();
      if (n >= 0 || n == WIFI_SCAN_FAILED) terminarBusquedaGuardadas(max(n, 0));
      break;
    }
    case CONECTANDO:
      if (arriba) {
        estado = CONECTADA;
        alConectar();
      } else if (porPersona) {
        int m = motivoDesconexion;
        if (fallaDeClave(m) || pasaron(inicioConexion, CONECTAR_MS, now)) alFallar(m);
      } else if (pasaron(inicioConexion, CONECTAR_MS, now)) {
        estado = CAIDA;  // la guardada no aparece; el ESP32 sigue intentando solo
        caidaEn = now;
      }
      break;
    case CONECTADA:
      if (!arriba) {
        estado = CAIDA;
        caidaEn = now;
        Serial.println("[red] se cayó el WiFi, reintentando");
      }
      break;
    case CAIDA:
      if (arriba) {
        estado = CONECTADA;
        alConectar();
      } else if (guardadas.size() > 1 && !enConfiguracion && pasaron(caidaEn, REINTENTO_MS, now)) {
        conectarSola();  // quizá ahora está cerca otra de las guardadas
      }
      break;
    case APAGADA:
      break;
  }
}

}  // namespace red
