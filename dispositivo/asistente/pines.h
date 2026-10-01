// Pines de la LCDWIKI ES3C28P (ESP32-S3R8, pantalla IPS 2,8" ILI9341V).
// Fuente: ficha de lcdwiki + notas de hardware del proyecto de ESPHome para esta
// placa (el I2C de la ficha está al revés: SDA es el 16 y SCL el 15).
#pragma once

// Pantalla (SPI). Su reset va al reset del chip: no tiene pin propio.
#define LCD_CS 10
#define LCD_DC 46
#define LCD_SCK 12
#define LCD_MOSI 11
#define LCD_MISO 13
#define LCD_BL 45  // luz de fondo: alto = encendida
#define LCD_W 240
#define LCD_H 320

// I2C compartido: táctil FT6336G (0x38) y códec ES8311 (0x18).
#define I2C_SDA 16
#define I2C_SCL 15
#define TP_INT 17
#define TP_RST 18

// Audio: códec ES8311 por I2S y amplificador FM8002E.
#define I2S_MCK 4
#define I2S_BCK 5
#define I2S_WS 7
#define I2S_DO 8  // del ESP32 al códec (parlante)
#define I2S_DI 6  // del códec al ESP32 (micrófono)
#define PA_EN 1   // alto = amplificador encendido

#define LED_RGB 42  // WS2812B
#define BAT_ADC 9   // voltaje de la batería (con divisor)
#define BOTON_BOOT 0
