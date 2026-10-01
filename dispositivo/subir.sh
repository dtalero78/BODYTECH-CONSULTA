#!/bin/zsh
# Compila y sube el firmware del asistente a la ES3C28P.  Uso: ./subir.sh [puerto]
# Solo sube si la placa conectada es la ES3C28P (por su MAC): Pixel sale con el
# mismo nombre de puerto y este firmware la dejaría sin el suyo.
set -e
cd "$(dirname "$0")"
SKETCH=asistente

# El core: la misma version que Pixel (probada con el ESP32-S3).
CORE_VERSION=3.3.11
ARDUINOJSON_VERSION=7.4.3
GFX_URL=https://github.com/moononournation/Arduino_GFX
GFX_SHA=2685a776495be1f9eaf8c572cf876469bcc56585  # v1.6.8 (la 1.6.4 no compila con el core 3.3)
BOARDS_URL=https://espressif.github.io/arduino-esp32/package_esp32_index.json
FQBN="esp32:esp32:esp32s3:FlashSize=16M,PartitionScheme=app3M_fat9M_16MB,CDCOnBoot=cdc,PSRAM=opi"
MAC_ESPERADA=${MAC_ESPERADA:-14:c1:9f:d1:ce:cc}

command -v arduino-cli >/dev/null || { echo "Falta arduino-cli. Instalalo con: brew install arduino-cli"; exit 1; }

if ! arduino-cli core list 2>/dev/null | grep -qE "^esp32:esp32 +$CORE_VERSION "; then
  echo "Instalando el core esp32 $CORE_VERSION..."
  arduino-cli core update-index --additional-urls "$BOARDS_URL"
  arduino-cli core install "esp32:esp32@$CORE_VERSION" --additional-urls "$BOARDS_URL"
fi

if ! arduino-cli lib list 2>/dev/null | grep -qE "^ArduinoJson +$ARDUINOJSON_VERSION "; then
  echo "Instalando ArduinoJson $ARDUINOJSON_VERSION..."
  arduino-cli lib install "ArduinoJson@$ARDUINOJSON_VERSION"
fi

# La libreria de pantalla va en vendor/, fijada, y no en las librerias del
# usuario: alli chocaria con la copia que usa Pixel.
if [[ "$(git -C vendor/Arduino_GFX rev-parse HEAD 2>/dev/null)" != "$GFX_SHA" ]]; then
  echo "Descargando Arduino_GFX..."
  rm -rf vendor/Arduino_GFX
  mkdir -p vendor
  git init -q vendor/Arduino_GFX
  git -C vendor/Arduino_GFX remote add origin "$GFX_URL"
  git -C vendor/Arduino_GFX fetch -q --depth 1 origin "$GFX_SHA"
  git -C vendor/Arduino_GFX checkout -q FETCH_HEAD
fi

[[ -f "$SKETCH/logo.h" ]] || python3 tools/logo_a_c.py
[[ -f "$SKETCH/fuentes.h" ]] || python3 tools/fuente_a_c.py

PORT=${1:-$(ls /dev/cu.usbmodem* 2>/dev/null | head -1)}
[[ -z "$PORT" ]] && { echo "No encuentro la placa. Conectala con un cable de datos."; exit 1; }

arduino-cli compile --fqbn "$FQBN" --libraries vendor --build-path build "$SKETCH"

ESPTOOL=$(ls -d ~/Library/Arduino15/packages/esp32/tools/esptool_py/*/ | tail -1)esptool
MAC=$("$ESPTOOL" --port "$PORT" read-mac 2>/dev/null | awk '/^MAC:/ {print tolower($2); exit}')
if [[ "$MAC" != "$MAC_ESPERADA" ]]; then
  echo "En $PORT hay otra placa (MAC ${MAC:-desconocida}), no la ES3C28P ($MAC_ESPERADA). No subo nada."
  echo "Si es otra ES3C28P: MAC_ESPERADA=<su mac> ./subir.sh"
  exit 1
fi

arduino-cli upload --fqbn "$FQBN" -p "$PORT" --input-dir build "$SKETCH"
