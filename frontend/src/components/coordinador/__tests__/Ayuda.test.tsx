// El globo de ayuda tiene que salir con el mouse, con el teclado y al tocar
// (en celular no hay hover), y no puede disparar el clic de la fila donde está.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Ayuda } from '../Ayuda';

describe('Ayuda', () => {
  it('muestra la explicación al pasar el mouse y la quita al salir', () => {
    render(<Ayuda texto="El paciente entró y el coach no" />);
    const disparador = screen.getByLabelText('Qué significa').parentElement!;
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.mouseEnter(disparador);
    expect(screen.getByRole('tooltip')).toHaveTextContent('El paciente entró y el coach no');

    fireEvent.mouseLeave(disparador);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('se abre con el teclado', () => {
    render(<Ayuda texto="Hora de la marca" />);
    fireEvent.focus(screen.getByLabelText('Qué significa').parentElement!);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Hora de la marca');
  });

  it('tocarlo abre y cierra sin disparar el clic de la fila', () => {
    const alClicFila = vi.fn();
    render(
      <table>
        <tbody>
          <tr onClick={alClicFila}>
            <td>
              <Ayuda texto="Entró antes de la marca">
                <span>Ya estaba en la sala</span>
              </Ayuda>
            </td>
          </tr>
        </tbody>
      </table>
    );
    const etiqueta = screen.getByText('Ya estaba en la sala');

    fireEvent.click(etiqueta);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Entró antes de la marca');
    fireEvent.click(etiqueta);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(alClicFila).not.toHaveBeenCalled();
  });
});
