# Asistente de consulta presencial (dispositivo)

Firmware de una pantalla de escritorio para el médico en la consulta presencial
(UMV presencial y médico corporativo): se escribe la cédula del paciente, se abre
la consulta guiada y lo que se habla se transcribe a la historia clínica de esta app.

Placa: **LCDWIKI ES3C28P** (ESP32-S3R8, pantalla IPS 2,8" 240x320 ILI9341V, táctil
FT6336G, códec ES8311 con micrófono y amplificador). Pines en `asistente/pines.h`.

## Compilar y subir

```
cd dispositivo && ./subir.sh
```

Instala lo que falte (core esp32 3.3.11, U8g2, Arduino_GFX 1.6.8 en `vendor/`) y
**solo sube si la placa conectada tiene la MAC de la ES3C28P**: Pixel sale con el
mismo nombre de puerto. El firmware de fábrica quedó en `respaldo/` (fuera de git).

## Probar por el USB

`~/.platformio/penv/bin/python tools/placa.py "<letras>"` abre el puerto sin
reiniciar la placa. Letras: `?` diagnóstico, `m` medidor del micrófono, `g` / `G`
graban 5 / 15 s a `grabaciones/` (fuera de git), `+` / `-` ganancia del micrófono,
`t` tono por el parlante, `l` LED, `r` coordenadas crudas del táctil, `f` captura
de la pantalla a `grabaciones/pantalla_NN.png`.

Para probar el micrófono con la voz del Mac, el sonido tiene que salir por el
parlante del Mac: con audífonos puestos la placa solo oye la habitación.

## Estado

- Hecho (placa): pantalla con el logo negro de la app y letras Figtree suavizadas,
  teclado de la cédula, táctil, códec. Arranque del panel con la secuencia del
  fabricante (`asistente/ili9341v.h`). I2C comprobado (0x18 códec, 0x38 táctil).
- Hecho (servidor): `/api/dispositivo` en el backend (emparejar, consulta por
  cédula, guía, transcripción por frases, borrador y cierre). Ver la sección
  "Asistente de escritorio" del CLAUDE.md del repo. Probado de punta a punta
  contra la base con la cuenta de prueba (y limpiado).
- Falta (placa): WiFi, la pantalla del código para emparejar, la consulta guiada,
  la transcripción en vivo y la revisión de lo que llenó la IA.
