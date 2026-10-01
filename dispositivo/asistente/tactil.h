// Táctil capacitivo FT6336G (I2C 0x38). Se lee por sondeo; el pin de
// interrupción no hace falta para una pantalla de botones.
#pragma once
#include <Arduino.h>

namespace tactil {

// Reinicia el chip y comprueba que conteste. Wire ya debe estar iniciado.
bool begin();
// true si hay un dedo; x, y en píxeles de la pantalla (vertical, 240x320).
// rawX, rawY quedan con lo que mandó el chip (para calibrar).
bool leer(int &x, int &y);
extern int rawX, rawY;

}  // namespace tactil
