// El alta tiene que poder recorrerse sin saber nada de roles ni de programas:
// se elige el oficio y el resto queda puesto. Esto lo fija.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProfesionalFormModal } from '../ProfesionalFormModal';

vi.mock('../../../services/auth.service', () => ({
  default: {
    getSedes: vi.fn().mockResolvedValue([
      { sedeId: 'bsl', nombre: 'Bodytech Sede Principal' },
      { sedeId: 'bdt-nutricion', nombre: 'Bodytech Nutrición' },
      { sedeId: 'corporativo', nombre: 'Médico Corporativo' },
    ]),
  },
}));

const create = vi.fn().mockResolvedValue({
  profesional: { id: 1 },
  yaEstabaEnDirectorio: false,
  cuentaCreada: true,
});

vi.mock('../../../services/profesionales.service', () => ({
  default: {
    create: (...args: unknown[]) => create(...args),
    update: vi.fn(),
  },
}));

function abrir() {
  return render(
    <ProfesionalFormModal
      isOpen
      editing={null}
      onClose={vi.fn()}
      onSaved={vi.fn()}
      onError={vi.fn()}
    />,
  );
}

describe('ProfesionalFormModal', () => {
  beforeEach(() => create.mockClear());

  it('arranca preguntando qué va a hacer la persona', () => {
    abrir();
    expect(screen.getByText('Paso 1 de 2 · ¿Qué va a hacer?')).toBeTruthy();
    expect(screen.getByText('Coach de nutrición')).toBeTruthy();
    expect(screen.getByText('Médico corporativo')).toBeTruthy();
  });

  it('elegido el oficio, no vuelve a preguntar rol, aplicación ni programa', async () => {
    abrir();
    fireEvent.click(screen.getByText('Coach de nutrición'));
    expect(screen.getByText('Paso 2 de 2 · Coach de nutrición')).toBeTruthy();
    // Nada de la jerga que confundía: esas casillas ya quedaron resueltas.
    expect(screen.queryByText('Entra a')).toBeNull();
    expect(screen.queryByText('Todas las sedes')).toBeNull();
    expect(screen.queryByText('Trepsi')).toBeNull();
    // Y sí aparece lo que cambia entre dos coaches.
    expect(screen.getByText('Código de agenda *')).toBeTruthy();
  });

  it('crea el coach con su rol, programa y sede sin que nadie los escriba', async () => {
    abrir();
    fireEvent.click(screen.getByText('Coach de nutrición'));
    fireEvent.change(screen.getByLabelText('Primer nombre *'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Primer apellido *'), { target: { value: 'Navas' } });
    fireEvent.change(screen.getByLabelText('Cédula *'), { target: { value: '1016082324' } });
    fireEvent.change(screen.getByLabelText('Correo'), {
      target: { value: 'ana.navas@bodytechcorp.com' },
    });
    fireEvent.click(screen.getByText('Crear'));

    await waitFor(() => expect(create).toHaveBeenCalled());
    const [input, sede] = create.mock.calls[0];
    expect(input.rol).toBe('coach');
    expect(input.codigo).toBe('1016082324'); // el código se propone solo
    expect(input.cuenta).toMatchObject({
      app: 'consulta',
      rol: 'coach',
      programas: ['trepsi'],
      sedes: ['bdt-nutricion'],
      esGlobal: false,
    });
    expect(sede).toBe('bdt-nutricion'); // la ficha queda en la sede del oficio
  });

  it('a la coordinación sí le pregunta las sedes', async () => {
    abrir();
    fireEvent.click(screen.getByText('Coordinación'));
    fireEvent.change(screen.getByLabelText('Correo'), {
      target: { value: 'karen@bodytechcorp.com' },
    });
    await waitFor(() => expect(screen.getByText('Todas las sedes')).toBeTruthy());
    expect(screen.queryByText('Código de agenda *')).toBeNull();
  });
});
