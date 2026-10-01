#include "tactil.h"
#include <Wire.h>
#include "pines.h"

namespace tactil {

static const uint8_t DIR = 0x38;
static const uint8_t REG_ESTADO = 0x02;  // nº de dedos; siguen XH, XL, YH, YL
static const uint8_t REG_CHIP = 0xA3;    // 0x64 en el FT6336G

// Orientación: se ajusta al calibrar con la placa en la mano.
static const bool INVERTIR_X = false;
static const bool INVERTIR_Y = false;

int rawX = -1, rawY = -1;

static bool leerRegs(uint8_t reg, uint8_t *dst, size_t n) {
  Wire.beginTransmission(DIR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(DIR, (uint8_t)n) != n) return false;
  for (size_t i = 0; i < n; i++) dst[i] = Wire.read();
  return true;
}

bool begin() {
  pinMode(TP_RST, OUTPUT);
  digitalWrite(TP_RST, LOW);
  delay(10);
  digitalWrite(TP_RST, HIGH);
  delay(300);  // el chip tarda en despertar
  pinMode(TP_INT, INPUT_PULLUP);
  uint8_t id = 0;
  return leerRegs(REG_CHIP, &id, 1);
}

bool leer(int &x, int &y) {
  uint8_t d[5];
  if (!leerRegs(REG_ESTADO, d, sizeof d)) return false;
  if ((d[0] & 0x0F) == 0) return false;
  rawX = ((d[1] & 0x0F) << 8) | d[2];
  rawY = ((d[3] & 0x0F) << 8) | d[4];
  x = INVERTIR_X ? LCD_W - 1 - rawX : rawX;
  y = INVERTIR_Y ? LCD_H - 1 - rawY : rawY;
  x = constrain(x, 0, LCD_W - 1);
  y = constrain(y, 0, LCD_H - 1);
  return true;
}

}  // namespace tactil
