#include "servidor.h"
#include <HTTPClient.h>
#include <NetworkClientSecure.h>
#include <Preferences.h>
#include <ArduinoJson.h>

#if __has_include("secretos.h")
#include "secretos.h"  // para probar contra el Mac: #define SERVIDOR_URL "http://192.168.x.x:3100"
#endif
#ifndef SERVIDOR_URL
#define SERVIDOR_URL "https://bodytech.app"
#endif

// La lista de autoridades de certificación que trae el core (la misma de Pixel).
extern "C" const uint8_t crt_bundle_start[] asm("_binary_x509_crt_bundle_start");
extern "C" const uint8_t crt_bundle_end[] asm("_binary_x509_crt_bundle_end");

namespace servidor {

const uint32_t TIMEOUT_MS = 20000;
const uint32_t VIGENCIA_CODIGO_MS = 10 * 60 * 1000;  // la misma del servidor

struct Pedido {
  Tipo tipo;
  String cuerpo;
};

static Preferences prefs;
static SemaphoreHandle_t lock;
static QueueHandle_t pedidos;
static String token, nombreMedico;
static String codigo, mostrar, secreto;
static uint32_t venceEn = 0;
static volatile bool enCurso = false;
static bool hayRespuesta = false;
static Respuesta respuesta;

String url() { return SERVIDOR_URL; }

bool vinculado() {
  xSemaphoreTake(lock, portMAX_DELAY);
  bool v = token.length() > 0;
  xSemaphoreGive(lock);
  return v;
}

String medico() {
  xSemaphoreTake(lock, portMAX_DELAY);
  String m = nombreMedico;
  xSemaphoreGive(lock);
  return m;
}

void olvidar() {
  xSemaphoreTake(lock, portMAX_DELAY);
  token = "";
  nombreMedico = "";
  prefs.remove("token");
  prefs.remove("medico");
  xSemaphoreGive(lock);
  Serial.println("[servidor] token borrado: hay que vincular otra vez");
}

String codigoParaMostrar() {
  xSemaphoreTake(lock, portMAX_DELAY);
  String m = mostrar;
  xSemaphoreGive(lock);
  return m;
}

uint32_t codigoVenceEn() { return venceEn; }

// Un pedido HTTP con JSON. Devuelve el código y deja el cuerpo en `cuerpo`.
static int pedir(const char *metodo, const String &ruta, const String &json, const String &tok, String &cuerpo) {
  String destino = String(SERVIDOR_URL) + "/api/dispositivo" + ruta;
  bool tlsActivo = destino.startsWith("https://");
  NetworkClientSecure tls;
  NetworkClient plano;
  if (tlsActivo) tls.setCACertBundle(crt_bundle_start, crt_bundle_end - crt_bundle_start);
  HTTPClient http;
  http.setTimeout(TIMEOUT_MS);
  http.setConnectTimeout(10000);
  bool ok = tlsActivo ? http.begin(tls, destino) : http.begin(plano, destino);
  if (!ok) return -1;
  http.addHeader("Content-Type", "application/json");
  if (tok.length()) http.addHeader("Authorization", "Bearer " + tok);
  int code = http.sendRequest(metodo, json);
  cuerpo = code > 0 ? http.getString() : "";
  http.end();
  return code;
}

static void atender(const Pedido &p, Respuesta &r) {
  r.tipo = p.tipo;
  String tok;
  if (p.tipo == P_CONSULTA) {
    xSemaphoreTake(lock, portMAX_DELAY);
    tok = token;
    xSemaphoreGive(lock);
  }
  const char *ruta = p.tipo == P_EMPAREJAR ? "/emparejar" : p.tipo == P_RECLAMAR ? "/emparejar/reclamar" : "/consulta";
  String cuerpo;
  uint32_t t0 = millis();
  r.http = pedir("POST", ruta, p.cuerpo, tok, cuerpo);
  Serial.printf("[servidor] %s → %d (%lu ms)\n", ruta, r.http, (unsigned long)(millis() - t0));
  if (r.http <= 0) {
    r.mensaje = "No pude conectar con el servidor";
    return;
  }
  JsonDocument doc;
  if (deserializeJson(doc, cuerpo)) {
    r.mensaje = "Respuesta inesperada del servidor";
    return;
  }
  r.error = doc["error"] | "";
  r.mensaje = doc["message"] | "";
  serializeJson(doc["data"], r.datos);

  if (r.http != 200) return;
  if (p.tipo == P_EMPAREJAR) {
    xSemaphoreTake(lock, portMAX_DELAY);
    codigo = doc["data"]["codigo"] | "";
    mostrar = doc["data"]["mostrar"] | "";
    secreto = doc["data"]["secreto"] | "";
    venceEn = millis() + VIGENCIA_CODIGO_MS - 15000;  // un margen: mejor pedir otro antes que mostrar uno vencido
    xSemaphoreGive(lock);
  } else if (p.tipo == P_RECLAMAR && String(doc["data"]["estado"] | "") == "listo") {
    xSemaphoreTake(lock, portMAX_DELAY);
    token = doc["data"]["token"] | "";
    nombreMedico = doc["data"]["medico"] | "";
    nombreMedico.trim();
    prefs.putString("token", token);
    prefs.putString("medico", nombreMedico);
    codigo = mostrar = secreto = "";
    venceEn = 0;
    xSemaphoreGive(lock);
    Serial.printf("[servidor] vinculado a %s\n", nombreMedico.c_str());
  }
}

static void tarea(void *) {
  Pedido *p;
  for (;;) {
    if (xQueueReceive(pedidos, &p, portMAX_DELAY) != pdTRUE) continue;
    Respuesta r;
    atender(*p, r);
    delete p;
    // Un token que el servidor ya no reconoce (lo desvincularon) no sirve más.
    if (r.http == 401 && r.error == "DISPOSITIVO_INVALIDO") olvidar();
    xSemaphoreTake(lock, portMAX_DELAY);
    respuesta = r;
    hayRespuesta = true;
    enCurso = false;
    xSemaphoreGive(lock);
  }
}

void begin() {
  lock = xSemaphoreCreateMutex();
  pedidos = xQueueCreate(2, sizeof(Pedido *));
  prefs.begin("dispositivo", false);
  token = prefs.getString("token", "");
  nombreMedico = prefs.getString("medico", "");
  Serial.printf("[servidor] %s, %s\n", SERVIDOR_URL, token.length() ? ("vinculado a " + nombreMedico).c_str() : "sin vincular");
  // Pila grande: TLS + JSON de la respuesta.
  xTaskCreatePinnedToCore(tarea, "servidor", 16384, nullptr, 2, nullptr, 0);
}

bool ocupado() { return enCurso; }

static void encolar(Tipo t, const String &cuerpo) {
  enCurso = true;
  Pedido *p = new Pedido{t, cuerpo};
  if (xQueueSend(pedidos, &p, 0) != pdTRUE) {
    delete p;
    enCurso = false;
  }
}

void emparejar() { encolar(P_EMPAREJAR, "{}"); }

void reclamar() {
  JsonDocument doc;
  xSemaphoreTake(lock, portMAX_DELAY);
  doc["codigo"] = codigo;
  doc["secreto"] = secreto;
  xSemaphoreGive(lock);
  String cuerpo;
  serializeJson(doc, cuerpo);
  encolar(P_RECLAMAR, cuerpo);
}

void consulta(const String &cedula) {
  JsonDocument doc;
  doc["cedula"] = cedula;
  String cuerpo;
  serializeJson(doc, cuerpo);
  encolar(P_CONSULTA, cuerpo);
}

bool listo(Respuesta &r) {
  xSemaphoreTake(lock, portMAX_DELAY);
  bool h = hayRespuesta;
  if (h) {
    r = respuesta;
    hayRespuesta = false;
  }
  xSemaphoreGive(lock);
  return h;
}

}  // namespace servidor
