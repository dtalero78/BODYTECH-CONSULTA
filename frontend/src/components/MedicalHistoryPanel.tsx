import { useState, useEffect } from 'react';
import apiService from '../services/api.service';
import { PatientHistoryModal } from './PatientHistoryModal';

interface AntecedentesPersonales {
  cirugiaOcular?: boolean;
  cirugiaProgramada?: boolean;
  condicionMedica?: boolean;
  dolorCabeza?: boolean;
  dolorEspalda?: boolean;
  embarazo?: boolean;
  enfermedadHigado?: boolean;
  enfermedadPulmonar?: boolean;
  fuma?: boolean;
  consumoLicor?: boolean;
  hernias?: boolean;
  hormigueos?: boolean;
  presionAlta?: boolean;
  problemasAzucar?: boolean;
  problemasCardiacos?: boolean;
  problemasSueno?: boolean;
  usaAnteojos?: boolean;
  usaLentesContacto?: boolean;
  varices?: boolean;
  hepatitis?: boolean;
  trastornoPsicologico?: boolean;
  sintomasPsicologicos?: boolean;
  diagnosticoCancer?: boolean;
  enfermedadesLaborales?: boolean;
  enfermedadOsteomuscular?: boolean;
  enfermedadAutoinmune?: boolean;
  ruidoJaqueca?: boolean;
}

interface AntecedentesFamiliares {
  hereditarias?: boolean;
  geneticas?: boolean;
  diabetes?: boolean;
  hipertension?: boolean;
  infartos?: boolean;
  cancer?: boolean;
  trastornos?: boolean;
  infecciosas?: boolean;
}

interface MedicalHistoryData {
  historiaId: string;
  numeroId: string;
  primerNombre: string;
  segundoNombre?: string;
  primerApellido: string;
  segundoApellido?: string;
  celular: string;
  email?: string;
  fechaNacimiento?: string;
  edad?: number;
  genero?: string;
  estadoCivil?: string;
  hijos?: string;
  ejercicio?: string;
  codEmpresa?: string;
  cargo?: string;
  tipoExamen?: string;
  encuestaSalud?: string;
  antecedentesFamiliares?: string;
  empresa1?: string;
  antecedentesPersonales?: AntecedentesPersonales;
  antecedentesFamiliaresDetalle?: AntecedentesFamiliares;
  mdAntecedentes?: string;
  mdObsParaMiDocYa?: string;
  mdObservacionesCertificado?: string;
  mdRecomendacionesMedicasAdicionales?: string;
  mdConceptoFinal?: string;
  mdDx1?: string;
  mdDx2?: string;
  talla?: string;
  peso?: string;
  motivoConsulta?: string;
  ciudad?: string;
  eps?: string;
  datosNutricionales?: any;
}

interface MedicalHistoryPanelProps {
  historiaId: string;
  onAppendToObservaciones?: (text: string) => void;
}

const LABS = [
  { key: 'glucosa', label: 'Glucosa' },
  { key: 'hba1c', label: 'HbA1c' },
  { key: 'colesterolTotal', label: 'Colesterol Total' },
  { key: 'ldl', label: 'LDL' },
  { key: 'hdl', label: 'HDL' },
  { key: 'trigliceridos', label: 'Triglicéridos' },
  { key: 'hemoglobina', label: 'Hemoglobina' },
  { key: 'ferritina', label: 'Ferritina' },
  { key: 'vitaminaD', label: 'Vitamina D' },
  { key: 'vitaminaB12', label: 'Vitamina B12' },
];

export const MedicalHistoryPanel = ({ historiaId, onAppendToObservaciones }: MedicalHistoryPanelProps) => {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MedicalHistoryData | null>(null);

  // Campos editables existentes
  const [mdAntecedentes, setMdAntecedentes] = useState('');
  const [mdObsParaMiDocYa, setMdObsParaMiDocYa] = useState('');
  const [mdObservacionesCertificado, setMdObservacionesCertificado] = useState('');
  const [mdRecomendacionesMedicasAdicionales, setMdRecomendacionesMedicasAdicionales] = useState('');
  const [mdConceptoFinal, setMdConceptoFinal] = useState('');
  const [mdDx1, setMdDx1] = useState('');
  const [mdDx2, setMdDx2] = useState('');
  const [talla, setTalla] = useState('');
  const [peso, setPeso] = useState('');
  const [imc, setImc] = useState('');
  const [aiSuggestions, setAiSuggestions] = useState('');
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);

  // Estado para datos nutricionales (JSONB)
  const [datosNutricionales, setDatosNutricionales] = useState<any>({});

  const updateNutri = (field: string, value: string) => {
    setDatosNutricionales((prev: any) => ({ ...prev, [field]: value }));
  };

  useEffect(() => {
    loadMedicalHistory();
  }, [historiaId]);

  // Exponer función para agregar texto a observaciones desde componentes externos
  useEffect(() => {
    if (onAppendToObservaciones) {
      const appendText = (text: string) => {
        setMdObservacionesCertificado(prev => {
          if (prev) {
            return `${prev}\n\n${text}`;
          }
          return text;
        });
      };
      onAppendToObservaciones(appendText as any);
    }
  }, [onAppendToObservaciones]);

  // Calcular IMC automáticamente cuando cambian talla o peso
  useEffect(() => {
    if (talla && peso) {
      const tallaNum = parseFloat(talla);
      const pesoNum = parseFloat(peso);
      if (!isNaN(tallaNum) && !isNaN(pesoNum) && tallaNum > 0) {
        const tallaMetros = tallaNum / 100;
        const imcCalculado = pesoNum / (tallaMetros * tallaMetros);
        setImc(imcCalculado.toFixed(2));
      } else {
        setImc('');
      }
    } else {
      setImc('');
    }
  }, [talla, peso]);

  // Calcular relación cintura/cadera automáticamente
  const relacionCinturaCadera = (() => {
    const cintura = parseFloat(datosNutricionales.circunferenciaCintura || '');
    const cadera = parseFloat(datosNutricionales.circunferenciaCadera || '');
    if (!isNaN(cintura) && !isNaN(cadera) && cadera > 0) {
      return (cintura / cadera).toFixed(2);
    }
    return '';
  })();

  const getRccColor = () => {
    const rcc = parseFloat(relacionCinturaCadera);
    if (isNaN(rcc)) return 'text-gray-400';
    // Riesgo alto: >0.85 mujeres, >0.90 hombres (usamos 0.90 como umbral general)
    if (rcc >= 0.90) return 'text-red-500';
    return 'text-green-400';
  };

  const getImcColor = () => {
    const imcNum = parseFloat(imc);
    if (isNaN(imcNum)) return 'text-gray-400';
    if (imcNum >= 25) return 'text-red-500';
    return 'text-green-400';
  };

  const getImcInterpretation = () => {
    const imcNum = parseFloat(imc);
    if (isNaN(imcNum)) return '';
    if (imcNum < 18.5) return 'Bajo peso';
    if (imcNum < 25) return 'Normal';
    if (imcNum < 30) return 'Sobrepeso';
    return 'Obesidad';
  };

  // --- Cálculos ISAK (Perfil Restringido) ---
  const calcularISAK = () => {
    const edad = data?.edad;
    const genero = data?.genero?.toLowerCase() || '';
    const pesoNum = parseFloat(peso);

    const triceps = parseFloat(datosNutricionales.pliegueTriceps || '');
    const subescapular = parseFloat(datosNutricionales.pliegueSubescapular || '');
    const biceps = parseFloat(datosNutricionales.pliegueBiceps || '');
    const crestaIliaca = parseFloat(datosNutricionales.pliegueCrestaIliaca || '');
    const supraespinal = parseFloat(datosNutricionales.pliegueSupraespinal || '');
    const abdominal = parseFloat(datosNutricionales.pliegueAbdominal || '');
    const musloAnterior = parseFloat(datosNutricionales.pliegueMusloAnterior || '');
    const pantorrilla = parseFloat(datosNutricionales.plieguePantorrilla || '');

    const pliegues = [triceps, subescapular, biceps, crestaIliaca, supraespinal, abdominal, musloAnterior, pantorrilla];
    const pliegues6 = [triceps, subescapular, supraespinal, abdominal, musloAnterior, pantorrilla];

    // Sumatoria 6 pliegues (sin biceps ni cresta iliaca)
    const sum6 = pliegues6.every(v => !isNaN(v)) ? pliegues6.reduce((a, b) => a + b, 0) : NaN;
    // Sumatoria 8 pliegues
    const sum8 = pliegues.every(v => !isNaN(v)) ? pliegues.reduce((a, b) => a + b, 0) : NaN;

    // Faulkner (1968): %G = (Σ4 × 0.153) + 5.783
    // Σ4 = triceps + subescapular + supraespinal + abdominal
    let faulkner = NaN;
    if (!isNaN(triceps) && !isNaN(subescapular) && !isNaN(supraespinal) && !isNaN(abdominal)) {
      const s4f = triceps + subescapular + supraespinal + abdominal;
      faulkner = (s4f * 0.153) + 5.783;
    }

    // Durnin & Womersley (1974): usa log10(Σ4) con coeficientes por edad/sexo
    // Σ4 = biceps + triceps + subescapular + cresta iliaca
    let durninWomersley = NaN;
    if (!isNaN(biceps) && !isNaN(triceps) && !isNaN(subescapular) && !isNaN(crestaIliaca) && edad) {
      const s4dw = biceps + triceps + subescapular + crestaIliaca;
      const logSum = Math.log10(s4dw);
      const esMasculino = genero.includes('masculino') || genero === 'm' || genero === 'male' || genero === 'hombre';
      let dc: number;

      if (esMasculino) {
        if (edad < 20) dc = 1.1620 - (0.0630 * logSum);
        else if (edad < 30) dc = 1.1631 - (0.0632 * logSum);
        else if (edad < 40) dc = 1.1422 - (0.0544 * logSum);
        else if (edad < 50) dc = 1.1620 - (0.0700 * logSum);
        else dc = 1.1715 - (0.0779 * logSum);
      } else {
        if (edad < 20) dc = 1.1549 - (0.0678 * logSum);
        else if (edad < 30) dc = 1.1599 - (0.0717 * logSum);
        else if (edad < 40) dc = 1.1423 - (0.0632 * logSum);
        else if (edad < 50) dc = 1.1333 - (0.0612 * logSum);
        else dc = 1.1339 - (0.0645 * logSum);
      }
      durninWomersley = (495 / dc) - 450;
    }

    // Yuhasz (formula del protocolo Bodytech - usa suma 6 pliegues)
    let yuhasz = NaN;
    if (!isNaN(sum6)) {
      const esMasculino = genero.includes('masculino') || genero === 'm' || genero === 'male' || genero === 'hombre';
      yuhasz = esMasculino
        ? 2.585 + (sum6 * 0.1051)
        : 3.5803 + (sum6 * 0.1548);
    }

    // Masa grasa y masa libre de grasa (prioridad: Yuhasz > Faulkner > Durnin-Womersley)
    const grasaPct = !isNaN(yuhasz) ? yuhasz : !isNaN(faulkner) ? faulkner : !isNaN(durninWomersley) ? durninWomersley : NaN;
    const masaGrasa = !isNaN(grasaPct) && !isNaN(pesoNum) ? (pesoNum * grasaPct / 100) : NaN;
    const masaLibreGrasa = !isNaN(masaGrasa) && !isNaN(pesoNum) ? (pesoNum - masaGrasa) : NaN;

    // --- Somatotipo Heath-Carter ---
    const tallaNum = parseFloat(talla);
    const diametroHumero = parseFloat(datosNutricionales.diametroHumero || '');
    const diametroFemur = parseFloat(datosNutricionales.diametroFemur || '');
    const perimetroBrazoContraido = parseFloat(datosNutricionales.perimetroBrazoContraido || '');
    const perimetroPantorrillaMax = parseFloat(datosNutricionales.perimetroPantorrillaMaxima || '');

    // Endomorfia: requiere triceps + subescapular + supraespinal + talla
    let endomorfia = NaN;
    if (!isNaN(triceps) && !isNaN(subescapular) && !isNaN(supraespinal) && !isNaN(tallaNum) && tallaNum > 0) {
      const X = (triceps + subescapular + supraespinal) * (170.18 / tallaNum);
      endomorfia = -0.7182 + (0.1451 * X) - (0.00068 * X * X) + (0.0000014 * X * X * X);
    }

    // Mesomorfia: requiere DH, DF, PBC (perímetro brazo contraído corregido = brazoContraído - triceps/10),
    // PGC (perímetro pantorrilla corregido = pantorrilla - plieguePantorrilla/10), talla
    let mesomorfia = NaN;
    if (!isNaN(diametroHumero) && !isNaN(diametroFemur) &&
        !isNaN(perimetroBrazoContraido) && !isNaN(triceps) &&
        !isNaN(perimetroPantorrillaMax) && !isNaN(pantorrilla) &&
        !isNaN(tallaNum) && tallaNum > 0) {
      const PBC = perimetroBrazoContraido - (triceps / 10);
      const PGC = perimetroPantorrillaMax - (pantorrilla / 10);
      mesomorfia = (0.858 * diametroHumero) + (0.601 * diametroFemur)
                 + (0.188 * PBC) + (0.161 * PGC)
                 - (tallaNum * 0.131) + 4.5;
    }

    // Ectomorfia: requiere peso, talla (usa índice ponderal IP = talla / peso^(1/3))
    let ectomorfia = NaN;
    if (!isNaN(pesoNum) && !isNaN(tallaNum) && pesoNum > 0 && tallaNum > 0) {
      const IP = tallaNum / Math.cbrt(pesoNum);
      if (IP >= 40.75) ectomorfia = (0.732 * IP) - 28.58;
      else if (IP > 38.25) ectomorfia = (0.463 * IP) - 17.63;
      else ectomorfia = 0.1;
    }

    // Ejes somatocarta
    let ejeX = NaN, ejeY = NaN;
    if (!isNaN(endomorfia) && !isNaN(ectomorfia)) ejeX = ectomorfia - endomorfia;
    if (!isNaN(endomorfia) && !isNaN(mesomorfia) && !isNaN(ectomorfia)) ejeY = (2 * mesomorfia) - endomorfia - ectomorfia;

    // Clasificación del somatotipo dominante
    let clasificacionSomato = '';
    if (!isNaN(endomorfia) && !isNaN(mesomorfia) && !isNaN(ectomorfia)) {
      const e = endomorfia, m = mesomorfia, ec = ectomorfia;
      const diffEM = Math.abs(e - m);
      const diffME = Math.abs(m - ec);
      const diffEE = Math.abs(e - ec);
      const umbral = 0.5;
      if (e > m && e > ec) {
        if (diffEM <= umbral) clasificacionSomato = 'Endo-mesomorfo';
        else if (diffEE <= umbral) clasificacionSomato = 'Endo-ectomorfo';
        else clasificacionSomato = 'Endomorfo';
      } else if (m > e && m > ec) {
        if (diffEM <= umbral) clasificacionSomato = 'Meso-endomorfo';
        else if (diffME <= umbral) clasificacionSomato = 'Meso-ectomorfo';
        else clasificacionSomato = 'Mesomorfo';
      } else if (ec > e && ec > m) {
        if (diffEE <= umbral) clasificacionSomato = 'Ecto-endomorfo';
        else if (diffME <= umbral) clasificacionSomato = 'Ecto-mesomorfo';
        else clasificacionSomato = 'Ectomorfo';
      } else {
        clasificacionSomato = 'Central';
      }
    }

    return {
      sum6: !isNaN(sum6) ? sum6.toFixed(1) : '',
      sum8: !isNaN(sum8) ? sum8.toFixed(1) : '',
      yuhasz: !isNaN(yuhasz) ? yuhasz.toFixed(1) : '',
      faulkner: !isNaN(faulkner) ? faulkner.toFixed(1) : '',
      durninWomersley: !isNaN(durninWomersley) ? durninWomersley.toFixed(1) : '',
      masaGrasa: !isNaN(masaGrasa) ? masaGrasa.toFixed(1) : '',
      masaLibreGrasa: !isNaN(masaLibreGrasa) ? masaLibreGrasa.toFixed(1) : '',
      endomorfia: !isNaN(endomorfia) ? endomorfia.toFixed(1) : '',
      mesomorfia: !isNaN(mesomorfia) ? mesomorfia.toFixed(1) : '',
      ectomorfia: !isNaN(ectomorfia) ? ectomorfia.toFixed(1) : '',
      ejeX: !isNaN(ejeX) ? ejeX.toFixed(2) : '',
      ejeY: !isNaN(ejeY) ? ejeY.toFixed(2) : '',
      clasificacionSomato,
    };
  };

  const isak = calcularISAK();

  // Auto-llenar % grasa con Yuhasz (protocolo Bodytech) o Faulkner como fallback
  useEffect(() => {
    const valor = isak.yuhasz || isak.faulkner;
    if (valor && !datosNutricionales.porcentajeGrasa) {
      updateNutri('porcentajeGrasa', valor);
    }
  }, [isak.yuhasz, isak.faulkner]);

  // Persistir resultados de somatotipo en datosNutricionales
  useEffect(() => {
    if (isak.endomorfia || isak.mesomorfia || isak.ectomorfia) {
      setDatosNutricionales((prev: any) => ({
        ...prev,
        endomorfia: isak.endomorfia,
        mesomorfia: isak.mesomorfia,
        ectomorfia: isak.ectomorfia,
        ejeX: isak.ejeX,
        ejeY: isak.ejeY,
        clasificacionSomato: isak.clasificacionSomato,
      }));
    }
  }, [isak.endomorfia, isak.mesomorfia, isak.ectomorfia]);

  const getGrasaColor = (pct: string) => {
    const val = parseFloat(pct);
    if (isNaN(val)) return 'text-gray-400';
    const genero = data?.genero?.toLowerCase() || '';
    const esMasculino = genero.includes('masculino') || genero === 'm' || genero === 'male' || genero === 'hombre';
    if (esMasculino) {
      if (val < 6) return 'text-yellow-400';
      if (val <= 17) return 'text-green-400';
      if (val <= 25) return 'text-yellow-400';
      return 'text-red-500';
    } else {
      if (val < 14) return 'text-yellow-400';
      if (val <= 24) return 'text-green-400';
      if (val <= 32) return 'text-yellow-400';
      return 'text-red-500';
    }
  };

  const formatFieldName = (fieldName: string): string => {
    const translations: { [key: string]: string } = {
      cirugiaOcular: 'Cirugía Ocular',
      cirugiaProgramada: 'Cirugía Programada',
      condicionMedica: 'Condición Médica',
      dolorCabeza: 'Dolor de Cabeza',
      dolorEspalda: 'Dolor de Espalda',
      embarazo: 'Embarazo',
      enfermedadHigado: 'Enfermedad del Hígado',
      enfermedadPulmonar: 'Enfermedad Pulmonar',
      fuma: 'Fuma',
      consumoLicor: 'Consumo de Licor',
      hernias: 'Hernias',
      hormigueos: 'Hormigueos',
      presionAlta: 'Presión Alta',
      problemasAzucar: 'Problemas de Azúcar',
      problemasCardiacos: 'Problemas Cardíacos',
      problemasSueno: 'Problemas de Sueño',
      usaAnteojos: 'Usa Anteojos',
      usaLentesContacto: 'Usa Lentes de Contacto',
      varices: 'Várices',
      hepatitis: 'Hepatitis',
      trastornoPsicologico: 'Trastorno Psicológico',
      sintomasPsicologicos: 'Síntomas Psicológicos',
      diagnosticoCancer: 'Diagnóstico de Cáncer',
      enfermedadesLaborales: 'Enfermedades Laborales',
      enfermedadOsteomuscular: 'Enfermedad Osteomuscular',
      enfermedadAutoinmune: 'Enfermedad Autoinmune',
      ruidoJaqueca: 'Ruido/Jaqueca',
      hereditarias: 'Enfermedades Hereditarias',
      geneticas: 'Enfermedades Genéticas',
      diabetes: 'Diabetes',
      hipertension: 'Hipertensión',
      infartos: 'Infartos',
      cancer: 'Cáncer',
      trastornos: 'Trastornos',
      infecciosas: 'Enfermedades Infecciosas',
    };
    return translations[fieldName] || fieldName;
  };

  const getPositiveConditions = (): string[] => {
    if (!data) return [];
    const conditions: string[] = [];
    if (data.antecedentesPersonales) {
      Object.entries(data.antecedentesPersonales).forEach(([key, value]) => {
        if (value === true) {
          conditions.push(formatFieldName(key));
        }
      });
    }
    if (data.antecedentesFamiliaresDetalle) {
      Object.entries(data.antecedentesFamiliaresDetalle).forEach(([key, value]) => {
        if (value === true) {
          conditions.push(`Fam: ${formatFieldName(key)}`);
        }
      });
    }
    return conditions;
  };

  const loadMedicalHistory = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const history = await apiService.getMedicalHistory(historiaId);
      setData(history);
      setMdAntecedentes(history.mdAntecedentes || '');
      setMdObsParaMiDocYa(history.mdObsParaMiDocYa || '');
      setMdObservacionesCertificado(history.mdObservacionesCertificado || '');
      setMdRecomendacionesMedicasAdicionales(history.mdRecomendacionesMedicasAdicionales || '');
      setMdConceptoFinal(history.mdConceptoFinal || '');
      setMdDx1(history.mdDx1 || '');
      setMdDx2(history.mdDx2 || '');
      setTalla(history.talla || '');
      setPeso(history.peso || '');
      setDatosNutricionales(history.datosNutricionales || {});
    } catch (err: any) {
      setError(err.message || 'Error al cargar historia clínica');
      console.error('Error loading medical history:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateAISuggestions = async () => {
    if (!data) return;
    try {
      setIsGeneratingAI(true);
      setError(null);
      // Recopilar condiciones positivas de antecedentes
      const condicionesPositivas = getPositiveConditions();

      // Recopilar laboratorios desde datosNutricionales
      const laboratorios: Record<string, string> = {};
      const labKeys = ['glucosa','hba1c','colesterolTotal','ldl','hdl','trigliceridos','hemoglobina','ferritina','vitaminaD','vitaminaB12'];
      labKeys.forEach(key => {
        if (datosNutricionales[`${key}Resultado`]) laboratorios[`${key}Resultado`] = datosNutricionales[`${key}Resultado`];
        if (datosNutricionales[`${key}Fecha`]) laboratorios[`${key}Fecha`] = datosNutricionales[`${key}Fecha`];
      });

      const patientData = {
        // Datos demográficos
        edad: data.edad,
        genero: data.genero,
        estadoCivil: data.estadoCivil,
        hijos: data.hijos,
        ejercicio: data.ejercicio,
        codEmpresa: data.codEmpresa,
        cargo: data.cargo,
        tipoExamen: data.tipoExamen,
        antecedentesFamiliares: data.antecedentesFamiliares,
        encuestaSalud: data.encuestaSalud,
        empresa1: data.empresa1,
        // Antecedentes personales
        condicionesPositivas,
        // Antropometría
        talla,
        peso,
        imc,
        pesoHabitual: datosNutricionales.pesoHabitual,
        circunferenciaCintura: datosNutricionales.circunferenciaCintura,
        circunferenciaCadera: datosNutricionales.circunferenciaCadera,
        porcentajeGrasa: datosNutricionales.porcentajeGrasa,
        masaMuscular: datosNutricionales.masaMuscular,
        // Pliegues ISAK
        pliegueTriceps: datosNutricionales.pliegueTriceps,
        pliegueSubescapular: datosNutricionales.pliegueSubescapular,
        pliegueBiceps: datosNutricionales.pliegueBiceps,
        pliegueCrestaIliaca: datosNutricionales.pliegueCrestaIliaca,
        pliegueSupraespinal: datosNutricionales.pliegueSupraespinal,
        pliegueAbdominal: datosNutricionales.pliegueAbdominal,
        pliegueMusloAnterior: datosNutricionales.pliegueMusloAnterior,
        plieguePantorrilla: datosNutricionales.plieguePantorrilla,
        // Evaluación dietética
        recordatorio24h: datosNutricionales.recordatorio24h,
        numComidasDia: datosNutricionales.numComidasDia,
        consumoAgua: datosNutricionales.consumoAgua,
        preferenciasAlimentarias: datosNutricionales.preferenciasAlimentarias,
        alergiasAlimentarias: datosNutricionales.alergiasAlimentarias,
        suplementos: datosNutricionales.suplementos,
        cambiosPesoRecientes: datosNutricionales.cambiosPesoRecientes,
        // Evaluación clínica
        signosClinicos: datosNutricionales.signosClinicos,
        problemasDigestivos: datosNutricionales.problemasDigestivos,
        masticacionDeglucion: datosNutricionales.masticacionDeglucion,
        // Antecedentes adicionales
        medicamentosActuales: datosNutricionales.medicamentosActuales,
        alergias: datosNutricionales.alergias,
        cirugias: datosNutricionales.cirugias,
        hospitalizaciones: datosNutricionales.hospitalizaciones,
        descripcionEnfermedad: datosNutricionales.descripcionEnfermedad,
        // Laboratorios
        laboratorios: Object.keys(laboratorios).length > 0 ? laboratorios : undefined,
      };
      const suggestions = await apiService.generateAISuggestions(patientData);

      // Extraer campos JSON si la IA los incluyó
      const jsonMatch = suggestions.match(/---JSON_CAMPOS---\s*([\s\S]*?)\s*---FIN_JSON---/);
      let displayText = suggestions;
      if (jsonMatch) {
        // Remover el bloque JSON del texto visible
        displayText = suggestions.replace(/---JSON_CAMPOS---[\s\S]*?---FIN_JSON---/, '').trim();
        try {
          const campos = JSON.parse(jsonMatch[1]);
          const camposAPreLlenar = [
            'diagnosticoNutricional', 'observacionesNutricionales',
            'requerimientoCalorico', 'distribucionMacronutrientes',
            'planAlimentario', 'actividadFisicaPlan', 'recomendacionesNutricionales',
          ];
          setDatosNutricionales((prev: any) => {
            const updates: any = {};
            for (const key of camposAPreLlenar) {
              if (campos[key] && !prev[key]) updates[key] = campos[key];
            }
            return { ...prev, ...updates };
          });
          console.log('✅ Campos nutricionales pre-llenados con IA:', Object.keys(campos));
        } catch (parseErr) {
          console.warn('⚠️ No se pudo parsear JSON de campos IA:', parseErr);
        }
      }

      setAiSuggestions(displayText);
    } catch (err: any) {
      setError(err.message || 'Error al generar sugerencias con IA');
      console.error('Error generating AI suggestions:', err);
      alert('Error al generar sugerencias con IA');
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const handleSave = async () => {
    if (!data) return;

    if (!mdConceptoFinal) {
      alert('Debe seleccionar un Concepto Final antes de guardar.');
      return;
    }

    try {
      setIsSaving(true);
      setError(null);

      const combinedRecommendations = aiSuggestions
        ? `${aiSuggestions}\n\n${mdRecomendacionesMedicasAdicionales}`.trim()
        : mdRecomendacionesMedicasAdicionales;

      let combinedAntecedentes = mdAntecedentes;
      if (imc) {
        const imcText = `IMC: ${imc} (${getImcInterpretation()})`;
        combinedAntecedentes = mdAntecedentes
          ? `${mdAntecedentes}\n\n${imcText}`
          : imcText;
      }

      await apiService.updateMedicalHistory({
        historiaId: data.historiaId,
        mdAntecedentes: combinedAntecedentes,
        mdObsParaMiDocYa,
        mdObservacionesCertificado,
        mdRecomendacionesMedicasAdicionales: combinedRecommendations,
        mdConceptoFinal,
        mdDx1,
        mdDx2,
        talla,
        peso,
        cargo: data.cargo,
        datosNutricionales,
      });

      alert('Historia clínica guardada exitosamente');
    } catch (err: any) {
      setError(err.message || 'Error al guardar historia clínica');
      console.error('Error saving medical history:', err);
      alert('Error al guardar historia clínica');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-[#1f2c34] rounded-xl p-6 text-white">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#00a884]"></div>
          <span className="ml-3">Cargando historia clínica...</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    const isWixNotConfigured = error && error.includes('Error al obtener historia clínica');

    return (
      <div className="h-full flex flex-col bg-[#1f2c34] text-white p-6">
        <div className="mb-4">
          <h2 className="text-xl font-bold text-red-400">Error al Cargar Historia Clínica</h2>
        </div>

        <div className="bg-[#2a3942] rounded-lg p-4 mb-4">
          <p className="text-red-400 mb-3">
            {error || 'No se encontró historia clínica para este paciente'}
          </p>

          {isWixNotConfigured && (
            <div className="mt-4 border-l-4 border-yellow-500 pl-4">
              <p className="text-yellow-400 font-semibold mb-2">Configuración Pendiente</p>
              <p className="text-sm text-gray-300 mb-2">
                Las funciones HTTP de Wix no están configuradas. Para activar esta funcionalidad:
              </p>
              <ol className="text-sm text-gray-300 space-y-1 list-decimal list-inside">
                <li>Abre tu sitio de Wix (www.bsl.com.co)</li>
                <li>Activa el Developer Mode (Velo)</li>
                <li>Ve a Backend → http-functions.js</li>
                <li>Copia las funciones de: <code className="bg-gray-700 px-1 rounded">backend/wix-backend-medical-history.js</code></li>
                <li>Publica el sitio</li>
              </ol>
              <p className="text-sm text-gray-400 mt-3">
                ID de Historia: <span className="text-white font-mono">{historiaId}</span>
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#1f2c34] text-white">
      {/* Header fijo */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700 bg-[#1f2c34] sticky top-0 z-10">
        <h2 className="text-lg font-bold text-[#00a884]">Historia Clínica</h2>
        <div className="flex items-center gap-2">
          {data?.numeroId && (
            <button
              onClick={() => setIsHistoryModalOpen(true)}
              className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition"
              title="Ver consultas anteriores de este paciente"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Historial
            </button>
          )}
          <a
            href={`${import.meta.env.VITE_API_BASE_URL || ''}/api/video/medical-history/${historiaId}/preview`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 bg-[#2a3942] text-[#00a884] text-sm rounded-lg hover:bg-[#344950] border border-[#00a884]/30 transition"
            title="Ver e imprimir historia clínica completa"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Imprimir HC
          </a>
        </div>
      </div>

      {/* Contenido scrollable */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Datos del Paciente (Solo lectura) */}
        <div className="bg-[#2a3942] rounded-lg p-3">
          <h3 className="text-sm font-semibold mb-2 text-[#00a884]">Datos del Paciente</h3>
          <div className="grid grid-cols-1 gap-2 text-xs">
            <div>
              <span className="text-gray-400">Nombre:</span>
              <span className="text-white ml-2">
                {data.primerNombre} {data.segundoNombre} {data.primerApellido} {data.segundoApellido}
              </span>
            </div>
            <div>
              <span className="text-gray-400">Documento:</span>
              <span className="text-white ml-2">{data.numeroId}</span>
            </div>
            <div>
              <span className="text-gray-400">Edad:</span>
              <span className="text-white ml-2">{data.edad || 'N/A'}</span>
            </div>
            <div>
              <span className="text-gray-400">Género:</span>
              <span className="text-white ml-2">{data.genero || 'N/A'}</span>
            </div>
            <div>
              <span className="text-gray-400">Celular:</span>
              <span className="text-white ml-2">{data.celular}</span>
            </div>
            <div>
              <span className="text-gray-400">Email:</span>
              <span className="text-white ml-2">{data.email || 'N/A'}</span>
            </div>
            <div>
              <span className="text-gray-400">Estado Civil:</span>
              <span className="text-white ml-2">{data.estadoCivil || 'N/A'}</span>
            </div>
            <div>
              <span className="text-gray-400">Hijos:</span>
              <span className="text-white ml-2">{data.hijos || 'N/A'}</span>
            </div>
            <div>
              <span className="text-gray-400">Ejercicio:</span>
              <span className="text-white ml-2">{data.ejercicio || 'N/A'}</span>
            </div>
            <div>
              <span className="text-gray-400">Empresa:</span>
              <span className="text-white ml-2">{data.codEmpresa || 'N/A'}</span>
            </div>
            <div>
              <span className="text-gray-400">Cargo:</span>
              <span className="text-white ml-2">{data.cargo || 'N/A'}</span>
            </div>
            <div>
              <span className="text-gray-400">Tipo Examen:</span>
              <span className="text-white ml-2">{data.tipoExamen || 'N/A'}</span>
            </div>
            {data.ciudad && (
              <div>
                <span className="text-gray-400">Ciudad:</span>
                <span className="text-white ml-2">{data.ciudad}</span>
              </div>
            )}
            {data.eps && (
              <div>
                <span className="text-gray-400">EPS:</span>
                <span className="text-white ml-2">{data.eps}</span>
              </div>
            )}
            {data.motivoConsulta && (
              <div>
                <span className="text-gray-400">Motivo de Consulta:</span>
                <p className="text-white mt-1 whitespace-pre-wrap">{data.motivoConsulta}</p>
              </div>
            )}
          </div>
        </div>

        {/* Datos de Atención */}
        <div className="bg-[#2a3942] rounded-lg p-3">
          <h3 className="text-sm font-semibold mb-2 text-[#00a884]">Datos de Atención</h3>
          <div className="space-y-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Tipo de Consulta</label>
              <select
                value={datosNutricionales.tipoConsulta || ''}
                onChange={(e) => updateNutri('tipoConsulta', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
              >
                <option value="">Seleccione</option>
                <option value="Primera vez">Primera vez</option>
                <option value="Control">Control</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Modalidad</label>
              <select
                value={datosNutricionales.modalidad || ''}
                onChange={(e) => updateNutri('modalidad', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
              >
                <option value="">Seleccione</option>
                <option value="Presencial">Presencial</option>
                <option value="Teleconsulta">Teleconsulta</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Registro Profesional</label>
              <input
                type="text"
                value={datosNutricionales.registroProfesional || ''}
                onChange={(e) => updateNutri('registroProfesional', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                placeholder="Número de registro"
              />
            </div>
          </div>
        </div>

        {/* Motivo de Consulta y Objetivo */}
        <div className="bg-[#2a3942] rounded-lg p-3">
          <h3 className="text-sm font-semibold mb-2 text-[#00a884]">Motivo de Consulta y Objetivo</h3>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Tipo de consulta</label>
                <select
                  value={datosNutricionales.tipoConsulta || ''}
                  onChange={(e) => updateNutri('tipoConsulta', e.target.value)}
                  className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                >
                  <option value="">Seleccione</option>
                  <option value="Primera vez">Primera vez</option>
                  <option value="Control">Control</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Objetivo principal</label>
                <select
                  value={datosNutricionales.objetivoPrincipal || ''}
                  onChange={(e) => updateNutri('objetivoPrincipal', e.target.value)}
                  className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                >
                  <option value="">Seleccione</option>
                  <option value="Pérdida de grasa">Pérdida de grasa</option>
                  <option value="Ganancia de masa muscular">Ganancia de masa muscular</option>
                  <option value="Rendimiento deportivo">Rendimiento deportivo</option>
                  <option value="Salud general">Salud general</option>
                  <option value="Otro">Otro</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Motivo de consulta</label>
              <textarea
                value={datosNutricionales.motivoConsultaTexto || ''}
                onChange={(e) => updateNutri('motivoConsultaTexto', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={2}
                placeholder="Motivo de la consulta..."
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Objetivos específicos</label>
              <textarea
                value={datosNutricionales.objetivosEspecificos || ''}
                onChange={(e) => updateNutri('objetivosEspecificos', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={2}
                placeholder="Metas específicas del paciente..."
              />
            </div>
          </div>
        </div>

        {/* Actividad Física y Contexto Deportivo */}
        <div className="bg-[#2a3942] rounded-lg p-3">
          <h3 className="text-sm font-semibold mb-2 text-[#00a884]">Actividad Física y Contexto Deportivo</h3>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-400 mb-1">¿Realiza actividad física?</label>
                <select
                  value={datosNutricionales.realizaActividadFisica || ''}
                  onChange={(e) => updateNutri('realizaActividadFisica', e.target.value)}
                  className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                >
                  <option value="">Seleccione</option>
                  <option value="Sí">Sí</option>
                  <option value="No">No</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Frecuencia (veces/semana)</label>
                <input
                  type="text"
                  value={datosNutricionales.frecuenciaEjercicio || ''}
                  onChange={(e) => updateNutri('frecuenciaEjercicio', e.target.value)}
                  className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                  placeholder="Ej: 3"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Tipo de entrenamiento</label>
                <select
                  value={datosNutricionales.tipoEntrenamiento || ''}
                  onChange={(e) => updateNutri('tipoEntrenamiento', e.target.value)}
                  className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                >
                  <option value="">Seleccione</option>
                  <option value="Fuerza">Fuerza</option>
                  <option value="Cardio">Cardio</option>
                  <option value="Mixto">Mixto</option>
                  <option value="Otro">Otro</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Intensidad percibida</label>
                <select
                  value={datosNutricionales.intensidadPercibida || ''}
                  onChange={(e) => updateNutri('intensidadPercibida', e.target.value)}
                  className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                >
                  <option value="">Seleccione</option>
                  <option value="Baja">Baja</option>
                  <option value="Media">Media</option>
                  <option value="Alta">Alta</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Horario habitual</label>
                <select
                  value={datosNutricionales.horarioEjercicio || ''}
                  onChange={(e) => updateNutri('horarioEjercicio', e.target.value)}
                  className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                >
                  <option value="">Seleccione</option>
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                  <option value="Mixto">Mixto</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Estilo de Vida */}
        <div className="bg-[#2a3942] rounded-lg p-3">
          <h3 className="text-sm font-semibold mb-2 text-[#00a884]">Estilo de Vida</h3>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Horas de sueño</label>
              <input
                type="text"
                value={datosNutricionales.horasSueno || ''}
                onChange={(e) => updateNutri('horasSueno', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                placeholder="Ej: 7"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Calidad del sueño</label>
              <select
                value={datosNutricionales.calidadSueno || ''}
                onChange={(e) => updateNutri('calidadSueno', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
              >
                <option value="">Seleccione</option>
                <option value="Buena">Buena</option>
                <option value="Regular">Regular</option>
                <option value="Mala">Mala</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Nivel de estrés</label>
              <select
                value={datosNutricionales.nivelEstres || ''}
                onChange={(e) => updateNutri('nivelEstres', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
              >
                <option value="">Seleccione</option>
                <option value="Bajo">Bajo</option>
                <option value="Medio">Medio</option>
                <option value="Alto">Alto</option>
              </select>
            </div>
          </div>
        </div>

        {/* Enfermedad Actual */}
        <div className="bg-[#2a3942] rounded-lg p-3">
          <h3 className="text-sm font-semibold mb-2 text-[#00a884]">Enfermedad Actual</h3>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Descripción</label>
            <textarea
              value={datosNutricionales.descripcionEnfermedad || ''}
              onChange={(e) => updateNutri('descripcionEnfermedad', e.target.value)}
              className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
              rows={3}
              placeholder="Descripción de la enfermedad actual..."
            />
          </div>
        </div>

        {/* Condiciones Especiales (antecedentes positivos del formulario) */}
        {getPositiveConditions().length > 0 && (
          <div className="bg-[#2a3942] rounded-lg p-3">
            <h3 className="text-sm font-semibold mb-2 text-[#00a884]">Condiciones Especiales</h3>
            <div className="flex flex-wrap gap-2">
              {getPositiveConditions().map((condition, index) => (
                <span
                  key={index}
                  className={`px-3 py-1 rounded-full text-xs font-medium ${
                    condition.startsWith('Fam:')
                      ? 'bg-purple-900/30 text-purple-300 border border-purple-500/30'
                      : 'bg-amber-900/30 text-amber-300 border border-amber-500/30'
                  }`}
                >
                  {condition}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Antecedentes (Solo lectura) */}
        {(data.antecedentesFamiliares || data.encuestaSalud || data.empresa1) && (
          <div className="bg-[#2a3942] rounded-lg p-3">
            <h3 className="text-sm font-semibold mb-2 text-[#00a884]">Antecedentes</h3>
            <div className="space-y-2 text-xs">
              {data.antecedentesFamiliares && (
                <div>
                  <span className="text-gray-400">Antecedentes Familiares:</span>
                  <p className="text-white mt-1 whitespace-pre-wrap">{data.antecedentesFamiliares}</p>
                </div>
              )}
              {data.encuestaSalud && (
                <div>
                  <span className="text-gray-400">Encuesta de Salud:</span>
                  <p className="text-white mt-1 whitespace-pre-wrap">{data.encuestaSalud}</p>
                </div>
              )}
              {data.empresa1 && (
                <div>
                  <span className="text-gray-400">Cargo Anterior:</span>
                  <p className="text-white mt-1">{data.empresa1}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Antecedentes Adicionales */}
        <div className="bg-[#2a3942] rounded-lg p-3">
          <h3 className="text-sm font-semibold mb-2 text-[#00a884]">Antecedentes Adicionales</h3>
          <div className="space-y-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Medicamentos Actuales</label>
              <textarea
                value={datosNutricionales.medicamentosActuales || ''}
                onChange={(e) => updateNutri('medicamentosActuales', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={2}
                placeholder="Medicamentos que toma actualmente..."
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Alergias</label>
              <textarea
                value={datosNutricionales.alergias || ''}
                onChange={(e) => updateNutri('alergias', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={2}
                placeholder="Alergias conocidas..."
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Cirugías</label>
              <textarea
                value={datosNutricionales.cirugias || ''}
                onChange={(e) => updateNutri('cirugias', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={2}
                placeholder="Cirugías previas..."
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Hospitalizaciones</label>
              <textarea
                value={datosNutricionales.hospitalizaciones || ''}
                onChange={(e) => updateNutri('hospitalizaciones', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={2}
                placeholder="Hospitalizaciones previas..."
              />
            </div>
          </div>
        </div>

        {/* Medidas Físicas */}
        <div className="bg-[#2a3942] rounded-lg p-3">
          <h3 className="text-sm font-semibold mb-2 text-[#00a884]">Medidas Físicas</h3>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Talla (cm)</label>
              <input
                type="text"
                value={talla}
                onChange={(e) => setTalla(e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                placeholder="170"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Peso (kg)</label>
              <input
                type="text"
                value={peso}
                onChange={(e) => setPeso(e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                placeholder="70"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">IMC</label>
              <input
                type="text"
                value={imc ? `${imc} (${getImcInterpretation()})` : ''}
                readOnly
                className={`w-full bg-[#2a3942] ${getImcColor()} text-sm px-2 py-2 rounded border border-gray-600 cursor-not-allowed font-semibold`}
                placeholder="Auto"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Peso Habitual (kg)</label>
              <input
                type="text"
                value={datosNutricionales.pesoHabitual || ''}
                onChange={(e) => updateNutri('pesoHabitual', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                placeholder="Ej: 75"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">% Grasa Corporal</label>
              <input
                type="text"
                value={datosNutricionales.porcentajeGrasa || ''}
                onChange={(e) => updateNutri('porcentajeGrasa', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                placeholder="Ej: 25"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Masa Muscular (kg)</label>
              <input
                type="text"
                value={datosNutricionales.masaMuscular || ''}
                onChange={(e) => updateNutri('masaMuscular', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                placeholder="Ej: 45"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Cintura (cm)</label>
              <input
                type="text"
                value={datosNutricionales.circunferenciaCintura || ''}
                onChange={(e) => updateNutri('circunferenciaCintura', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                placeholder="Ej: 80"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Cadera (cm)</label>
              <input
                type="text"
                value={datosNutricionales.circunferenciaCadera || ''}
                onChange={(e) => updateNutri('circunferenciaCadera', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                placeholder="Ej: 95"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Rel. Cin/Cad</label>
              <input
                type="text"
                value={relacionCinturaCadera}
                readOnly
                className={`w-full bg-[#2a3942] ${getRccColor()} text-sm px-2 py-2 rounded border border-gray-600 cursor-not-allowed font-semibold`}
                placeholder="Auto"
              />
            </div>
          </div>
        </div>

        {/* Pliegues Cutáneos - ISAK */}
        <div className="bg-[#2a3942] rounded-lg p-3">
          <h3 className="text-sm font-semibold mb-2 text-[#00a884]">Pliegues Cutaneos - ISAK</h3>
          {!data?.edad || !data?.genero ? (
            <p className="text-xs text-yellow-400 mb-2">Se requiere edad y genero del paciente para los calculos ISAK.</p>
          ) : null}
          <div className="grid grid-cols-4 gap-2 mb-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Triceps (mm)</label>
              <input
                type="text"
                value={datosNutricionales.pliegueTriceps || ''}
                onChange={(e) => updateNutri('pliegueTriceps', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                placeholder="mm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Subescapular (mm)</label>
              <input
                type="text"
                value={datosNutricionales.pliegueSubescapular || ''}
                onChange={(e) => updateNutri('pliegueSubescapular', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                placeholder="mm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Biceps (mm)</label>
              <input
                type="text"
                value={datosNutricionales.pliegueBiceps || ''}
                onChange={(e) => updateNutri('pliegueBiceps', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                placeholder="mm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Cresta Iliaca (mm)</label>
              <input
                type="text"
                value={datosNutricionales.pliegueCrestaIliaca || ''}
                onChange={(e) => updateNutri('pliegueCrestaIliaca', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                placeholder="mm"
              />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 mb-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Supraespinal (mm)</label>
              <input
                type="text"
                value={datosNutricionales.pliegueSupraespinal || ''}
                onChange={(e) => updateNutri('pliegueSupraespinal', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                placeholder="mm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Abdominal (mm)</label>
              <input
                type="text"
                value={datosNutricionales.pliegueAbdominal || ''}
                onChange={(e) => updateNutri('pliegueAbdominal', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                placeholder="mm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Muslo Anterior (mm)</label>
              <input
                type="text"
                value={datosNutricionales.pliegueMusloAnterior || ''}
                onChange={(e) => updateNutri('pliegueMusloAnterior', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                placeholder="mm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Pantorrilla (mm)</label>
              <input
                type="text"
                value={datosNutricionales.plieguePantorrilla || ''}
                onChange={(e) => updateNutri('plieguePantorrilla', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                placeholder="mm"
              />
            </div>
          </div>
          {/* Perímetros ISAK */}
          <p className="text-xs text-gray-400 mb-1 font-semibold mt-2">Perímetros (cm)</p>
          <div className="grid grid-cols-5 gap-2 mb-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Brazo Relajado</label>
              <input
                type="text"
                value={datosNutricionales.perimetroBrazoRelajado || ''}
                onChange={(e) => updateNutri('perimetroBrazoRelajado', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                placeholder="cm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Brazo Contraído</label>
              <input
                type="text"
                value={datosNutricionales.perimetroBrazoContraido || ''}
                onChange={(e) => updateNutri('perimetroBrazoContraido', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                placeholder="cm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Cintura Mínima</label>
              <input
                type="text"
                value={datosNutricionales.perimetroCinturaMinima || ''}
                onChange={(e) => updateNutri('perimetroCinturaMinima', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                placeholder="cm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Cadera Máxima</label>
              <input
                type="text"
                value={datosNutricionales.perimetroCaderaMaxima || ''}
                onChange={(e) => updateNutri('perimetroCaderaMaxima', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                placeholder="cm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Pantorrilla Máx.</label>
              <input
                type="text"
                value={datosNutricionales.perimetroPantorrillaMaxima || ''}
                onChange={(e) => updateNutri('perimetroPantorrillaMaxima', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                placeholder="cm"
              />
            </div>
          </div>
          {/* Diámetros óseos (para somatotipo Heath-Carter) */}
          <p className="text-xs text-gray-400 mb-1 font-semibold">Diámetros óseos (cm)</p>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Diámetro Húmero (biepicondíleo)</label>
              <input
                type="text"
                value={datosNutricionales.diametroHumero || ''}
                onChange={(e) => updateNutri('diametroHumero', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                placeholder="cm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Diámetro Fémur (biepicondíleo)</label>
              <input
                type="text"
                value={datosNutricionales.diametroFemur || ''}
                onChange={(e) => updateNutri('diametroFemur', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                placeholder="cm"
              />
            </div>
          </div>
          {/* Resultados ISAK calculados */}
          {(isak.sum6 || isak.sum8 || isak.yuhasz || isak.faulkner || isak.durninWomersley) && (
            <div className="bg-[#1a2530] rounded p-2 border border-gray-700">
              <p className="text-xs text-gray-400 mb-1 font-semibold">Resultados ISAK</p>
              <div className="grid grid-cols-3 gap-2 mb-1">
                {isak.sum6 && (
                  <div className="text-center">
                    <span className="block text-xs text-gray-400">Suma 6 pliegues</span>
                    <span className="text-sm text-white font-semibold">{isak.sum6} mm</span>
                  </div>
                )}
                {isak.sum8 && (
                  <div className="text-center">
                    <span className="block text-xs text-gray-400">Suma 8 pliegues</span>
                    <span className="text-sm text-white font-semibold">{isak.sum8} mm</span>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 mb-1">
                {isak.yuhasz && (
                  <div className="text-center">
                    <span className="block text-xs text-gray-400">% Grasa (Yuhasz)</span>
                    <span className={`text-sm font-semibold ${getGrasaColor(isak.yuhasz)}`}>{isak.yuhasz}%</span>
                  </div>
                )}
                {isak.faulkner && (
                  <div className="text-center">
                    <span className="block text-xs text-gray-400">% Grasa (Faulkner)</span>
                    <span className={`text-sm font-semibold ${getGrasaColor(isak.faulkner)}`}>{isak.faulkner}%</span>
                  </div>
                )}
                {isak.durninWomersley && (
                  <div className="text-center">
                    <span className="block text-xs text-gray-400">% Grasa (D-W)</span>
                    <span className={`text-sm font-semibold ${getGrasaColor(isak.durninWomersley)}`}>{isak.durninWomersley}%</span>
                  </div>
                )}
              </div>
              {(isak.masaGrasa || isak.masaLibreGrasa) && (
                <div className="grid grid-cols-2 gap-2">
                  {isak.masaGrasa && (
                    <div className="text-center">
                      <span className="block text-xs text-gray-400">Masa Grasa</span>
                      <span className="text-sm text-white font-semibold">{isak.masaGrasa} kg</span>
                    </div>
                  )}
                  {isak.masaLibreGrasa && (
                    <div className="text-center">
                      <span className="block text-xs text-gray-400">Masa Libre de Grasa</span>
                      <span className="text-sm text-white font-semibold">{isak.masaLibreGrasa} kg</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {/* Somatotipo Heath-Carter */}
          {(isak.endomorfia || isak.mesomorfia || isak.ectomorfia) && (
            <div className="bg-[#1a2530] rounded p-2 border border-gray-700 mt-2">
              <p className="text-xs text-gray-400 mb-1 font-semibold">Somatotipo (Heath-Carter)</p>
              <div className="grid grid-cols-3 gap-2 mb-2">
                <div className="text-center bg-[#2a3942] rounded p-1">
                  <span className="block text-xs text-gray-400">Endomorfia</span>
                  <span className="text-sm text-amber-400 font-semibold">{isak.endomorfia || '—'}</span>
                </div>
                <div className="text-center bg-[#2a3942] rounded p-1">
                  <span className="block text-xs text-gray-400">Mesomorfia</span>
                  <span className="text-sm text-green-400 font-semibold">{isak.mesomorfia || '—'}</span>
                </div>
                <div className="text-center bg-[#2a3942] rounded p-1">
                  <span className="block text-xs text-gray-400">Ectomorfia</span>
                  <span className="text-sm text-blue-400 font-semibold">{isak.ectomorfia || '—'}</span>
                </div>
              </div>
              {(isak.ejeX || isak.ejeY || isak.clasificacionSomato) && (
                <div className="grid grid-cols-3 gap-2">
                  {isak.ejeX && (
                    <div className="text-center">
                      <span className="block text-xs text-gray-400">Eje X</span>
                      <span className="text-sm text-white font-semibold">{isak.ejeX}</span>
                    </div>
                  )}
                  {isak.ejeY && (
                    <div className="text-center">
                      <span className="block text-xs text-gray-400">Eje Y</span>
                      <span className="text-sm text-white font-semibold">{isak.ejeY}</span>
                    </div>
                  )}
                  {isak.clasificacionSomato && (
                    <div className="text-center">
                      <span className="block text-xs text-gray-400">Clasificación</span>
                      <span className="text-sm text-[#00a884] font-semibold">{isak.clasificacionSomato}</span>
                    </div>
                  )}
                </div>
              )}
              {isak.endomorfia && isak.mesomorfia && isak.ectomorfia && (
                <p className="text-xs text-gray-500 mt-2 text-center">
                  Somatocarta: {isak.endomorfia} - {isak.mesomorfia} - {isak.ectomorfia}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Evaluación Dietética */}
        <div className="bg-[#2a3942] rounded-lg p-3">
          <h3 className="text-sm font-semibold mb-2 text-[#00a884]">Evaluación Dietética</h3>
          <div className="space-y-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Recordatorio 24 horas</label>
              <textarea
                value={datosNutricionales.recordatorio24h || ''}
                onChange={(e) => updateNutri('recordatorio24h', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={3}
                placeholder="Descripción de lo consumido en las últimas 24 horas..."
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Número de comidas/día</label>
                <input
                  type="text"
                  value={datosNutricionales.numComidasDia || ''}
                  onChange={(e) => updateNutri('numComidasDia', e.target.value)}
                  className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                  placeholder="Ej: 3"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Consumo de agua (L/día)</label>
                <input
                  type="text"
                  value={datosNutricionales.consumoAgua || ''}
                  onChange={(e) => updateNutri('consumoAgua', e.target.value)}
                  className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                  placeholder="Ej: 2"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Preferencias Alimentarias</label>
              <textarea
                value={datosNutricionales.preferenciasAlimentarias || ''}
                onChange={(e) => updateNutri('preferenciasAlimentarias', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={2}
                placeholder="Alimentos preferidos, restricciones culturales o religiosas..."
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Alergias Alimentarias</label>
              <textarea
                value={datosNutricionales.alergiasAlimentarias || ''}
                onChange={(e) => updateNutri('alergiasAlimentarias', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={2}
                placeholder="Alergias o intolerancias alimentarias..."
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Suplementos</label>
              <textarea
                value={datosNutricionales.suplementos || ''}
                onChange={(e) => updateNutri('suplementos', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={2}
                placeholder="Suplementos vitamínicos o minerales que consume..."
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Cambios de Peso Recientes</label>
              <textarea
                value={datosNutricionales.cambiosPesoRecientes || ''}
                onChange={(e) => updateNutri('cambiosPesoRecientes', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={2}
                placeholder="Cambios de peso en los últimos meses..."
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Horarios de comida</label>
                <input
                  type="text"
                  value={datosNutricionales.horariosComida || ''}
                  onChange={(e) => updateNutri('horariosComida', e.target.value)}
                  className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                  placeholder="Ej: 7-12-19"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Consumo de alcohol</label>
                <select
                  value={datosNutricionales.consumoAlcohol || ''}
                  onChange={(e) => updateNutri('consumoAlcohol', e.target.value)}
                  className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                >
                  <option value="">Seleccione</option>
                  <option value="Sí">Sí</option>
                  <option value="No">No</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Frecuencia alcohol</label>
                <input
                  type="text"
                  value={datosNutricionales.frecuenciaAlcohol || ''}
                  onChange={(e) => updateNutri('frecuenciaAlcohol', e.target.value)}
                  className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                  placeholder="Ej: fines de semana"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Anamnesis Alimentaria */}
        <div className="bg-[#2a3942] rounded-lg p-3">
          <h3 className="text-sm font-semibold mb-2 text-[#00a884]">Anamnesis Alimentaria</h3>
          <p className="text-xs text-gray-400 mb-2 font-semibold">Entre semana</p>
          <div className="space-y-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Desayuno</label>
              <textarea
                value={datosNutricionales.anamnesisDesayuno || ''}
                onChange={(e) => updateNutri('anamnesisDesayuno', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={2}
                placeholder="Descripción del desayuno típico..."
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Media mañana</label>
              <textarea
                value={datosNutricionales.anamnesisMediaManana || ''}
                onChange={(e) => updateNutri('anamnesisMediaManana', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={2}
                placeholder="Snack de media mañana..."
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Almuerzo</label>
              <textarea
                value={datosNutricionales.anamnesisAlmuerzo || ''}
                onChange={(e) => updateNutri('anamnesisAlmuerzo', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={2}
                placeholder="Descripción del almuerzo típico..."
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Media tarde</label>
              <textarea
                value={datosNutricionales.anamnesisMediaTarde || ''}
                onChange={(e) => updateNutri('anamnesisMediaTarde', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={2}
                placeholder="Snack de media tarde..."
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Cena</label>
              <textarea
                value={datosNutricionales.anamnesisCena || ''}
                onChange={(e) => updateNutri('anamnesisCena', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={2}
                placeholder="Descripción de la cena típica..."
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Fin de semana</label>
              <textarea
                value={datosNutricionales.anamnesisFinSemana || ''}
                onChange={(e) => updateNutri('anamnesisFinSemana', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={2}
                placeholder="Descripción general de alimentación fin de semana..."
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Alimentos preferidos</label>
                <textarea
                  value={datosNutricionales.alimentosPreferidos || ''}
                  onChange={(e) => updateNutri('alimentosPreferidos', e.target.value)}
                  className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                  rows={2}
                  placeholder="Alimentos que le gustan..."
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Alimentos rechazados</label>
                <textarea
                  value={datosNutricionales.alimentosRechazados || ''}
                  onChange={(e) => updateNutri('alimentosRechazados', e.target.value)}
                  className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                  rows={2}
                  placeholder="Alimentos que rechaza..."
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Intolerancias</label>
              <textarea
                value={datosNutricionales.intoleranciasAlimentarias || ''}
                onChange={(e) => updateNutri('intoleranciasAlimentarias', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={2}
                placeholder="Intolerancias alimentarias (lactosa, gluten, etc.)..."
              />
            </div>
          </div>
        </div>

        {/* Evaluación Clínica Nutricional */}
        <div className="bg-[#2a3942] rounded-lg p-3">
          <h3 className="text-sm font-semibold mb-2 text-[#00a884]">Evaluación Clínica Nutricional</h3>
          <div className="space-y-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Signos Clínicos</label>
              <textarea
                value={datosNutricionales.signosClinicos || ''}
                onChange={(e) => updateNutri('signosClinicos', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={2}
                placeholder="Signos clínicos observados..."
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Problemas Digestivos</label>
              <textarea
                value={datosNutricionales.problemasDigestivos || ''}
                onChange={(e) => updateNutri('problemasDigestivos', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={2}
                placeholder="Síntomas digestivos: náuseas, estreñimiento, diarrea..."
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Masticación y Deglución</label>
              <textarea
                value={datosNutricionales.masticacionDeglucion || ''}
                onChange={(e) => updateNutri('masticacionDeglucion', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={2}
                placeholder="Dificultades para masticar o tragar..."
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Observaciones Nutricionales</label>
              <textarea
                value={datosNutricionales.observacionesNutricionales || ''}
                onChange={(e) => updateNutri('observacionesNutricionales', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={3}
                placeholder="Observaciones clínicas nutricionales adicionales..."
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Análisis de composición corporal</label>
              <textarea
                value={datosNutricionales.analisisComposicionCorporal || ''}
                onChange={(e) => updateNutri('analisisComposicionCorporal', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={2}
                placeholder="Análisis de masa grasa, masa muscular, distribución..."
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Identificación de riesgos</label>
              <textarea
                value={datosNutricionales.identificacionRiesgos || ''}
                onChange={(e) => updateNutri('identificacionRiesgos', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={2}
                placeholder="Riesgos cardiovascular, metabólico, nutricional..."
              />
            </div>
          </div>
        </div>

        {/* Plan de Intervención */}
        <div className="bg-[#2a3942] rounded-lg p-3">
          <h3 className="text-sm font-semibold mb-2 text-[#00a884]">Plan de Intervención</h3>
          <div className="space-y-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Objetivo nutricional definido</label>
              <textarea
                value={datosNutricionales.objetivoNutricional || ''}
                onChange={(e) => updateNutri('objetivoNutricional', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={2}
                placeholder="Objetivo nutricional específico y medible..."
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Estrategia alimentaria</label>
              <textarea
                value={datosNutricionales.estrategiaAlimentaria || ''}
                onChange={(e) => updateNutri('estrategiaAlimentaria', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={2}
                placeholder="Estrategia alimentaria propuesta..."
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Recomendaciones generales</label>
              <textarea
                value={datosNutricionales.recomendacionesGenerales || ''}
                onChange={(e) => updateNutri('recomendacionesGenerales', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={2}
                placeholder="Recomendaciones nutricionales generales..."
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Suplementación sugerida</label>
              <textarea
                value={datosNutricionales.suplementacionSugerida || ''}
                onChange={(e) => updateNutri('suplementacionSugerida', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={2}
                placeholder="Suplementos recomendados con dosis..."
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Recomendaciones de hidratación</label>
              <textarea
                value={datosNutricionales.recomendacionesHidratacion || ''}
                onChange={(e) => updateNutri('recomendacionesHidratacion', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={2}
                placeholder="Cantidad y tipo de líquidos recomendados..."
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Recomendaciones de estilo de vida</label>
              <textarea
                value={datosNutricionales.recomendacionesEstiloVida || ''}
                onChange={(e) => updateNutri('recomendacionesEstiloVida', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={2}
                placeholder="Sueño, actividad física, manejo del estrés..."
              />
            </div>
          </div>
        </div>

        {/* Seguimiento */}
        <div className="bg-[#2a3942] rounded-lg p-3">
          <h3 className="text-sm font-semibold mb-2 text-[#00a884]">Seguimiento</h3>
          <div className="space-y-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Fecha próxima cita</label>
              <input
                type="date"
                value={datosNutricionales.fechaProximaCita || ''}
                onChange={(e) => updateNutri('fechaProximaCita', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Indicadores a monitorear</label>
              <div className="grid grid-cols-5 gap-1">
                {['Peso', '% grasa', 'Medidas', 'Adherencia', 'Rendimiento'].map(ind => {
                  const key = `indicador_${ind.replace(/[^a-zA-Z]/g, '')}`;
                  return (
                    <label key={ind} className="flex items-center gap-1 text-xs text-white cursor-pointer bg-[#1f2c34] px-2 py-1 rounded border border-gray-600">
                      <input
                        type="checkbox"
                        checked={datosNutricionales[key] || false}
                        onChange={(e) => setDatosNutricionales((prev: any) => ({ ...prev, [key]: e.target.checked }))}
                        className="accent-[#00a884]"
                      />
                      {ind}
                    </label>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Observaciones de seguimiento</label>
              <textarea
                value={datosNutricionales.observacionesSeguimiento || ''}
                onChange={(e) => updateNutri('observacionesSeguimiento', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={2}
                placeholder="Observaciones para próxima consulta..."
              />
            </div>
          </div>
        </div>

        {/* Laboratorios */}
        <div className="bg-[#2a3942] rounded-lg p-3">
          <h3 className="text-sm font-semibold mb-2 text-[#00a884]">Laboratorios</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b border-gray-600">
                  <th className="text-left pb-2 pr-2">Examen</th>
                  <th className="text-left pb-2 pr-2">Resultado</th>
                  <th className="text-left pb-2">Fecha</th>
                </tr>
              </thead>
              <tbody className="space-y-1">
                {LABS.map(({ key, label }) => (
                  <tr key={key} className="border-b border-gray-700/50">
                    <td className="py-1 pr-2 text-gray-300 whitespace-nowrap">{label}</td>
                    <td className="py-1 pr-2">
                      <input
                        type="text"
                        value={datosNutricionales[`${key}Resultado`] || ''}
                        onChange={(e) => updateNutri(`${key}Resultado`, e.target.value)}
                        className="w-full bg-[#1f2c34] text-white text-xs px-2 py-1 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                        placeholder="Resultado"
                      />
                    </td>
                    <td className="py-1">
                      <input
                        type="text"
                        value={datosNutricionales[`${key}Fecha`] || ''}
                        onChange={(e) => updateNutri(`${key}Fecha`, e.target.value)}
                        className="w-full bg-[#1f2c34] text-white text-xs px-2 py-1 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                        placeholder="dd/mm/aaaa"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Campos Médicos Editables */}
        <div className="bg-[#2a3942] rounded-lg p-3">
          <h3 className="text-sm font-semibold mb-3 text-[#00a884]">Evaluación Médica</h3>
          <div className="space-y-3">

            {/* 1. ANTECEDENTES */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Antecedentes</label>
              <textarea
                value={mdAntecedentes}
                onChange={(e) => setMdAntecedentes(e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={3}
                placeholder="Antecedentes médicos relevantes..."
              />
            </div>

            {/* 2. OBS. CERTIFICADO */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Obs. Certificado</label>
              <textarea
                value={mdObservacionesCertificado}
                onChange={(e) => setMdObservacionesCertificado(e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={3}
                placeholder="Observaciones para el certificado..."
              />
            </div>

            {/* 3. RECOMENDACIONES MÉDICAS ADICIONALES */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Recomendaciones Médicas Adicionales</label>
              <textarea
                value={mdRecomendacionesMedicasAdicionales}
                onChange={(e) => setMdRecomendacionesMedicasAdicionales(e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={3}
                placeholder="Recomendaciones médicas adicionales..."
              />
            </div>

            {/* 4. OBSERVACIONES PRIVADAS PARA LA EMPRESA */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Observaciones privadas para la empresa</label>
              <textarea
                value={mdObsParaMiDocYa}
                onChange={(e) => setMdObsParaMiDocYa(e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={3}
                placeholder="Observaciones privadas para la empresa..."
              />
            </div>

            {/* 5. DIAGNÓSTICOS */}
            <div className="grid grid-cols-1 gap-2">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Diagnóstico 1 (Principal)</label>
                <select
                  value={mdDx1}
                  onChange={(e) => setMdDx1(e.target.value)}
                  className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                >
                  <option value="">Seleccione diagnóstico</option>
                  <option value="Asma ocupacional">Asma ocupacional</option>
                  <option value="Bronquitis crónica por polvos inorgánicos">Bronquitis crónica por polvos inorgánicos</option>
                  <option value="Bursitis de codo">Bursitis de codo</option>
                  <option value="Bursitis de hombro">Bursitis de hombro</option>
                  <option value="Bursitis de rodilla">Bursitis de rodilla</option>
                  <option value="Cervicalgia">Cervicalgia</option>
                  <option value="Dermatitis alérgica de contacto">Dermatitis alérgica de contacto</option>
                  <option value="Dermatitis irritativa de contacto">Dermatitis irritativa de contacto</option>
                  <option value="Dorsalgia">Dorsalgia</option>
                  <option value="Epicondilitis lateral (codo de tenista)">Epicondilitis lateral (codo de tenista)</option>
                  <option value="Epicondilitis medial">Epicondilitis medial</option>
                  <option value="Escoliosis">Escoliosis</option>
                  <option value="Espondiloartrosis cervical">Espondiloartrosis cervical</option>
                  <option value="Espondiloartrosis lumbar">Espondiloartrosis lumbar</option>
                  <option value="Espondilosis cervical">Espondilosis cervical</option>
                  <option value="Espondilosis lumbar">Espondilosis lumbar</option>
                  <option value="Estrés postraumático">Estrés postraumático</option>
                  <option value="Gonalgia (dolor de rodilla)">Gonalgia (dolor de rodilla)</option>
                  <option value="Hernia discal cervical">Hernia discal cervical</option>
                  <option value="Hernia discal lumbar">Hernia discal lumbar</option>
                  <option value="Hipoacusia neurosensorial bilateral">Hipoacusia neurosensorial bilateral</option>
                  <option value="Lumbalgia">Lumbalgia</option>
                  <option value="Mialgia">Mialgia</option>
                  <option value="Obesidad">Obesidad</option>
                  <option value="Onicomicosis">Onicomicosis</option>
                  <option value="Pérdida auditiva inducida por ruido">Pérdida auditiva inducida por ruido</option>
                  <option value="Presbiacusia">Presbiacusia</option>
                  <option value="Síndrome de Burnout">Síndrome de Burnout</option>
                  <option value="Síndrome de túnel carpiano">Síndrome de túnel carpiano</option>
                  <option value="Síndrome del manguito rotador">Síndrome del manguito rotador</option>
                  <option value="Sinovitis de muñeca">Sinovitis de muñeca</option>
                  <option value="Sobrepeso">Sobrepeso</option>
                  <option value="Tenosinovitis de De Quervain">Tenosinovitis de De Quervain</option>
                  <option value="Tendinitis de hombro">Tendinitis de hombro</option>
                  <option value="Tendinitis del manguito rotador">Tendinitis del manguito rotador</option>
                  <option value="Trastorno adaptativo con ansiedad">Trastorno adaptativo con ansiedad</option>
                  <option value="Trastorno de ansiedad generalizada">Trastorno de ansiedad generalizada</option>
                  <option value="Trastorno depresivo">Trastorno depresivo</option>
                  <option value="Trastornos del sueño">Trastornos del sueño</option>
                  <option value="Trauma acústico agudo">Trauma acústico agudo</option>
                  <option value="Vértigo posicional">Vértigo posicional</option>
                  <option value="Vitiligo">Vitiligo</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Diagnóstico 2 (Secundario)</label>
                <select
                  value={mdDx2}
                  onChange={(e) => setMdDx2(e.target.value)}
                  className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                >
                  <option value="">Seleccione diagnóstico</option>
                  <option value="Asma ocupacional">Asma ocupacional</option>
                  <option value="Bronquitis crónica por polvos inorgánicos">Bronquitis crónica por polvos inorgánicos</option>
                  <option value="Bursitis de codo">Bursitis de codo</option>
                  <option value="Bursitis de hombro">Bursitis de hombro</option>
                  <option value="Bursitis de rodilla">Bursitis de rodilla</option>
                  <option value="Cervicalgia">Cervicalgia</option>
                  <option value="Dermatitis alérgica de contacto">Dermatitis alérgica de contacto</option>
                  <option value="Dermatitis irritativa de contacto">Dermatitis irritativa de contacto</option>
                  <option value="Dorsalgia">Dorsalgia</option>
                  <option value="Epicondilitis lateral (codo de tenista)">Epicondilitis lateral (codo de tenista)</option>
                  <option value="Epicondilitis medial">Epicondilitis medial</option>
                  <option value="Escoliosis">Escoliosis</option>
                  <option value="Espondiloartrosis cervical">Espondiloartrosis cervical</option>
                  <option value="Espondiloartrosis lumbar">Espondiloartrosis lumbar</option>
                  <option value="Espondilosis cervical">Espondilosis cervical</option>
                  <option value="Espondilosis lumbar">Espondilosis lumbar</option>
                  <option value="Estrés postraumático">Estrés postraumático</option>
                  <option value="Gonalgia (dolor de rodilla)">Gonalgia (dolor de rodilla)</option>
                  <option value="Hernia discal cervical">Hernia discal cervical</option>
                  <option value="Hernia discal lumbar">Hernia discal lumbar</option>
                  <option value="Hipoacusia neurosensorial bilateral">Hipoacusia neurosensorial bilateral</option>
                  <option value="Lumbalgia">Lumbalgia</option>
                  <option value="Mialgia">Mialgia</option>
                  <option value="Obesidad">Obesidad</option>
                  <option value="Onicomicosis">Onicomicosis</option>
                  <option value="Pérdida auditiva inducida por ruido">Pérdida auditiva inducida por ruido</option>
                  <option value="Presbiacusia">Presbiacusia</option>
                  <option value="Síndrome de Burnout">Síndrome de Burnout</option>
                  <option value="Síndrome de túnel carpiano">Síndrome de túnel carpiano</option>
                  <option value="Síndrome del manguito rotador">Síndrome del manguito rotador</option>
                  <option value="Sinovitis de muñeca">Sinovitis de muñeca</option>
                  <option value="Sobrepeso">Sobrepeso</option>
                  <option value="Tenosinovitis de De Quervain">Tenosinovitis de De Quervain</option>
                  <option value="Tendinitis de hombro">Tendinitis de hombro</option>
                  <option value="Tendinitis del manguito rotador">Tendinitis del manguito rotador</option>
                  <option value="Trastorno adaptativo con ansiedad">Trastorno adaptativo con ansiedad</option>
                  <option value="Trastorno de ansiedad generalizada">Trastorno de ansiedad generalizada</option>
                  <option value="Trastorno depresivo">Trastorno depresivo</option>
                  <option value="Trastornos del sueño">Trastornos del sueño</option>
                  <option value="Trauma acústico agudo">Trauma acústico agudo</option>
                  <option value="Vértigo posicional">Vértigo posicional</option>
                  <option value="Vitiligo">Vitiligo</option>
                </select>
              </div>
            </div>

            {/* 6. SUGERENCIAS IA - Botón para abrir modal */}
            <button
              onClick={() => {
                setIsAIModalOpen(true);
                if (!aiSuggestions) handleGenerateAISuggestions();
              }}
              disabled={isGeneratingAI}
              className="w-full border-2 border-blue-500/30 rounded-lg p-3 bg-blue-900/10 hover:bg-blue-900/20 transition flex items-center justify-center gap-2 text-blue-400 font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGeneratingAI ? (
                <>
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Generando Análisis Nutricional...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  {aiSuggestions ? 'Ver / Editar Análisis Nutricional IA' : 'Generar Análisis Nutricional con IA'}
                </>
              )}
            </button>

            {/* 7. CONCEPTO FINAL */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Concepto Final <span className="text-red-500">*</span></label>
              <select
                value={mdConceptoFinal}
                onChange={(e) => setMdConceptoFinal(e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
              >
                <option value="">Seleccione una opción</option>
                <option value="ESTADO NUTRICIONAL NORMAL">ESTADO NUTRICIONAL NORMAL</option>
                <option value="SOBREPESO">SOBREPESO</option>
                <option value="OBESIDAD GRADO I">OBESIDAD GRADO I</option>
                <option value="OBESIDAD GRADO II">OBESIDAD GRADO II</option>
                <option value="OBESIDAD GRADO III">OBESIDAD GRADO III</option>
                <option value="BAJO PESO">BAJO PESO</option>
                <option value="DESNUTRICION">DESNUTRICION</option>
                <option value="RIESGO NUTRICIONAL">RIESGO NUTRICIONAL</option>
                <option value="REQUIERE SEGUIMIENTO">REQUIERE SEGUIMIENTO</option>
              </select>
            </div>

          </div>
        </div>

        {/* Diagnóstico Nutricional */}
        <div className="bg-[#2a3942] rounded-lg p-3">
          <h3 className="text-sm font-semibold mb-2 text-[#00a884]">Diagnóstico Nutricional</h3>
          <div className="space-y-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Código CIE-10</label>
              <input
                type="text"
                value={datosNutricionales.diagnosticoCIE10 || ''}
                onChange={(e) => updateNutri('diagnosticoCIE10', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                placeholder="Ej: E66.0"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Diagnóstico Nutricional</label>
              <textarea
                value={datosNutricionales.diagnosticoNutricional || ''}
                onChange={(e) => updateNutri('diagnosticoNutricional', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={3}
                placeholder="Diagnóstico nutricional detallado..."
              />
            </div>
          </div>
        </div>

        {/* Plan Nutricional */}
        <div className="bg-[#2a3942] rounded-lg p-3">
          <h3 className="text-sm font-semibold mb-2 text-[#00a884]">Plan Nutricional</h3>
          <div className="space-y-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Requerimiento Calórico (kcal/día)</label>
              <input
                type="text"
                value={datosNutricionales.requerimientoCalorico || ''}
                onChange={(e) => updateNutri('requerimientoCalorico', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                placeholder="Ej: 1800"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Distribución de Macronutrientes</label>
              <textarea
                value={datosNutricionales.distribucionMacronutrientes || ''}
                onChange={(e) => updateNutri('distribucionMacronutrientes', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={3}
                placeholder="CHO: 50%, Proteína: 20%, Grasa: 30%..."
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Plan Alimentario</label>
              <textarea
                value={datosNutricionales.planAlimentario || ''}
                onChange={(e) => updateNutri('planAlimentario', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={4}
                placeholder="Detalle del plan alimentario por tiempos de comida..."
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Actividad Física Recomendada</label>
              <textarea
                value={datosNutricionales.actividadFisicaPlan || ''}
                onChange={(e) => updateNutri('actividadFisicaPlan', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={3}
                placeholder="Tipo, frecuencia e intensidad de actividad física..."
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Recomendaciones Nutricionales</label>
              <textarea
                value={datosNutricionales.recomendacionesNutricionales || ''}
                onChange={(e) => updateNutri('recomendacionesNutricionales', e.target.value)}
                className="w-full bg-[#1f2c34] text-white text-sm px-2 py-2 rounded border border-gray-600 focus:border-[#00a884] focus:outline-none"
                rows={3}
                placeholder="Recomendaciones nutricionales generales..."
              />
            </div>
          </div>
        </div>

      </div>
      {/* Cierre del contenido scrollable */}

      {/* Botón Guardar - Footer fijo */}
      <div className="border-t border-gray-700 p-4 bg-[#1f2c34]">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full bg-[#00a884] text-white px-6 py-3 rounded-lg hover:bg-[#008f6f] transition font-semibold disabled:bg-gray-600 disabled:cursor-not-allowed shadow-lg"
        >
          {isSaving ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Guardando...
            </span>
          ) : (
            'Guardar Historia Clínica'
          )}
        </button>
      </div>

      {/* Modal de Historial de Consultas */}
      {data?.numeroId && (
        <PatientHistoryModal
          isOpen={isHistoryModalOpen}
          onClose={() => setIsHistoryModalOpen(false)}
          numeroId={data.numeroId}
          patientName={`${data.primerNombre} ${data.primerApellido}`}
        />
      )}

      {/* Modal de Sugerencias IA - Análisis Nutricional */}
      {isAIModalOpen && (
        <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4">
          <div className="bg-[#1f2c34] rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            {/* Header del modal */}
            <div className="flex items-center justify-between p-4 border-b border-gray-700">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <h3 className="text-lg font-bold text-blue-400">Análisis Nutricional IA</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleGenerateAISuggestions}
                  disabled={isGeneratingAI}
                  className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 transition disabled:bg-gray-600 disabled:cursor-not-allowed flex items-center gap-1"
                >
                  {isGeneratingAI ? (
                    <>
                      <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Generando...
                    </>
                  ) : (
                    <>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Regenerar
                    </>
                  )}
                </button>
                <button
                  onClick={() => setIsAIModalOpen(false)}
                  className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Contenido del modal */}
            <div className="flex-1 overflow-y-auto p-4">
              {isGeneratingAI && !aiSuggestions ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <svg className="animate-spin h-10 w-10 text-blue-400 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <p className="text-gray-400">Analizando perfil nutricional del paciente...</p>
                  <p className="text-gray-500 text-xs mt-1">Esto puede tomar unos segundos</p>
                </div>
              ) : (
                <textarea
                  value={aiSuggestions}
                  onChange={(e) => setAiSuggestions(e.target.value)}
                  className="w-full h-full min-h-[60vh] bg-[#0b141a] text-white text-sm px-4 py-3 rounded-lg border border-gray-700 focus:border-blue-400 focus:outline-none resize-none leading-relaxed"
                  placeholder="Las sugerencias de IA aparecerán aquí..."
                />
              )}
            </div>

            {/* Footer del modal */}
            <div className="border-t border-gray-700 p-4 flex items-center justify-between">
              <p className="text-xs text-gray-500">
                Este análisis se incluirá en las recomendaciones al guardar la historia clínica
              </p>
              <button
                onClick={() => setIsAIModalOpen(false)}
                className="px-4 py-2 bg-[#00a884] text-white text-sm rounded-lg hover:bg-[#008f6f] transition font-semibold"
              >
                Aceptar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
