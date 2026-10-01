#!/usr/bin/env python3
"""Genera asistente/fuentes.h: las letras de la interfaz con suavizado (4 bits de
alfa por píxel) a partir de las tipografías de la app: Figtree para todo y
JetBrains Mono para la clave del WiFi (ahí 0/O y l/1/I tienen que distinguirse).
Las fuentes de U8g2 son de un bit y en esta pantalla (143 ppp) se ven escalonadas.

Uso (desde dispositivo/):  python3 tools/fuente_a_c.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

AQUI = Path(__file__).resolve().parent
FIGTREE = AQUI / "fuentes" / "Figtree.ttf"
MONO = AQUI / "fuentes" / "JetBrainsMono.ttf"
DESTINO = AQUI.parent / "asistente" / "fuentes.h"

ASCII = "".join(chr(c) for c in range(32, 127))
LATINO = ASCII + "ÁÉÍÓÚÜÑáéíóúüñ¿¡°·–—“”‘’…‹›«»"
CIFRAS = "0123456789 ."
CODIGO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ-"  # el del emparejamiento

# nombre, tipografía, peso, tamaño en px, caracteres
FUENTES = [
    ("F_ETIQUETA", FIGTREE, 500, 14, LATINO),
    ("F_TEXTO", FIGTREE, 400, 16, LATINO),
    ("F_TITULO", FIGTREE, 600, 19, LATINO),
    ("F_TECLA", FIGTREE, 600, 24, LATINO),
    ("F_TECLA_CHICA", FIGTREE, 600, 16, LATINO),
    ("F_CIFRAS", FIGTREE, 600, 32, CIFRAS),
    ("F_CLAVE", MONO, 500, 18, ASCII),
    ("F_LUPA", FIGTREE, 600, 30, ASCII),
    ("F_CODIGO", MONO, 700, 30, CODIGO),
]


def generar(nombre, ttf, peso, px, chars):
    f = ImageFont.truetype(str(ttf), px)
    f.set_variation_by_axes([peso])
    asc, desc = f.getmetrics()
    bits, glifos = bytearray(), []
    pendiente = None  # nibble alto esperando pareja
    for ch in sorted(set(chars), key=ord):
        x0, y0, x1, y1 = f.getbbox(ch, anchor="ls")
        w, h = max(0, x1 - x0), max(0, y1 - y0)
        if pendiente is not None:  # cada glifo empieza en un byte nuevo
            bits.append(pendiente << 4)
            pendiente = None
        off = len(bits)
        if w and h:
            img = Image.new("L", (w, h), 0)
            ImageDraw.Draw(img).text((-x0, -y0), ch, font=f, fill=255, anchor="ls")
            for v in img.tobytes():
                a = (v * 15 + 127) // 255
                if pendiente is None:
                    pendiente = a
                else:
                    bits.append((pendiente << 4) | a)
                    pendiente = None
        avance4 = round(f.getlength(ch) * 4)  # en cuartos de píxel
        glifos.append((ord(ch), off, w, h, x0, y0, avance4))
    if pendiente is not None:
        bits.append(pendiente << 4)

    filas = [", ".join(f"0x{b:02X}" for b in bits[i:i + 16]) for i in range(0, len(bits), 16)]
    g = ",\n  ".join(f"{{0x{cp:04X}, {off}, {w}, {h}, {dx}, {dy}, {av}}}" for cp, off, w, h, dx, dy, av in glifos)
    return (
        f"// {nombre}: {ttf.stem} {peso}, {px} px, {len(glifos)} glifos, {len(bits)} bytes\n"
        f"const uint8_t {nombre}_BITS[] = {{\n  " + ",\n  ".join(filas) + "\n};\n"
        f"const Glifo {nombre}_GLIFOS[] = {{\n  {g}\n}};\n"
        f"const Fuente {nombre} = {{{nombre}_BITS, {nombre}_GLIFOS, {len(glifos)}, {asc}, {desc}}};\n\n"
    ), len(bits)


partes, total = [], 0
for args in FUENTES:
    texto, n = generar(*args)
    partes.append(texto)
    total += n
DESTINO.write_text(
    "// Generado por tools/fuente_a_c.py desde tools/fuentes/ (Figtree y JetBrains Mono, licencia OFL). No editar a mano.\n"
    "#pragma once\n#include \"lienzo.h\"\n\n" + "".join(partes)
)
print(f"{DESTINO.relative_to(AQUI.parent)}: {len(FUENTES)} fuentes, {total} bytes de glifos")
