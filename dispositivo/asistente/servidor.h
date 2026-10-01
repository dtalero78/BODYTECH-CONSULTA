// La conversación con el servidor de Bodytech (/api/dispositivo del backend de
// este repo). Corre en su propia tarea (núcleo 0, con pila para TLS): la
// pantalla encola un pedido y pregunta cuándo terminó, nunca espera la red.
//
// El token de la placa vive en NVS (namespace "dispositivo"). Si el servidor lo
// rechaza (lo desvincularon desde el panel), se borra y hay que vincular otra vez.
#pragma once
#include <Arduino.h>

namespace servidor {

enum Tipo : uint8_t { P_EMPAREJAR, P_RECLAMAR, P_CONSULTA };

struct Respuesta {
  Tipo tipo;
  int http;        // código HTTP; <= 0 si no hubo respuesta (sin red, sin servidor)
  String error;    // "SIN_CITA", "DISPOSITIVO_INVALIDO"…
  String mensaje;  // el texto para el médico que manda el servidor
  String datos;    // `data` de la respuesta, en JSON
};

void begin();
String url();  // a dónde habla (para el diagnóstico)

bool vinculado();
String medico();  // el nombre del médico de la placa
void olvidar();   // borra el token

// El emparejamiento en curso (lo pide P_EMPAREJAR, lo usa P_RECLAMAR).
String codigoParaMostrar();
uint32_t codigoVenceEn();  // millis() en que vence; 0 si no hay código

bool ocupado();
void emparejar();
void reclamar();
void consulta(const String &cedula);

// true una sola vez por pedido, cuando terminó.
bool listo(Respuesta &r);

}  // namespace servidor
