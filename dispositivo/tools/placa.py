#!/usr/bin/env python3
"""Habla con el asistente por el USB sin reiniciarlo: manda comandos de una letra,
muestra el registro y guarda lo que graba el micrófono como WAV.

Uso (desde dispositivo/):
  python3 tools/placa.py ?              diagnóstico
  python3 tools/placa.py g              graba 5 s -> grabaciones/mic_NN.wav
  python3 tools/placa.py m --segundos 8 medidor del micrófono durante 8 s
  python3 tools/placa.py "+ g"          sube 6 dB la ganancia y graba
  python3 tools/placa.py f              captura la pantalla -> grabaciones/pantalla_NN.png

Necesita pyserial (~/.platformio/penv/bin/python lo trae).
"""
import argparse
import glob
import struct
import sys
import time
import wave
import zlib
from pathlib import Path

import serial

GRABACIONES = Path(__file__).resolve().parent.parent / "grabaciones"


def abrir(puerto):
    s = serial.Serial()
    s.port = puerto
    s.baudrate = 115200
    s.timeout = 0.2
    # Abrir con DTR=0/RTS=1 reinicia el ESP32-S3: se fijan antes de open().
    s.dtr = True
    s.rts = False
    s.open()
    return s


def guardar_wav(pcm, hz):
    GRABACIONES.mkdir(exist_ok=True)
    n = len(list(GRABACIONES.glob("mic_*.wav"))) + 1
    ruta = GRABACIONES / f"mic_{n:02d}.wav"
    with wave.open(str(ruta), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(hz)
        w.writeframes(pcm)
    print(f"-> {ruta} ({len(pcm) / 2 / hz:.1f} s)")


def guardar_png(rgb565, w, h, horizontal=False):
    """PNG sin dependencias: RGB565 little endian -> RGB de 8 bits. El framebuffer
    siempre es vertical; si la pantalla estaba en horizontal se gira como se ve
    (el punto (x, y) horizontal es el píxel (w-1-y, x) del framebuffer)."""
    ancho, alto = (h, w) if horizontal else (w, h)
    filas = bytearray()
    for y in range(alto):
        filas.append(0)  # sin filtro
        for x in range(ancho):
            i = x * w + (w - 1 - y) if horizontal else y * w + x
            v = rgb565[2 * i] | (rgb565[2 * i + 1] << 8)
            r, g, b = (v >> 11) & 31, (v >> 5) & 63, v & 31
            filas += bytes(((r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)))

    def bloque(tipo, datos):
        return struct.pack(">I", len(datos)) + tipo + datos + struct.pack(">I", zlib.crc32(tipo + datos))

    png = b"\x89PNG\r\n\x1a\n" + bloque(b"IHDR", struct.pack(">IIBBBBB", ancho, alto, 8, 2, 0, 0, 0))
    png += bloque(b"IDAT", zlib.compress(bytes(filas), 9)) + bloque(b"IEND", b"")
    GRABACIONES.mkdir(exist_ok=True)
    n = len(list(GRABACIONES.glob("pantalla_*.png"))) + 1
    ruta = GRABACIONES / f"pantalla_{n:02d}.png"
    ruta.write_bytes(png)
    print(f"-> {ruta}")


def escuchar(s, segundos):
    fin = time.time() + segundos
    buf = b""
    while time.time() < fin:
        buf += s.read(4096)
        while b"\n" in buf:
            linea, buf = buf.split(b"\n", 1)
            if linea.startswith(b"#PCM "):
                _, nbytes, hz = linea.split()
                nbytes, hz = int(nbytes), int(hz)
                while len(buf) < nbytes:
                    buf += s.read(nbytes - len(buf))
                guardar_wav(buf[:nbytes], hz)
                buf = buf[nbytes:]
                fin = time.time() + 1
            elif linea.startswith(b"#FB "):
                partes = linea.split()
                w, h = int(partes[1]), int(partes[2])
                horizontal = len(partes) > 3 and partes[3] == b"1"
                while len(buf) < w * h * 2:
                    buf += s.read(w * h * 2 - len(buf))
                guardar_png(buf[: w * h * 2], w, h, horizontal)
                buf = buf[w * h * 2:]
                fin = time.time() + 1
            elif linea.strip() and linea.strip() != b"#FIN":
                print(linea.decode("utf-8", "replace"))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("comandos", nargs="?", default="?", help="letras a mandar, separadas por espacio")
    p.add_argument("--segundos", type=float, default=4, help="cuánto escuchar después de cada comando")
    p.add_argument("--puerto", default=None)
    a = p.parse_args()
    puerto = a.puerto or next(iter(sorted(glob.glob("/dev/cu.usbmodem*"))), None)
    if not puerto:
        sys.exit("No encuentro la placa.")
    s = abrir(puerto)
    for c in a.comandos.split():
        s.write(c.encode())
        espera = a.segundos
        if c == "g":
            espera = max(espera, 9)
        elif c == "G":
            espera = max(espera, 20)
        escuchar(s, espera)
    s.close()


if __name__ == "__main__":
    main()
