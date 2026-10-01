// La conexión a internet por WiFi. Lógica adaptada de Pixel (ojitos.ino), sin
// las pantallas: las de este dispositivo leen el estado de acá.
//
// - Hasta 5 redes guardadas en NVS (Preferences, namespace "wifi"); la primera
//   es la última que conectó. Solo se guarda una red que de verdad conectó.
// - Al arrancar, y si se cae, entra sola a la guardada con mejor señal.
// - La búsqueda para la lista hace tres pasadas cada vez más lentas: el hotspot
//   de un celular (sobre todo el iPhone) se anuncia poco y una sola se lo salta.
// - La clave nunca sale por el puerto serie.
#pragma once
#include <Arduino.h>
#include <vector>

namespace red {

struct Red {
  String ssid;
  int32_t rssi;
  bool abierta;
};

enum Resultado { RES_PENDIENTE, RES_OK, RES_FALLO };

void begin();
void tick(uint32_t now);

bool conectada();
bool hayGuardadas();
bool guardada(const String &ssid);
String claveGuardada(const String &ssid);  // para que el teclado ya la traiga escrita
String ssid();                             // la red conectada (o la que se intenta)
String ip();
int32_t rssi();
int barras(int32_t rssi);  // 1..4

// La lista de redes cercanas.
void buscar();
bool buscando();       // primera pasada: todavía no hay lista
bool refinando();      // pasadas extra con la lista ya en pantalla
bool busquedaFallo();
bool listaCambio();    // true una vez cada vez que la lista cambió (para repintar)
const std::vector<Red> &redes();

// Conexión pedida por la persona: el resultado se muestra en pantalla.
void conectar(const String &ssid, const String &clave);
Resultado resultado();
String motivoFallo();  // "La clave parece incorrecta", etc.

// La persona salió de la configuración: si no quedó conectada, vuelve a las guardadas.
void salirDeConfiguracion();

}  // namespace red
