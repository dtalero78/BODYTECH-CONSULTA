/**
 * Tests del motor de composición corporal del programa ACC.
 *
 * Estos números salen impresos en la "Hoja de Valoración ACC" con el logo de
 * Bodytech y la cédula del paciente, así que la aritmética se blinda acá.
 *
 * El caso de referencia es el paciente que Bodytech mostró en la reunión de
 * validación (informe_valoracion_bodytech_v4.pdf): hombre, 13 años, 165 cm,
 * 52 kg → IMC 19.1, % graso 8.02, TMB 1.601 kcal, perímetro abdominal 68 cm,
 * ICC 0.84.
 */

import {
  calcularAntropometria,
  calcularImc,
  calcularTmb,
  calcularIcc,
  calcularIct,
  calcularMasaMuscular,
  grasaYuhasz,
  grasaFaulkner,
  grasaDurninWomersley,
  sumatoria6,
  sumatoria8,
  clasificar,
  normalizarSexo,
  RANGOS_PROVISIONALES,
  type Pliegues,
  type MedidasAntropometricas,
} from '../antropometria';

const PLIEGUES_VACIOS: Pliegues = {
  triceps: null,
  subescapular: null,
  biceps: null,
  crestaIliaca: null,
  supraespinal: null,
  abdominal: null,
  musloAnterior: null,
  pantorrilla: null,
};

describe('normalizarSexo', () => {
  it('acepta las variantes que existen en la base', () => {
    for (const v of ['Masculino', 'masculino', 'M', 'm', 'male', 'hombre', 'H']) {
      expect(normalizarSexo(v)).toBe('masculino');
    }
    for (const v of ['Femenino', 'femenino', 'F', 'f', 'female', 'mujer']) {
      expect(normalizarSexo(v)).toBe('femenino');
    }
  });

  it('devuelve null en vez de adivinar', () => {
    expect(normalizarSexo(null)).toBeNull();
    expect(normalizarSexo('')).toBeNull();
    expect(normalizarSexo('otro')).toBeNull();
  });
});

describe('calcularImc', () => {
  it('reproduce el caso del informe de referencia', () => {
    // 52 kg / (1.65 m)² = 19.10
    expect(calcularImc(52, 165)).toBe(19.1);
  });

  it('no divide por cero ni por talla negativa', () => {
    expect(calcularImc(70, 0)).toBeNull();
    expect(calcularImc(70, -170)).toBeNull();
    expect(calcularImc(null, 170)).toBeNull();
  });
});

describe('calcularTmb (Harris-Benedict revisada)', () => {
  it('reproduce el caso del informe de referencia', () => {
    // 88.362 + 13.397(52) + 4.799(165) − 5.677(13) = 1502.6 → el informe cita
    // 1.601 kcal, calculado con otra edad/variante; validamos la fórmula, no el PDF.
    expect(calcularTmb(52, 165, 13, 'masculino')).toBe(1503);
  });

  it('usa coeficientes distintos por sexo', () => {
    const h = calcularTmb(70, 175, 30, 'masculino')!;
    const m = calcularTmb(70, 175, 30, 'femenino')!;
    expect(h).toBeGreaterThan(m);
    // 447.593 + 9.247(70) + 3.098(175) − 4.330(30) = 1507.13
    expect(m).toBe(1507);
  });

  it('exige los cuatro insumos', () => {
    expect(calcularTmb(70, 175, 30, null)).toBeNull();
    expect(calcularTmb(70, 175, null, 'masculino')).toBeNull();
    expect(calcularTmb(null, 175, 30, 'masculino')).toBeNull();
    expect(calcularTmb(70, null, 30, 'masculino')).toBeNull();
  });
});

describe('índices de perímetro', () => {
  it('ICC reproduce el caso del informe (68 / 81 = 0.84)', () => {
    expect(calcularIcc(68, 81)).toBe(0.84);
  });

  it('ICT usa la talla, no la cadera', () => {
    expect(calcularIct(68, 165)).toBe(0.41);
  });

  it('no divide por cero', () => {
    expect(calcularIcc(80, 0)).toBeNull();
    expect(calcularIct(80, 0)).toBeNull();
  });
});

describe('sumatorias de pliegues', () => {
  const completos: Pliegues = {
    triceps: 10,
    subescapular: 8,
    biceps: 4,
    crestaIliaca: 12,
    supraespinal: 6,
    abdominal: 14,
    musloAnterior: 16,
    pantorrilla: 9,
  };

  it('la de 6 excluye bíceps y cresta ilíaca', () => {
    // 10 + 8 + 6 + 14 + 16 + 9 = 63
    expect(sumatoria6(completos)).toBe(63);
  });

  it('la de 8 los incluye', () => {
    expect(sumatoria8(completos)).toBe(79);
  });

  it('devuelve null si falta un solo pliegue', () => {
    expect(sumatoria6({ ...completos, pantorrilla: null })).toBeNull();
    expect(sumatoria8({ ...completos, biceps: null })).toBeNull();
  });
});

describe('fórmulas de % graso', () => {
  it('Yuhasz distingue sexo', () => {
    // Hombre: 2.585 + 63 × 0.1051 = 9.2
    expect(grasaYuhasz(63, 'masculino')).toBe(9.21);
    // Mujer: 3.5803 + 63 × 0.1548 = 13.33
    expect(grasaYuhasz(63, 'femenino')).toBe(13.33);
  });

  it('Yuhasz exige sexo — no asume masculino por defecto', () => {
    expect(grasaYuhasz(63, null)).toBeNull();
  });

  it('Faulkner usa los 4 pliegues de su Σ4', () => {
    // (10 + 8 + 6 + 14) × 0.153 + 5.783 = 11.597
    expect(
      grasaFaulkner({ ...PLIEGUES_VACIOS, triceps: 10, subescapular: 8, supraespinal: 6, abdominal: 14 })
    ).toBe(11.6);
  });

  it('Durnin-Womersley cambia de coeficiente por franja de edad', () => {
    const p: Pliegues = { ...PLIEGUES_VACIOS, biceps: 4, triceps: 10, subescapular: 8, crestaIliaca: 12 };
    const joven = grasaDurninWomersley(p, 25, 'masculino');
    const mayor = grasaDurninWomersley(p, 55, 'masculino');
    expect(joven).not.toBeNull();
    expect(mayor).not.toBeNull();
    expect(joven).not.toBe(mayor);
  });

  it('Durnin-Womersley necesita edad', () => {
    const p: Pliegues = { ...PLIEGUES_VACIOS, biceps: 4, triceps: 10, subescapular: 8, crestaIliaca: 12 };
    expect(grasaDurninWomersley(p, null, 'masculino')).toBeNull();
  });
});

describe('calcularMasaMuscular (Lee 2000)', () => {
  const base = {
    estaturaCm: 175,
    edad: 30,
    sexo: 'masculino' as const,
    perimetroBrazoRelajado: 30,
    perimetroMuslo: 55,
    perimetroPantorrilla: 37,
    pliegueTriceps: 10,
    pliegueMusloAnterior: 16,
    plieguePantorrilla: 9,
  };

  it('produce una masa muscular fisiológicamente plausible', () => {
    const sm = calcularMasaMuscular(base)!;
    expect(sm).toBeGreaterThan(20);
    expect(sm).toBeLessThan(50);
  });

  it('corrige los perímetros por el pliegue: más pliegue, menos músculo', () => {
    const magro = calcularMasaMuscular(base)!;
    const graso = calcularMasaMuscular({ ...base, pliegueTriceps: 25, plieguePantorrilla: 20 })!;
    expect(graso).toBeLessThan(magro);
  });

  it('devuelve null si falta cualquier perímetro', () => {
    expect(calcularMasaMuscular({ ...base, perimetroPantorrilla: null })).toBeNull();
    expect(calcularMasaMuscular({ ...base, perimetroMuslo: null })).toBeNull();
  });

  it('no devuelve un perímetro corregido negativo', () => {
    // Pliegue absurdo → el perímetro corregido se va a negativo.
    expect(calcularMasaMuscular({ ...base, perimetroBrazoRelajado: 1, pliegueTriceps: 90 })).toBeNull();
  });
});

describe('clasificar', () => {
  it('ubica el valor en la banda correcta', () => {
    expect(clasificar(17, RANGOS_PROVISIONALES.imc)).toBe('bajo');
    expect(clasificar(22, RANGOS_PROVISIONALES.imc)).toBe('normal');
    expect(clasificar(31, RANGOS_PROVISIONALES.imc)).toBe('alto');
  });

  it('el límite superior de una banda pertenece a la siguiente', () => {
    // 25 no es "normal": normal es [18.5, 25).
    expect(clasificar(24.99, RANGOS_PROVISIONALES.imc)).toBe('normal');
    expect(clasificar(25, RANGOS_PROVISIONALES.imc)).toBe('alto');
  });
});

describe('calcularAntropometria (integración)', () => {
  const completo: MedidasAntropometricas = {
    sexo: 'Masculino',
    edad: 30,
    estaturaCm: 175,
    pesoKg: 75,
    perimetroAbdominal: 85,
    perimetroCadera: 98,
    perimetroBrazoRelajadoDer: 30,
    perimetroBrazoRelajadoIzq: 30,
    perimetroMusloDer: 55,
    perimetroMusloIzq: 55,
    perimetroPantorrilla: 37,
    pliegueTriceps: 10,
    pliegueSubescapular: 8,
    pliegueBiceps: 4,
    pliegueCrestaIliaca: 12,
    pliegueSupraespinal: 6,
    pliegueAbdominal: 14,
    pliegueMusloAnterior: 16,
    plieguePantorrilla: 9,
  };

  it('calcula todo el set cuando están todas las medidas', () => {
    const r = calcularAntropometria(completo);
    expect(r.imc!.valor).toBe(24.49);
    expect(r.imc!.evaluacion).toBe('normal');
    expect(r.porcentajeGrasa).not.toBeNull();
    expect(r.porcentajeMuscular).not.toBeNull();
    expect(r.pesoMuscularKg).not.toBeNull();
    expect(r.tmbKcal).not.toBeNull();
    expect(r.icc!.valor).toBe(0.87);
    expect(r.ict!.valor).toBe(0.49);
    expect(r.faltantes).toHaveLength(0);
  });

  it('prefiere Yuhasz — el protocolo Bodytech — sobre las demás', () => {
    expect(calcularAntropometria(completo).metodoGrasa).toBe('yuhasz');
  });

  it('cae a Faulkner cuando falta un pliegue de la sumatoria de 6', () => {
    const r = calcularAntropometria({ ...completo, plieguePantorrilla: null });
    expect(r.metodoGrasa).toBe('faulkner');
    expect(r.porcentajeGrasa).not.toBeNull();
  });

  it('cae a Durnin-Womersley cuando tampoco alcanza para Faulkner', () => {
    const r = calcularAntropometria({
      ...completo,
      plieguePantorrilla: null,
      pliegueSupraespinal: null,
    });
    expect(r.metodoGrasa).toBe('durnin-womersley');
  });

  it('masa grasa + masa libre reconstruyen el peso', () => {
    const r = calcularAntropometria(completo);
    expect(r.masaGrasaKg! + r.masaLibreGrasaKg!).toBeCloseTo(75, 1);
  });

  it('promedia los dos lados de brazo y muslo', () => {
    const simetrico = calcularAntropometria(completo);
    const asimetrico = calcularAntropometria({
      ...completo,
      perimetroMusloDer: 53,
      perimetroMusloIzq: 57, // mismo promedio: 55
    });
    expect(asimetrico.pesoMuscularKg).toBe(simetrico.pesoMuscularKg);
  });

  it('usa el lado que haya si solo se midió uno', () => {
    const r = calcularAntropometria({ ...completo, perimetroMusloIzq: null });
    expect(r.pesoMuscularKg).not.toBeNull();
  });

  it('con medidas vacías no tira y reporta todo como faltante', () => {
    const r = calcularAntropometria({});
    expect(r.imc).toBeNull();
    expect(r.porcentajeGrasa).toBeNull();
    expect(r.tmbKcal).toBeNull();
    expect(r.faltantes).toEqual(
      expect.arrayContaining(['sexo', 'edad', 'estatura', 'peso', 'pliegues'])
    );
  });

  it('sin sexo no clasifica en vez de asumir una banda', () => {
    const r = calcularAntropometria({ ...completo, sexo: null });
    // El IMC no depende del sexo, así que se sigue clasificando.
    expect(r.imc!.evaluacion).toBe('normal');
    // El ICC sí — y su banda difiere entre hombres y mujeres.
    expect(r.icc!.evaluacion).toBeNull();
  });

  it('ignora basura en los campos numéricos en vez de propagar NaN', () => {
    const r = calcularAntropometria({ ...completo, pesoKg: 'abc' as unknown as number });
    expect(r.imc).toBeNull();
    expect(r.faltantes).toContain('peso');
  });
});
