// ============================================================================
// El chat del panel con dos números de WhatsApp.
//
// Lo delicado es POR DÓNDE se responde. WhatsApp solo deja mandar texto libre
// dentro de las 24 h desde el último mensaje del paciente, y esa ventana es de
// un número concreto: la del número al que el paciente escribió. Responder por
// el otro sale con error 63016 y el paciente nunca lo recibe.
// ============================================================================

import {
  WaMensaje,
  athleticPlataformaChatService,
  bslPlataformaChatService,
  marcaParaResponder,
  mensajesDelPaciente,
  plataformaDe,
  responderAlPaciente,
  unirHilos,
} from '../bsl-plataforma-chat.service';

function msg(id: number, direccion: 'entrante' | 'saliente', createdAt: string): WaMensaje {
  return { id, direccion, contenido: `m${id}`, tipoMensaje: 'text', mediaUrl: null, createdAt };
}

const ENCENDIDO = {
  ATHLETIC_WHATSAPP_ENABLED: 'true',
  ATHLETIC_PLATAFORMA_USER: 'athletic@bodytech.app',
  ATHLETIC_PLATAFORMA_PASS: 'x',
};

describe('plataformaDe', () => {
  it('cada marca tiene su tenant', () => {
    expect(plataformaDe('bodytech')).toBe(bslPlataformaChatService);
    expect(plataformaDe('athletic')).toBe(athleticPlataformaChatService);
    expect(plataformaDe('athletic')).not.toBe(plataformaDe('bodytech'));
  });
});

describe('unirHilos', () => {
  it('intercala los dos hilos en orden cronológico y dice por qué número pasó cada mensaje', () => {
    const r = unirHilos([
      { marca: 'bodytech', mensajes: [msg(1, 'saliente', '2026-09-18T10:00:00Z'), msg(3, 'entrante', '2026-09-18T12:00:00Z')] },
      { marca: 'athletic', mensajes: [msg(2, 'entrante', '2026-09-18T11:00:00Z')] },
    ]);
    expect(r.map((m) => [m.id, m.marca])).toEqual([
      [1, 'bodytech'],
      [2, 'athletic'],
      [3, 'bodytech'],
    ]);
  });

  it('sin hilos, vacío', () => {
    expect(unirHilos([])).toEqual([]);
  });
});

describe('marcaParaResponder', () => {
  it('responde por el número al que el paciente escribió por ÚLTIMA vez', () => {
    const hilos = [
      { marca: 'bodytech' as const, mensajes: [msg(1, 'entrante', '2026-09-18T09:00:00Z')] },
      { marca: 'athletic' as const, mensajes: [msg(2, 'entrante', '2026-09-18T11:00:00Z')] },
    ];
    expect(marcaParaResponder(hilos)).toBe('athletic');
  });

  // Nuestros mensajes no abren ventana: solo cuenta lo que ESCRIBIÓ el paciente.
  it('lo que mandamos nosotros no abre ventana', () => {
    const hilos = [
      { marca: 'bodytech' as const, mensajes: [msg(1, 'entrante', '2026-09-18T09:00:00Z')] },
      { marca: 'athletic' as const, mensajes: [msg(2, 'saliente', '2026-09-18T11:00:00Z')] },
    ];
    expect(marcaParaResponder(hilos)).toBe('bodytech');
  });

  it('null si el paciente nunca escribió por ningún número', () => {
    expect(marcaParaResponder([{ marca: 'athletic', mensajes: [msg(1, 'saliente', '2026-09-18T09:00:00Z')] }])).toBeNull();
    expect(marcaParaResponder([])).toBeNull();
  });
});

describe('el chat del panel', () => {
  const envOriginal = process.env;

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    process.env = envOriginal;
    jest.restoreAllMocks();
  });

  describe('con Athletic apagado: igual que antes', () => {
    beforeEach(() => {
      process.env = { ...envOriginal };
      delete process.env.ATHLETIC_WHATSAPP_ENABLED;
    });

    it('lee solo el hilo de Bodytech y no toca el tenant de Athletic', async () => {
      const b = jest
        .spyOn(bslPlataformaChatService, 'getMensajes')
        .mockResolvedValue({ celular: '+573001234567', mensajes: [msg(1, 'entrante', '2026-09-18T09:00:00Z')] });
      const a = jest.spyOn(athleticPlataformaChatService, 'getMensajes');

      const r = await mensajesDelPaciente('3001234567');

      expect(b).toHaveBeenCalledWith('3001234567');
      expect(a).not.toHaveBeenCalled();
      expect(r.celular).toBe('+573001234567');
      expect(r.mensajes).toHaveLength(1);
    });

    it('responde por Bodytech sin leer los hilos antes', async () => {
      const reply = jest.spyOn(bslPlataformaChatService, 'sendReply').mockResolvedValue(msg(9, 'saliente', '2026-09-18T12:00:00Z'));
      const leer = jest.spyOn(bslPlataformaChatService, 'getMensajes');

      const r = await responderAlPaciente('3001234567', 'hola');

      expect(reply).toHaveBeenCalledWith('3001234567', 'hola');
      expect(leer).not.toHaveBeenCalled();
      expect(r).toMatchObject({ id: 9, marca: 'bodytech' });
    });

    it('si la plataforma falla, el error sube (el controller responde 502, como antes)', async () => {
      jest.spyOn(bslPlataformaChatService, 'getMensajes').mockRejectedValue(new Error('plataforma caída'));
      await expect(mensajesDelPaciente('3001234567')).rejects.toThrow('plataforma caída');
    });
  });

  describe('con Athletic encendido', () => {
    beforeEach(() => {
      process.env = { ...envOriginal, ...ENCENDIDO };
    });

    it('junta los dos hilos', async () => {
      jest
        .spyOn(bslPlataformaChatService, 'getMensajes')
        .mockResolvedValue({ celular: '3001234567', mensajes: [] });
      jest
        .spyOn(athleticPlataformaChatService, 'getMensajes')
        .mockResolvedValue({ celular: '+573001234567', mensajes: [msg(2, 'entrante', '2026-09-18T11:00:00Z')] });

      const r = await mensajesDelPaciente('3001234567');

      expect(r.mensajes).toEqual([expect.objectContaining({ id: 2, marca: 'athletic' })]);
      // El celular de la conversación que existe, no el que llegó en la URL.
      expect(r.celular).toBe('+573001234567');
    });

    it('si un tenant falla, muestra el otro en vez de dejar el chat en blanco', async () => {
      jest
        .spyOn(bslPlataformaChatService, 'getMensajes')
        .mockResolvedValue({ celular: '+573001234567', mensajes: [msg(1, 'entrante', '2026-09-18T09:00:00Z')] });
      jest.spyOn(athleticPlataformaChatService, 'getMensajes').mockRejectedValue(new Error('login ATHLETIC falló'));

      const r = await mensajesDelPaciente('3001234567');

      expect(r.mensajes).toEqual([expect.objectContaining({ id: 1, marca: 'bodytech' })]);
    });

    it('responde por el número al que el paciente escribió por última vez', async () => {
      jest
        .spyOn(bslPlataformaChatService, 'getMensajes')
        .mockResolvedValue({ celular: '+573001234567', mensajes: [msg(1, 'entrante', '2026-09-18T09:00:00Z')] });
      jest
        .spyOn(athleticPlataformaChatService, 'getMensajes')
        .mockResolvedValue({ celular: '+573001234567', mensajes: [msg(2, 'entrante', '2026-09-18T11:00:00Z')] });
      const porBodytech = jest.spyOn(bslPlataformaChatService, 'sendReply');
      const porAthletic = jest
        .spyOn(athleticPlataformaChatService, 'sendReply')
        .mockResolvedValue(msg(3, 'saliente', '2026-09-18T11:05:00Z'));

      const r = await responderAlPaciente('3001234567', 'ya te conecto');

      expect(porAthletic).toHaveBeenCalledWith('3001234567', 'ya te conecto');
      expect(porBodytech).not.toHaveBeenCalled();
      expect(r).toMatchObject({ id: 3, marca: 'athletic' });
    });

    it('si el paciente nunca escribió, no responde por ningún número', async () => {
      jest.spyOn(bslPlataformaChatService, 'getMensajes').mockResolvedValue({ celular: '3001234567', mensajes: [] });
      jest.spyOn(athleticPlataformaChatService, 'getMensajes').mockResolvedValue({ celular: '3001234567', mensajes: [] });
      const porBodytech = jest.spyOn(bslPlataformaChatService, 'sendReply');
      const porAthletic = jest.spyOn(athleticPlataformaChatService, 'sendReply');

      expect(await responderAlPaciente('3001234567', 'hola')).toBeNull();
      expect(porBodytech).not.toHaveBeenCalled();
      expect(porAthletic).not.toHaveBeenCalled();
    });
  });
});
