import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import medicalPanelService, { Patient } from '../services/medical-panel.service';
import apiService from '../services/api.service';
import authService, { Sede, loginErrorMessage } from '../services/auth.service';
import { AgendarCitaModal } from '../components/AgendarCitaModal';
import { AgendaView } from '../components/AgendaView';

// Helper function para reproducir sonido de notificación
const playNotificationSound = () => {
  try {
    // Crear un contexto de audio
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Configurar el sonido: tono de notificación agradable
    oscillator.frequency.value = 800; // Frecuencia en Hz
    oscillator.type = 'sine'; // Tipo de onda

    // Configurar volumen con fade
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

    // Reproducir
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.5);

    console.log('🔔 Notification sound played');
  } catch (error) {
    console.error('Error playing notification sound:', error);
  }
};

// Helper function para text-to-speech
const speakText = (text: string) => {
  try {
    if ('speechSynthesis' in window) {
      // Cancelar cualquier speech en progreso
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'es-ES'; // Español
      utterance.rate = 1.0; // Velocidad normal
      utterance.pitch = 1.0; // Tono normal
      utterance.volume = 1.0; // Volumen máximo

      // Primero reproducir el sonido de notificación
      playNotificationSound();

      // Luego hablar el texto
      setTimeout(() => {
        window.speechSynthesis.speak(utterance);
        console.log('🔊 Speaking:', text);
      }, 600); // Esperar a que termine el sonido
    } else {
      console.warn('speechSynthesis no está disponible en este navegador');
      // Si no hay speech synthesis, al menos reproducir el sonido
      playNotificationSound();
    }
  } catch (error) {
    console.error('Error in speakText:', error);
  }
};

export function MedicalPanelPage() {
  const queryClient = useQueryClient();
  const [medicoCode, setMedicoCode] = useState('');
  const [sedeId, setSedeId] = useState('');
  const [sedes, setSedes] = useState<Sede[]>([]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  // `isValidating` reemplaza el `isLoading` original SOLO para el flujo de
  // login (botón "Entrar" mostrando "Cargando..."). Los estados de fetch de
  // las listas ahora vienen de TanStack Query.
  const [isValidating, setIsValidating] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [collapsedItems, setCollapsedItems] = useState<{ [key: string]: boolean }>({});
  const [searchDocument, setSearchDocument] = useState('');
  // `searchSubmitted` se setea sólo al click "Buscar". Lo usamos como queryKey
  // y `enabled`, así que la query sólo dispara al submit (no al tipear) y el
  // resultado visible no desaparece mientras el usuario edita el input.
  const [searchSubmitted, setSearchSubmitted] = useState('');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attendingPatient, setAttendingPatient] = useState<string | null>(null);
  const [contactingPatient, setContactingPatient] = useState<string | null>(null);
  const [recallingPatient, setRecallingPatient] = useState<string | null>(null);
  const [connectedPatients, setConnectedPatients] = useState<Set<string>>(new Set());
  const [patientRooms, setPatientRooms] = useState<{ [patientId: string]: string }>({});
  const [contactedPatients, setContactedPatients] = useState<Set<string>>(new Set()); // Pacientes que ya fueron contactados
  const [showAgendarModal, setShowAgendarModal] = useState(false);
  const [panelView, setPanelView] = useState<'hoy' | 'agenda'>('hoy');

  const pageSize = 10;

  // Run 5 — Multi-sede login: al montar, cargar lista de sedes para popular
  // el <select>, y si ya hay sesión persistida, restaurarla sin volver a
  // golpear el server (el JWT se valida en cada request del panel; si está
  // expirado, la primera query devolverá 401 y se podrá deslogear).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await authService.getSedes();
        if (!cancelled) setSedes(list);
      } catch (err) {
        console.error('[MedicalPanel] Error cargando sedes:', err);
      }
    })();

    // Nueva auth (RBAC): el código viene del profesional vinculado en la sesión.
    // La ruta /panel-medico está protegida por RequireRole, así que aquí ya hay
    // sesión; si por algo no la hay, dejamos isLoggedIn=false (RequireRole redirige).
    const user = authService.getUser();
    if (user) {
      setMedicoCode(user.codigo ?? '');
      setSedeId(user.sedes[0] ?? '');
      setIsLoggedIn(true);
    }

    return () => {
      cancelled = true;
    };
  }, []);

  // ----- Stats diarias del médico -----
  const statsQuery = useQuery({
    queryKey: ['daily-stats', medicoCode],
    queryFn: () => medicalPanelService.getDailyStats(medicoCode),
    enabled: isLoggedIn && !!medicoCode,
    staleTime: 30_000,
  });

  // ----- Lista paginada de pacientes pendientes -----
  const patientsQuery = useQuery({
    queryKey: ['pending-patients', medicoCode, currentPage, pageSize],
    queryFn: () => medicalPanelService.getPendingPatients(medicoCode, currentPage, pageSize),
    enabled: isLoggedIn && !!medicoCode,
    staleTime: 30_000,
  });

  // ----- Búsqueda por documento -----
  // `enabled` se ata a `searchSubmitted` (no a `searchDocument`) para que la
  // query sólo dispare al click "Buscar". El resultado se cachea por
  // documento — si se busca el mismo documento de nuevo (clearSearch + retipear
  // + Buscar), se reusa hasta `staleTime`.
  const patientSearchQuery = useQuery<Patient | null, Error>({
    queryKey: ['patient-search', searchSubmitted],
    queryFn: async () => {
      const result = await medicalPanelService.searchPatientByDocument(searchSubmitted);
      return (result ?? null) as Patient | null;
    },
    enabled: !!searchSubmitted,
    retry: 1,
    staleTime: 30_000,
  });

  const stats = statsQuery.data ?? null;
  const patients: Patient[] = patientsQuery.data?.patients ?? [];
  const totalPages = patientsQuery.data?.totalPages ?? 0;
  const searchResult = patientSearchQuery.data ?? null;

  // IDs de los pacientes que ESTE coach tiene en pantalla (lista + búsqueda).
  // El backend emite `patient-connected` por código de médico, pero un mismo
  // código puede tener más pacientes que los visibles (paginación) — solo
  // anunciamos por voz a los que el coach realmente ve en su lista.
  const myPatientIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const ids = new Set<string>();
    const add = (v?: string) => { if (v) ids.add(String(v)); };
    patients.forEach((p) => { add(p._id); add(p.numeroId); });
    const sr = searchResult as { _id?: string; numeroId?: string } | null;
    if (sr) { add(sr._id); add(sr.numeroId); }
    myPatientIdsRef.current = ids;
  }, [patients, searchResult]);
  // `isLoading` (compat) es true si alguna de las queries principales está
  // refetcheando. Para el botón de login usamos `isValidating`.
  const isLoading = statsQuery.isFetching || patientsQuery.isFetching;
  const isSearching = patientSearchQuery.isFetching;

  // Run 5: el login ahora golpea `POST /api/auth/login` que valida la sede y
  // emite un JWT. Si el server responde 401 (sede inactiva / inexistente)
  // mostramos error específico. Las queries posteriores (`daily-stats`,
  // `pending-patients`) reusan el JWT vía el interceptor de axios.
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!medicoCode) {
      setError('Por favor ingrese el código de médico');
      return;
    }
    if (!sedeId) {
      setError('Por favor seleccione una sede');
      return;
    }
    setIsValidating(true);
    setError(null);
    try {
      await authService.login(medicoCode, sedeId);
      setIsLoggedIn(true);
    } catch (err) {
      console.error('Error en login:', err);
      setError(loginErrorMessage(err));
    } finally {
      setIsValidating(false);
    }
  };

  // Cierre de sesión — limpia localStorage y vuelve al login unificado.
  const handleLogout = () => {
    authService.logout();
    window.location.href = '/login';
    setIsLoggedIn(false);
    setMedicoCode('');
    setSedeId('');
    setCurrentPage(0);
    setConnectedPatients(new Set());
    setPatientRooms({});
    setContactedPatients(new Set());
    setSearchDocument('');
    setSearchSubmitted('');
    setSearchError(null);
    queryClient.clear();
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['daily-stats', medicoCode] });
    queryClient.invalidateQueries({ queryKey: ['pending-patients', medicoCode] });
  };

  const handlePageChange = (newPage: number) => {
    if (newPage < 0 || newPage >= totalPages) return;
    setCurrentPage(newPage);
  };

  // Socket.io para notificaciones en tiempo real de pacientes conectados
  useEffect(() => {
    if (!isLoggedIn) return;

    // Determinar URL del servidor Socket.io
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '';
    const socketUrl = apiBaseUrl || (import.meta.env.DEV ? 'http://localhost:3000' : window.location.origin);

    console.log('[MedicalPanel] Connecting to Socket.io at:', socketUrl);

    // Crear conexión Socket.io
    const newSocket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    newSocket.on('connect', () => {
      console.log('[MedicalPanel] Socket.io connected');

      // 🔥 UNIRSE A LA ROOM DEL MÉDICO: Para recibir solo sus notificaciones
      const doctorRoom = `doctor-${medicoCode}`;
      newSocket.emit('join-room', doctorRoom);
      console.log(`[MedicalPanel] Joined Socket.io room: ${doctorRoom}`);

      // 🔥 SINCRONIZAR ESTADO: Obtener lista de pacientes ya conectados
      syncConnectedPatients();
    });

    newSocket.on('disconnect', () => {
      console.log('[MedicalPanel] Socket.io disconnected');
    });

    // Escuchar cuando un paciente se conecta
    newSocket.on('patient-connected', (data: { documento: string; roomName: string; identity: string; connectedAt: string }) => {
      console.log('[MedicalPanel] Patient connected:', data);
      setConnectedPatients((prev) => {
        const updated = new Set(prev);
        updated.add(data.documento);
        return updated;
      });

      // Solo anunciar por voz si el paciente está en la lista de ESTE coach.
      // Evita que suene el aviso por pacientes de otro código o que no están
      // en la lista visible (mismo código, otra página / pool de médicos).
      if (myPatientIdsRef.current.has(String(data.documento))) {
        const patientName = data.identity || 'Paciente';
        speakText(`${patientName} conectado`);
      } else {
        console.log('[MedicalPanel] Aviso de voz omitido (paciente no está en la lista):', data.documento);
      }
    });

    // Escuchar cuando un paciente se desconecta
    newSocket.on('patient-disconnected', (data: { documento: string; roomName: string; identity: string; disconnectedAt: string }) => {
      console.log('[MedicalPanel] Patient disconnected:', data);
      setConnectedPatients((prev) => {
        const updated = new Set(prev);
        updated.delete(data.documento);
        return updated;
      });
    });

    // Cleanup al desmontar
    return () => {
      console.log('[MedicalPanel] Disconnecting Socket.io');
      newSocket.disconnect();
    };
  }, [isLoggedIn, medicoCode]);

  // Función para sincronizar estado de pacientes conectados desde el backend
  const syncConnectedPatients = async () => {
    try {
      console.log('[MedicalPanel] Syncing connected patients from backend for medicoCode:', medicoCode);
      const connectedList = await apiService.getConnectedPatients(medicoCode);

      console.log('[MedicalPanel] Connected patients received:', connectedList);

      // Actualizar estado con los pacientes conectados
      setConnectedPatients(new Set(connectedList.map(p => p.documento)));
    } catch (err) {
      console.error('[MedicalPanel] Error syncing connected patients:', err);
    }
  };

  const handleNoAnswer = async (patientId: string) => {
    try {
      await medicalPanelService.markAsNoAnswer(patientId);
      setCollapsedItems({ ...collapsedItems, [patientId]: true });
      // Recargar datos: invalidar las queries principales para que TanStack
      // Query refetchee con los valores actuales.
      queryClient.invalidateQueries({ queryKey: ['daily-stats', medicoCode] });
      queryClient.invalidateQueries({ queryKey: ['pending-patients', medicoCode] });
    } catch (err) {
      console.error('Error marcando como no contesta:', err);
    }
  };

  const formatPhoneNumber = (phone: string): string => {
    // Limpiar espacios, paréntesis, guiones
    const cleaned = phone.replace(/[\s()-]/g, '');

    // Si ya tiene +, retornarlo limpio
    if (cleaned.startsWith('+')) {
      return cleaned;
    }

    // Detectar si ya tiene código de país internacional.
    // Incluye LatAm (Chile 56, Perú 51, Venezuela 58, Cuba 53, e indicativos de
    // 3 dígitos de Centro/Sudamérica) + EE.UU./Europa. Los de 3 dígitos van
    // PRIMERO para que el regex no los corte con un prefijo de 2 dígitos.
    // `\d{8,}` tolera longitudes nacionales variables (Chile=9, Colombia=10).
    const hasCountryCode =
      /^(502|503|504|505|506|507|591|593|595|598|1|33|34|44|49|51|52|53|54|55|56|57|58)\d{8,}/.test(cleaned);

    if (hasCountryCode) {
      // Ya tiene código de país, solo agregar +
      return `+${cleaned}`;
    }

    // Detectar si es número local colombiano (10 dígitos que empiezan con 3)
    const isColombian = /^3\d{9}$/.test(cleaned);

    if (isColombian) {
      // Es número local colombiano, agregar +57
      return `+57${cleaned}`;
    }

    // Si no coincide con ningún patrón, retornar tal cual (con advertencia en consola)
    console.warn(`⚠️ Número telefónico con formato desconocido: ${cleaned}`);
    return cleaned;
  };

  const handleContactar = async (patient: Patient) => {
    setContactingPatient(patient._id);
    try {
      // Generar sala única y guardarla para este paciente
      const roomName = medicalPanelService.generateRoomName();
      setPatientRooms(prev => ({ ...prev, [patient._id]: roomName }));

      // Formatear teléfono con código de país internacional
      const phoneWithPlus = formatPhoneNumber(patient.celular);

      // Quitar SOLO el "+" inicial (no recortar a ciegas: si el número quedó sin
      // "+", substring(1) se comería el primer dígito del indicativo → Chile y
      // cualquier país fuera de la lista blanca terminaban en un número inválido).
      const phoneWithoutPlus = phoneWithPlus.replace(/^\+/, '');

      // Construir roomNameWithParams para el template (path completo con query params)
      // Ejemplo: "consulta-abc123?nombre=Juan&apellido=Perez&documento=123&doctor=JUAN"
      const params = new URLSearchParams({
        nombre: patient.primerNombre,
        apellido: patient.primerApellido,
        documento: patient.numeroId,
        doctor: medicoCode,
        historiaId: patient._id,
      });
      const roomNameWithParams = `${roomName}?${params.toString()}`;

      // 1. Enviar mensaje de WhatsApp con template aprobado
      // Template Bodytech: "Hola {{1}}, Te saludamos del Bodytech. Tienes una consulta médica a las {{2}}..."
      // Button URL: https://bodytech.app/panel-medico/patient/{{3}}
      const now = new Date();
      const appointmentTime = now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true });
      await apiService.sendWhatsApp(
        phoneWithoutPlus,
        roomNameWithParams,
        patient.primerNombre,
        appointmentTime,
        patient._id
      );
      console.log('WhatsApp con template enviado exitosamente');

      // 2. Realizar llamada telefónica con Twilio Voice
      try {
        console.log(`📞 Iniciando llamada a: ${phoneWithPlus}`);
        await apiService.makeVoiceCall(phoneWithPlus, patient.primerNombre);
        console.log('✅ Llamada telefónica iniciada exitosamente');
      } catch (callError) {
        console.error('❌ Error realizando llamada telefónica:', callError);
        // No interrumpir el flujo si la llamada falla
      }

      // Marcar paciente como contactado (deshabilitar botón permanentemente)
      setContactedPatients(prev => {
        const updated = new Set(prev);
        updated.add(patient._id);
        return updated;
      });

      alert(`✅ Mensaje de WhatsApp enviado y llamada iniciada a ${patient.primerNombre}`);
    } catch (error) {
      console.error('Error al contactar paciente:', error);
      alert('Error al contactar afiliado. Inténtalo nuevamente.');
    } finally {
      setContactingPatient(null);
    }
  };

  const handleRellamar = async (patient: Patient) => {
    setRecallingPatient(patient._id);
    try {
      // Formatear teléfono con código de país internacional
      const phoneWithPlus = formatPhoneNumber(patient.celular);

      // Realizar llamada telefónica con Twilio Voice
      console.log(`📞 Rellamando a: ${phoneWithPlus}`);
      await apiService.makeVoiceCall(phoneWithPlus, patient.primerNombre);
      console.log('✅ Rellamada iniciada exitosamente');

      alert(`✅ Llamada iniciada a ${patient.primerNombre}`);
    } catch (error) {
      console.error('❌ Error al rellamar paciente:', error);
      alert('Error al realizar la llamada. Inténtalo nuevamente.');
    } finally {
      setRecallingPatient(null);
    }
  };

  const handleAtender = async (patient: Patient) => {
    setAttendingPatient(patient._id);
    try {
      // Usar la sala guardada si existe (si ya se contactó al paciente)
      // Si no existe, generar una nueva sala
      let roomName = patientRooms[patient._id];
      if (!roomName) {
        roomName = medicalPanelService.generateRoomName();
        setPatientRooms(prev => ({ ...prev, [patient._id]: roomName }));
      }

      // El panel a abrir depende de la especialidad del profesional logueado:
      // Nutrición Deportiva → panel nutricional (/nutricion); resto → consulta (/doctor).
      // La sala (roomName) es la MISMA que se envió al paciente por WhatsApp, así que
      // ambos entran a la misma sala de Twilio independientemente del panel.
      const basePath = authService.isNutricionDeportiva() ? 'nutricion' : 'doctor';
      const doctorUrl = `${window.location.origin}/${basePath}/${roomName}?doctor=${medicoCode}&documento=${patient._id}&paciente=${encodeURIComponent(patient.nombres)}`;

      // Abrir ventana del doctor en una nueva pestaña
      window.open(doctorUrl, '_blank');
    } catch (error) {
      console.error('Error al atender paciente:', error);
      alert('Error al abrir sala de consulta. Inténtalo nuevamente.');
    } finally {
      setAttendingPatient(null);
    }
  };

  const toggleCollapse = (patientId: string) => {
    setCollapsedItems({
      ...collapsedItems,
      [patientId]: !collapsedItems[patientId]
    });
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const doc = searchDocument.trim();
    if (!doc) {
      setSearchError('Por favor ingrese un documento o celular');
      return;
    }
    setSearchError(null);
    // Caso 1: documento distinto al previo → setSearchSubmitted cambia la
    // queryKey, `enabled` lo dispara. No-op para refetch manual.
    // Caso 2: mismo documento → la queryKey no cambia y `enabled` ya estaba
    // true; forzamos refetch explícito.
    if (doc === searchSubmitted) {
      await patientSearchQuery.refetch();
    } else {
      setSearchSubmitted(doc);
    }
  };

  // Si la búsqueda terminó y no hubo paciente, mostrar el mensaje "no
  // encontrado". Se hace en efecto porque `data === null` es un caso de éxito,
  // no de error de la query.
  useEffect(() => {
    if (!searchSubmitted) return;
    if (patientSearchQuery.isFetching) return;
    if (patientSearchQuery.error) {
      setSearchError('Error al buscar afiliado');
    } else if (patientSearchQuery.data === null) {
      setSearchError('No se encontró afiliado con ese documento o celular');
    }
  }, [searchSubmitted, patientSearchQuery.isFetching, patientSearchQuery.error, patientSearchQuery.data]);

  const clearSearch = () => {
    setSearchDocument('');
    setSearchSubmitted('');
    setSearchError(null);
    queryClient.removeQueries({ queryKey: ['patient-search'] });
  };

  const generateWhatsAppMessage = (patient: Patient, includeLink: boolean = false) => {
    if (!includeLink) {
      return `Hola ${patient.primerNombre}. Te escribimos de BSL. Tienes una cita médica programada conmigo`;
    }

    const roomName = medicalPanelService.generateRoomName();
    const patientLink = `https://bsl-consultavideo-58jne.ondigitalocean.app/patient/${roomName}?nombre=${patient.primerNombre}&apellido=${patient.primerApellido}`;

    return `Hola ${patient.primerNombre}. Te escribimos de BSL. Tienes una cita médica programada conmigo\n\nConéctate al link:\n\n${patientLink}`;
  };

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-[#0b141a] flex items-center justify-center p-4">
        <div className="bg-[#1f2c34] rounded-3xl shadow-2xl p-8 sm:p-10 max-w-md w-full">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-6">
              <img
                src="/bodySinFondo.png"
                alt="BSL Logo"
                className="h-20 w-auto"
              />
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold text-white mb-2">
              Panel Médico
            </h1>
            <p className="text-gray-400 text-sm">
              Gestión de consultas y afiliados
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="codEmpresa" className="block text-sm font-medium text-gray-300 mb-2">
                Código de Médico
              </label>
              <input
                type="text"
                id="codEmpresa"
                value={medicoCode}
                onChange={(e) => setMedicoCode(e.target.value)}
                className="w-full px-4 py-3 bg-[#2a3942] border border-gray-600 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:border-[#00a884] transition"
                placeholder="Ingrese su código"
                required
              />
            </div>

            <div>
              <label htmlFor="sedeId" className="block text-sm font-medium text-gray-300 mb-2">
                Sede
              </label>
              <select
                id="sedeId"
                value={sedeId}
                onChange={(e) => setSedeId(e.target.value)}
                required
                className="w-full px-4 py-3 bg-[#2a3942] border border-gray-600 rounded-xl text-white focus:outline-none focus:border-[#00a884] transition"
              >
                <option value="">-- Seleccionar sede --</option>
                {sedes.map((s) => (
                  <option key={s.sedeId} value={s.sedeId}>
                    {s.nombre} ({s.ciudad})
                  </option>
                ))}
              </select>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/50 rounded-xl p-3 text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isValidating}
              className="w-full bg-[#00a884] text-white px-6 py-3 rounded-xl hover:bg-[#008f6f] transition font-semibold shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isValidating ? 'Cargando...' : 'Entrar'}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-gray-700">
            <a
              href="https://api.whatsapp.com/send?phone=573008021701&text=Hola"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-[#00a884] transition"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              Soporte técnico
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b141a] p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-[#1f2c34] rounded-2xl shadow-xl p-6 mb-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <img src="/bodySinFondo.png" alt="BSL Logo" className="h-12 w-auto" />
              <div>
                <h1 className="text-2xl font-bold text-white">Panel Médico</h1>
                <p className="text-gray-400 text-sm">
                  Código: {medicoCode}
                  {sedeId && (
                    <>
                      <span className="mx-2 text-gray-600">·</span>
                      Sede: {sedeId}
                    </>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <img src="/mediconectaLogo.png" alt="Mediconecta" className="h-10 w-auto" />
              <div className="flex rounded-lg overflow-hidden border border-gray-600">
                <button
                  onClick={() => setPanelView('hoy')}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    panelView === 'hoy'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  Hoy
                </button>
                <button
                  onClick={() => setPanelView('agenda')}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    panelView === 'agenda'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  Agenda
                </button>
              </div>
              <button
                onClick={() => setShowAgendarModal(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg transition-colors"
              >
                <Plus size={16} />
                Agendar Cita
              </button>
              <button
                onClick={handleRefresh}
                disabled={isLoading}
                className="bg-[#00a884] text-white px-4 py-2 rounded-xl hover:bg-[#008f6f] transition font-semibold disabled:opacity-50"
              >
                {isLoading ? '⟳' : '↻ Actualizar'}
              </button>
              <button
                onClick={handleLogout}
                className="bg-gray-700 text-white px-4 py-2 rounded-xl hover:bg-gray-600 transition font-semibold"
              >
                Cerrar sesión
              </button>
            </div>
          </div>

          {/* Estadísticas */}
          {panelView === 'hoy' && stats && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-[#2a3942] rounded-xl p-4">
                <div className="text-gray-400 text-sm mb-1">Programados Hoy</div>
                <div className="text-3xl font-bold text-white">{stats.programadosHoy}</div>
              </div>
              <div className="bg-[#2a3942] rounded-xl p-4">
                <div className="text-gray-400 text-sm mb-1">Atendidos Hoy</div>
                <div className="text-3xl font-bold text-[#00a884]">{stats.atendidosHoy}</div>
              </div>
              <div className="bg-[#2a3942] rounded-xl p-4">
                <div className="text-gray-400 text-sm mb-1">Restantes Hoy</div>
                <div className="text-3xl font-bold text-yellow-500">{stats.restantesHoy}</div>
              </div>
            </div>
          )}
        </div>

        {panelView === 'hoy' && (
        <>
        {/* Búsqueda */}
        <div className="bg-[#1f2c34] rounded-2xl shadow-xl p-6 mb-6">
          <h2 className="text-xl font-bold text-white mb-4">Buscar Afiliado</h2>
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Buscar por documento o celular..."
                value={searchDocument}
                onChange={(e) => setSearchDocument(e.target.value)}
                className="flex-1 px-4 py-3 bg-[#2a3942] border border-gray-600 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:border-[#00a884] transition"
              />
              <button
                type="submit"
                disabled={isSearching || !searchDocument.trim()}
                className="bg-[#00a884] text-white px-6 py-3 rounded-xl hover:bg-[#008f6f] transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSearching ? '🔍' : '🔎 Buscar'}
              </button>
              {(searchResult || searchError) && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="bg-gray-600 text-white px-4 py-3 rounded-xl hover:bg-gray-700 transition font-semibold"
                >
                  ✕ Limpiar
                </button>
              )}
            </div>

            {searchError && (
              <div className="bg-red-500/10 border border-red-500/50 rounded-xl p-3 text-red-400 text-sm">
                {searchError}
              </div>
            )}

            {searchResult && (
              <div className="bg-[#2a3942] rounded-xl p-4 mt-4">
                <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                  ✅ Afiliado encontrado
                </h3>
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="col-span-2 flex items-center gap-3 mb-2">
                      <div>
                        <span className="text-gray-400">Nombre:</span>
                        <span className="text-white ml-2 font-semibold">
                          {searchResult.nombres}
                          {searchResult.tipoExamen && (
                            <span className="ml-2 text-sm font-normal text-gray-400">
                              ({searchResult.tipoExamen})
                            </span>
                          )}
                        </span>
                      </div>
                      {connectedPatients.has(searchResult.numeroId) && (
                        <div className="flex items-center gap-2 bg-green-500/20 px-3 py-1 rounded-full border border-green-500/50">
                          <div className="relative flex items-center justify-center w-2 h-2">
                            <div className="absolute w-2 h-2 bg-green-500 rounded-full animate-ping"></div>
                            <div className="relative w-2 h-2 bg-green-500 rounded-full"></div>
                          </div>
                          <span className="text-green-400 text-xs font-medium uppercase tracking-wide">
                            Conectado
                          </span>
                        </div>
                      )}
                    </div>
                    <div>
                      <span className="text-gray-400">Doc:</span>
                      <span className="text-white ml-2">{searchResult.numeroId}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400">Celular:</span>
                      <span className="text-white ml-2">{searchResult.celular || 'NO REGISTRA'}</span>
                      {searchResult.celular && (
                        <a
                          href={medicalPanelService.generateWhatsAppLink(
                            searchResult.celular,
                            generateWhatsAppMessage(searchResult, false)
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#25D366] hover:text-[#1da851] transition"
                          title="Enviar WhatsApp"
                        >
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                          </svg>
                        </a>
                      )}
                    </div>
                    <div>
                      <span className="text-gray-400">Sede:</span>
                      <span className="text-white ml-2">
                        {searchResult.empresaListado === 'SANITHELP-JJ' ? 'PARTICULAR' : searchResult.empresaListado}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400">Fecha atención:</span>
                      <span className="text-white ml-2">
                        {new Date(searchResult.fechaAtencion).toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400">Estado:</span>
                      <span className="text-white ml-2">{searchResult.estado}</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-gray-700 flex justify-between items-center">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleContactar(searchResult)}
                        disabled={contactingPatient === searchResult._id || contactedPatients.has(searchResult._id)}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {contactingPatient === searchResult._id ? (
                          <>
                            <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Contactando...
                          </>
                        ) : contactedPatients.has(searchResult._id) ? (
                          <>
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                            </svg>
                            Contactado
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M20 10.999h2C22 5.869 18.127 2 12.99 2v2C17.052 4 20 6.943 20 10.999z"/>
                              <path d="M13 8c2.103 0 3 .897 3 3h2c0-3.225-1.775-5-5-5v2zm3.422 5.443a1.001 1.001 0 0 0-1.391.043l-2.393 2.461c-.576-.11-1.734-.471-2.926-1.66-1.192-1.193-1.553-2.354-1.66-2.926l2.459-2.394a1 1 0 0 0 .043-1.391L6.859 3.513a1 1 0 0 0-1.391-.087l-2.17 1.861a1 1 0 0 0-.29.649c-.015.25-.301 6.172 4.291 10.766C11.305 20.707 16.323 21 17.705 21c.202 0 .326-.006.359-.008a.992.992 0 0 0 .648-.291l1.86-2.171a.997.997 0 0 0-.086-1.391l-4.064-3.696z"/>
                            </svg>
                            Contactar
                          </>
                        )}
                      </button>

                      <button
                        onClick={() => handleRellamar(searchResult)}
                        disabled={recallingPatient === searchResult._id}
                        className="bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {recallingPatient === searchResult._id ? (
                          <>
                            <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Llamando...
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
                            </svg>
                            Rellamar
                          </>
                        )}
                      </button>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAtender(searchResult)}
                        disabled={attendingPatient === searchResult._id}
                        className="bg-[#00a884] text-white px-4 py-2 rounded-lg hover:bg-[#008f6f] transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {attendingPatient === searchResult._id ? (
                          <>
                            <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Abriendo sala...
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
                            </svg>
                            Atender
                          </>
                        )}
                      </button>

                      <button
                        onClick={() => handleNoAnswer(searchResult._id)}
                        className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition text-sm font-medium flex items-center gap-2"
                      >
                        No Contesta
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </form>
        </div>

        {/* Lista de Pacientes */}
        <div className="bg-[#1f2c34] rounded-2xl shadow-xl p-6">
          <h2 className="text-xl font-bold text-white mb-4">Afiliados Pendientes</h2>

          {isLoading ? (
            <div className="text-center py-8 text-gray-400">
              Cargando afiliados...
            </div>
          ) : patients.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              No hay afiliados pendientes
            </div>
          ) : (
            <div className="space-y-4">
              {patients.map((patient) => (
                <div
                  key={patient._id}
                  className={`bg-[#2a3942] rounded-xl overflow-hidden transition-all ${
                    collapsedItems[patient._id] ? 'opacity-50' : ''
                  }`}
                >
                  <div className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-lg font-semibold text-white">
                            {patient.nombres}
                            {patient.tipoExamen && (
                              <span className="ml-2 text-sm font-normal text-gray-400">
                                ({patient.tipoExamen})
                              </span>
                            )}
                          </h3>
                          {connectedPatients.has(patient.numeroId) && (
                            <div className="flex items-center gap-2 bg-green-500/20 px-3 py-1 rounded-full border border-green-500/50">
                              <div className="relative flex items-center justify-center w-2 h-2">
                                <div className="absolute w-2 h-2 bg-green-500 rounded-full animate-ping"></div>
                                <div className="relative w-2 h-2 bg-green-500 rounded-full"></div>
                              </div>
                              <span className="text-green-400 text-xs font-medium uppercase tracking-wide">
                                Conectado
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <span className="text-gray-400">Doc:</span>
                            <span className="text-white ml-2">{patient.numeroId}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400">Celular:</span>
                            <span className="text-white ml-2">
                              {patient.celular || 'NO REGISTRA'}
                            </span>
                            {patient.celular && (
                              <a
                                href={medicalPanelService.generateWhatsAppLink(
                                  patient.celular,
                                  generateWhatsAppMessage(patient, false)
                                )}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#25D366] hover:text-[#1da851] transition"
                                title="Enviar WhatsApp"
                              >
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                                </svg>
                              </a>
                            )}
                          </div>
                          <div>
                            <span className="text-gray-400">Sede:</span>
                            <span className="text-white ml-2">
                              {patient.empresaListado === 'SANITHELP-JJ'
                                ? 'PARTICULAR'
                                : patient.empresaListado}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-400">Fecha:</span>
                            <span className="text-white ml-2">
                              {new Date(patient.fechaAtencion).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => toggleCollapse(patient._id)}
                        className="text-gray-400 hover:text-white ml-4"
                      >
                        {collapsedItems[patient._id] ? '▼' : '▲'}
                      </button>
                    </div>

                    {!collapsedItems[patient._id] && (
                      <div className="mt-4 pt-4 border-t border-gray-700 flex justify-between items-center">
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleContactar(patient)}
                            disabled={contactingPatient === patient._id || contactedPatients.has(patient._id)}
                            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                          >
                            {contactingPatient === patient._id ? (
                              <>
                                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Contactando...
                              </>
                            ) : contactedPatients.has(patient._id) ? (
                              <>
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                                </svg>
                                Contactado
                              </>
                            ) : (
                              <>
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M20 10.999h2C22 5.869 18.127 2 12.99 2v2C17.052 4 20 6.943 20 10.999z"/>
                                  <path d="M13 8c2.103 0 3 .897 3 3h2c0-3.225-1.775-5-5-5v2zm3.422 5.443a1.001 1.001 0 0 0-1.391.043l-2.393 2.461c-.576-.11-1.734-.471-2.926-1.66-1.192-1.193-1.553-2.354-1.66-2.926l2.459-2.394a1 1 0 0 0 .043-1.391L6.859 3.513a1 1 0 0 0-1.391-.087l-2.17 1.861a1 1 0 0 0-.29.649c-.015.25-.301 6.172 4.291 10.766C11.305 20.707 16.323 21 17.705 21c.202 0 .326-.006.359-.008a.992.992 0 0 0 .648-.291l1.86-2.171a.997.997 0 0 0-.086-1.391l-4.064-3.696z"/>
                                </svg>
                                Contactar
                              </>
                            )}
                          </button>

                          <button
                            onClick={() => handleRellamar(patient)}
                            disabled={recallingPatient === patient._id}
                            className="bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                          >
                            {recallingPatient === patient._id ? (
                              <>
                                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Llamando...
                              </>
                            ) : (
                              <>
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
                                </svg>
                                Rellamar
                              </>
                            )}
                          </button>
                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={() => handleAtender(patient)}
                            disabled={attendingPatient === patient._id}
                            className="bg-[#00a884] text-white px-4 py-2 rounded-lg hover:bg-[#008f6f] transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                          >
                            {attendingPatient === patient._id ? (
                              <>
                                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Abriendo sala...
                              </>
                            ) : (
                              <>
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
                                </svg>
                                Atender
                              </>
                            )}
                          </button>

                          <button
                            onClick={() => handleNoAnswer(patient._id)}
                            className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition text-sm font-medium flex items-center gap-2"
                          >
                            No Contesta
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Paginación */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 mt-6">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 0}
                className="px-4 py-2 bg-[#2a3942] text-white rounded-lg hover:bg-[#3a4952] transition disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ← Anterior
              </button>

              <span className="text-gray-400">
                Página {currentPage + 1} de {totalPages}
              </span>

              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage >= totalPages - 1}
                className="px-4 py-2 bg-[#2a3942] text-white rounded-lg hover:bg-[#3a4952] transition disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Siguiente →
              </button>
            </div>
          )}
        </div>
        </>
        )}

        {panelView === 'agenda' && <AgendaView medicoCode={medicoCode} />}
      </div>

      <AgendarCitaModal
        open={showAgendarModal}
        medicoCode={medicoCode}
        onClose={() => setShowAgendarModal(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['pending-patients', medicoCode] });
          queryClient.invalidateQueries({ queryKey: ['daily-stats', medicoCode] });
        }}
      />
    </div>
  );
}
