#!/usr/bin/env python3
"""Convierte el logo negro de la app (frontend/public/logoNegro.png) en un arreglo
RGB565 para la pantalla. La transparencia se mezcla con el fondo blanco de la
interfaz: la pantalla no tiene canal alfa.

Uso (desde dispositivo/):  python3 tools/logo_a_c.py [ancho]   (por defecto 140)
"""
import sys
from pathlib import Path
from PIL import Image

AQUI = Path(__file__).resolve().parent
ORIGEN = AQUI.parent.parent / "frontend" / "public" / "logoNegro.png"
DESTINO = AQUI.parent / "asistente" / "logo.h"
FONDO = (255, 255, 255)

ancho = int(sys.argv[1]) if len(sys.argv) > 1 else 140
img = Image.open(ORIGEN).convert("RGBA")
alto = round(img.height * ancho / img.width)
img = img.resize((ancho, alto), Image.LANCZOS)

plano = Image.new("RGB", img.size, FONDO)
plano.paste(img, mask=img.getchannel("A"))

crudo = plano.tobytes()
valores = []
for i in range(0, len(crudo), 3):
    r, g, b = crudo[i], crudo[i + 1], crudo[i + 2]
    valores.append(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3))

filas = [", ".join(f"0x{v:04X}" for v in valores[i:i + 12]) for i in range(0, len(valores), 12)]
DESTINO.write_text(
    "// Generado por tools/logo_a_c.py desde frontend/public/logoNegro.png. No editar a mano.\n"
    "#pragma once\n#include <stdint.h>\n\n"
    f"const int LOGO_W = {ancho}, LOGO_H = {alto};\n"
    f"const uint16_t LOGO[{len(valores)}] = {{\n  " + ",\n  ".join(filas) + "\n};\n"
)
print(f"{DESTINO.relative_to(AQUI.parent)}: {ancho}x{alto}, {len(valores) * 2} bytes")
