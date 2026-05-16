# BOT_VOZ — Bots de Voz para Testing

Feature de testing: dos bots de voz (médico y paciente) que simulan una consulta médica completa, con audio que fluye por el room de Twilio, para verificar el pipeline transcripción → historia clínica.

## Flujo

1. **Paciente** abre la página de paciente en el celular, activa el bot con el botón 🤖 → el bot espera al médico
2. **Médico** abre el panel médico en el computador, activa su bot 🤖 → el bot arranca inmediatamente
3. El bot médico conduce una entrevista clínica conversacional cubriendo los campos de Anamnesis
4. El bot paciente (Carlos Mejía, 38 años, afiliado nuevo de Bodytech) escucha via Twilio y responde de forma parlanchina
5. Twilio graba todo → al finalizar la llamada, el pipeline existente transcribe y actualiza la historia clínica
6. El bot médico detecta su frase de cierre ("Bienvenido a Bodytech") y se desactiva solo

## Arquitectura técnica

```
[Bot Médico - Computador]                    [Bot Paciente - Celular iOS]
        |                                              |
  OpenAI Realtime WS                          OpenAI Realtime WS
  (voice: shimmer)                            (voice: nova, VAD habilitado)
        |                                              |
  AudioContext 24kHz ──────────────────────► AudioContext 24kHz
  MediaStreamDestination                     ScriptProcessorNode
        |                                    (captura audio remoto)
  LocalAudioTrack (sintético)                        |
        |                         ◄──────── input_audio_buffer.append
        └────────► Twilio Room ◄────────────┘
                       |
              (Twilio Recording)
                       |
              Post-call pipeline:
              Whisper → GPT-4o-mini → 11 campos de historia clínica

Coordinación de turnos vía Socket.io (/telemedicine):
  Paciente: response.done → emit('bot-turn-done', { transcript })
  Médico: on('bot-turn-done') → conversation.item.create + response.create
```

## Archivos modificados / creados

### Archivos NUEVOS (eliminar en rollback)
- `frontend/src/hooks/useDoctorBot.ts` — Hook del bot médico
- `frontend/src/hooks/usePatientBot.ts` — Hook del bot paciente
- `BOTS_VOZ.md` — Esta documentación

### Archivos MODIFICADOS (revertir cambios marcados BOT_VOZ)

| Archivo | Cambio |
|---|---|
| `backend/src/controllers/video.controller.ts` | Método `createBotSession()` al final de la clase |
| `backend/src/routes/video.routes.ts` | Ruta `POST /bot/session-token` |
| `backend/src/services/telemedicine-socket.service.ts` | Eventos `join-bot-room` y `bot-turn-done` |
| `frontend/src/services/api.service.ts` | Método `createBotSession()` |
| `frontend/src/components/VideoControls.tsx` | Props `showBotControl`, `isBotActive`, `isBotConnecting`, `onToggleBot` + botón 🤖 |
| `frontend/src/components/VideoRoom.tsx` | Imports + hooks `useDoctorBot`/`usePatientBot` + `activeBot` + panel transcript |

## Rollback completo

```bash
# Opción 1: Revertir por git (si fue un commit limpio)
git revert <commit-sha>

# Opción 2: Manual
# 1. Eliminar archivos nuevos:
rm frontend/src/hooks/useDoctorBot.ts
rm frontend/src/hooks/usePatientBot.ts

# 2. En cada archivo modificado, buscar y eliminar los bloques marcados con BOT_VOZ
#    grep -rn "BOT_VOZ" backend/ frontend/src/
```

## Requisitos para usar

- **Computador (médico):** Cualquier browser, pantalla normal
- **Celular (paciente):** iOS con Safari. Ir a Ajustes → Pantalla y brillo → Auto-bloqueo → **Nunca** antes de activar el bot (Safari suspende JS si la pantalla se apaga)
- **Backend:** Variable de entorno `OPENAI_API_KEY` con acceso al modelo `gpt-4o-realtime-preview-2024-12-17`

## Perfil del bot paciente (hardcodeado)

Carlos Mejía, 38 años, Bogotá:
- Objetivo: bajar de peso
- Dolor lumbar crónico leve hace 2 años, empeora con sedentarismo
- Ibuprofeno ocasional para el dolor de espalda
- Alérgico al polvo (rinitis), sin alergias a medicamentos
- Cirugía de menisco rodilla derecha hace 4 años
- Madre con hipertensión, padre con DM2
- Sedentario (oficina 9h/día)
- Peso aprox. 85 kg, talla 1.75 m

## Verificación post-test

Después de finalizar la llamada, esperar ~2 minutos y revisar la historia clínica. Los campos que deben haberse auto-llenado son:

1. `motivo_consulta_texto` — objetivo del afiliado
2. `ant_patologico_obs` — antecedentes patológicos
3. `ant_farmacologico_obs` — medicamentos (ibuprofeno)
4. `ant_alergicos_obs` — alergias (polvo)
5. `hallazgos_descripcion` — descripción de hallazgos
6. `hallazgos_dolor` — dolor lumbar
7. `cc_peso_nuevo` — 85 (kg)
8. `cc_estatura_nuevo` — 175 (cm)
9. `tas` — presión sistólica (si se mencionó)
10. `tad` — presión diastólica (si se mencionó)
11. `fcr` — frecuencia cardíaca (si se mencionó)
