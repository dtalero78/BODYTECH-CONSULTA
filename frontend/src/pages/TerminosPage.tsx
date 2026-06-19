// ============================================================================
// /terminos — Términos y condiciones del servicio de telemedicina BSL/Bodytech.
//
// Página pública (sin auth). Pensada para enlazarla desde el checkbox de
// "consentimiento informado" que el paciente debe aceptar al agendar (incluido
// el flujo de Trepsi).
//
// ⚠️ El contenido legal es un BORRADOR razonable basado en la legislación
// colombiana de telemedicina y protección de datos. Debe ser revisado por
// abogado antes de considerarse oficial.
// ============================================================================

const EMPRESA = 'BSL Bodytech';
const EMPRESA_LEGAL = 'BODYTECH S.A.';
const NIT = '900.123.456-7'; // ← Reemplazar con NIT real
const DIRECCION = 'Bogotá D.C., Colombia';
const EMAIL_DATOS = 'datospersonales@bodytech.com.co';
const EMAIL_CONTACTO = 'consultavideo@bodytech.com.co';
const TEL = '+57 601 628 4820';
const FECHA_VIGENCIA = '19 de junio de 2026';
const VERSION = '1.0';

export function TerminosPage() {
  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Header */}
      <header className="bg-white border-b border-zinc-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logoNegro.png" alt="Bodytech" className="h-7 object-contain" />
            <div>
              <h1 className="text-sm font-semibold text-zinc-900 leading-tight">
                Términos y condiciones
              </h1>
              <p className="text-[11px] text-zinc-500 leading-tight">
                Servicio de telemedicina · {EMPRESA}
              </p>
            </div>
          </div>
          <button
            onClick={() => window.print()}
            className="hidden sm:inline-flex px-3 py-1.5 text-xs text-zinc-600 border border-zinc-200 rounded-md hover:bg-zinc-50"
          >
            Imprimir
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 prose prose-zinc prose-sm">
        {/* Metadata */}
        <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-6 text-[13px] text-zinc-700">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-zinc-500">Empresa:</span>{' '}
              <span className="font-medium">{EMPRESA_LEGAL}</span>
            </div>
            <div>
              <span className="text-zinc-500">NIT:</span>{' '}
              <span className="font-medium">{NIT}</span>
            </div>
            <div>
              <span className="text-zinc-500">Versión:</span>{' '}
              <span className="font-medium">{VERSION}</span>
            </div>
            <div>
              <span className="text-zinc-500">Vigente desde:</span>{' '}
              <span className="font-medium">{FECHA_VIGENCIA}</span>
            </div>
          </div>
        </div>

        <Section n="1" title="Objeto">
          <p>
            Los presentes Términos y Condiciones regulan el uso del servicio de telemedicina
            ofrecido por <strong>{EMPRESA_LEGAL}</strong> (en adelante, &ldquo;Bodytech&rdquo; o
            &ldquo;el prestador&rdquo;), a través de la plataforma{' '}
            <code className="text-xs">bodytech.app</code>, que permite la atención médica y de
            coaching mediante videollamada, así como el registro y consulta de la historia clínica
            del usuario.
          </p>
        </Section>

        <Section n="2" title="Aceptación">
          <p>
            Al hacer clic en &ldquo;Acepto&rdquo; en la casilla de consentimiento al momento de
            agendar una consulta, el usuario manifiesta haber leído, entendido y aceptado de
            manera expresa, libre, previa e informada los presentes Términos. Si no está de
            acuerdo con alguno de ellos, debe abstenerse de utilizar el servicio.
          </p>
        </Section>

        <Section n="3" title="Marco legal">
          <p>El servicio se presta conforme a la normativa colombiana, en especial:</p>
          <ul>
            <li>
              <strong>Ley 1419 de 2010</strong> — establecen los lineamientos para el desarrollo de
              la telesalud en Colombia.
            </li>
            <li>
              <strong>Resolución 2654 de 2019</strong> del Ministerio de Salud — define las
              condiciones para la prestación de servicios bajo la modalidad de telemedicina.
            </li>
            <li>
              <strong>Resolución 1995 de 1999</strong> — establece normas para el manejo de la
              historia clínica.
            </li>
            <li>
              <strong>Ley 23 de 1981</strong> — Código de Ética Médica, en lo referente al secreto
              profesional y la confidencialidad.
            </li>
            <li>
              <strong>Ley 1581 de 2012</strong> y <strong>Decreto 1377 de 2013</strong> —
              Protección de Datos Personales (habeas data) y tratamiento de datos sensibles.
            </li>
            <li>
              <strong>Ley 1751 de 2015</strong> — Ley Estatutaria de Salud.
            </li>
          </ul>
        </Section>

        <Section n="4" title="Descripción del servicio">
          <p>El servicio incluye, según corresponda a cada usuario:</p>
          <ul>
            <li>Agendamiento de consultas médicas y de coaching.</li>
            <li>
              Atención por videollamada con profesionales de la salud o coaches autorizados,
              registrada con fines de calidad y trazabilidad clínica.
            </li>
            <li>
              Registro y custodia de la historia clínica electrónica, conforme a la Resolución
              1995 de 1999.
            </li>
            <li>Entrega de fórmulas, recomendaciones, órdenes y certificados cuando aplique.</li>
            <li>
              Envío de notificaciones, recordatorios y enlaces de acceso a la videollamada por
              correo electrónico, mensaje de texto o WhatsApp.
            </li>
          </ul>
          <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-[13px] text-amber-900">
            <strong>Limitaciones:</strong> el servicio no reemplaza la atención presencial en
            casos de urgencia médica, atención obstétrica, procedimientos quirúrgicos, ni
            situaciones que requieran examen físico directo. En estos casos, el usuario debe
            acudir a un servicio de urgencias o a su EPS.
          </div>
        </Section>

        <Section n="5" title="Consentimiento informado para telemedicina">
          <p>
            El usuario declara entender y aceptar que:
          </p>
          <ul>
            <li>
              La consulta se realiza por videollamada y no involucra examen físico directo, salvo
              el componente visual que permita la cámara.
            </li>
            <li>
              La calidad del servicio depende de su conexión a internet, dispositivo, micrófono y
              cámara.
            </li>
            <li>
              El profesional puede solicitar exámenes complementarios o derivar a atención
              presencial si lo considera necesario.
            </li>
            <li>
              La sesión puede ser grabada con fines de calidad, auditoría clínica y conservación
              de historia clínica, conforme a la normativa aplicable.
            </li>
            <li>
              Tiene derecho a revocar este consentimiento en cualquier momento, sin que ello
              afecte la validez de las atenciones previas.
            </li>
          </ul>
        </Section>

        <Section n="6" title="Historia clínica">
          <p>
            La historia clínica es un documento privado, sometido a reserva, que solo puede ser
            conocido por el paciente, el equipo de salud que lo atiende y las autoridades
            competentes en los casos previstos por la ley. Bodytech la conservará durante el
            tiempo establecido en la normativa vigente.
          </p>
          <p>
            El usuario tiene derecho a solicitar copia íntegra de su historia clínica en cualquier
            momento, escribiendo a <a href={`mailto:${EMAIL_CONTACTO}`}>{EMAIL_CONTACTO}</a>.
          </p>
        </Section>

        <Section n="7" title="Tratamiento de datos personales">
          <p>
            Bodytech actúa como responsable del tratamiento de los datos personales del usuario.
            Los datos recolectados incluyen:
          </p>
          <ul>
            <li>Datos de identificación (nombre, documento, fecha de nacimiento).</li>
            <li>Datos de contacto (correo electrónico, número celular, dirección).</li>
            <li>
              <strong>Datos sensibles relacionados con la salud:</strong> motivo de consulta,
              antecedentes, diagnóstico, plan de tratamiento, exámenes, signos vitales, etc.
            </li>
            <li>Datos técnicos de uso del servicio (dirección IP, dispositivo, registros de acceso).</li>
          </ul>
          <p>Estos datos se utilizan para:</p>
          <ul>
            <li>Prestar el servicio de telemedicina.</li>
            <li>Conformar y custodiar la historia clínica.</li>
            <li>Comunicarse con el usuario respecto al servicio (citas, resultados, recordatorios).</li>
            <li>Cumplir obligaciones legales y reglamentarias.</li>
            <li>Auditoría de calidad y mejora del servicio.</li>
            <li>Facturación y cobro cuando aplique.</li>
          </ul>
          <p>
            <strong>Datos sensibles:</strong> al aceptar estos términos, el usuario autoriza
            expresamente el tratamiento de sus datos sensibles relacionados con la salud, conforme
            al artículo 6 de la Ley 1581 de 2012.
          </p>
        </Section>

        <Section n="8" title="Transferencia y transmisión de datos">
          <p>
            Bodytech podrá compartir los datos del usuario con terceros únicamente cuando sea
            necesario para la prestación del servicio o cumplimiento de obligaciones legales,
            entre ellos:
          </p>
          <ul>
            <li>
              <strong>Plataformas aliadas de agendamiento o medicina prepagada</strong> que
              originaron la cita (por ejemplo, Trepsi), exclusivamente con el fin de mantener
              actualizada la historia clínica del usuario en su entorno habitual de salud.
            </li>
            <li>EPS, ARL o aseguradoras del usuario cuando éste lo autorice o lo exija la ley.</li>
            <li>Proveedores tecnológicos (videollamada, mensajería, almacenamiento en la nube) bajo acuerdos de confidencialidad y tratamiento.</li>
            <li>Autoridades judiciales o de salud, en los casos previstos por la normativa.</li>
          </ul>
        </Section>

        <Section n="9" title="Derechos del titular de los datos">
          <p>
            Como titular de sus datos personales, el usuario tiene derecho a:
          </p>
          <ul>
            <li>Conocer, actualizar y rectificar sus datos.</li>
            <li>Solicitar prueba de la autorización otorgada.</li>
            <li>Ser informado, previa solicitud, sobre el uso que se ha dado a sus datos.</li>
            <li>Presentar quejas ante la Superintendencia de Industria y Comercio (SIC).</li>
            <li>
              Revocar la autorización y/o solicitar la supresión del dato, en los términos
              señalados por la ley.
            </li>
            <li>Acceder en forma gratuita a los datos que hayan sido objeto de tratamiento.</li>
          </ul>
          <p>
            Para ejercer estos derechos, el usuario puede escribir a{' '}
            <a href={`mailto:${EMAIL_DATOS}`}>{EMAIL_DATOS}</a> indicando claramente su solicitud,
            anexando copia de su documento de identidad.
          </p>
        </Section>

        <Section n="10" title="Conservación y seguridad">
          <p>
            Bodytech implementa medidas técnicas, humanas y administrativas razonables para
            proteger la información del usuario contra acceso no autorizado, pérdida o alteración.
            La información se conserva en bases de datos cifradas y los accesos se restringen al
            personal autorizado.
          </p>
          <p>
            La historia clínica se conserva por el tiempo establecido en la Resolución 839 de
            2017 del Ministerio de Salud (mínimo 15 años desde la última atención).
          </p>
        </Section>

        <Section n="11" title="Obligaciones del usuario">
          <ul>
            <li>Suministrar información veraz, completa y actualizada.</li>
            <li>
              Custodiar los enlaces de acceso a sus consultas y no compartirlos con terceros.
            </li>
            <li>
              Contar con conexión a internet, dispositivo, micrófono y cámara funcionales para la
              videollamada.
            </li>
            <li>
              Acudir a urgencias presenciales cuando su condición lo amerite.
            </li>
            <li>Respetar los horarios agendados y notificar oportunamente las cancelaciones.</li>
          </ul>
        </Section>

        <Section n="12" title="Modificaciones">
          <p>
            Bodytech se reserva el derecho de modificar estos términos en cualquier momento. Las
            modificaciones serán publicadas en esta página con su fecha de vigencia. El uso
            continuado del servicio implica la aceptación de la nueva versión.
          </p>
        </Section>

        <Section n="13" title="Ley aplicable y jurisdicción">
          <p>
            Estos términos se rigen por las leyes de la República de Colombia. Cualquier
            controversia será resuelta por los jueces competentes en {DIRECCION}, conforme a la
            normativa vigente.
          </p>
        </Section>

        <Section n="14" title="Contacto">
          <div className="bg-zinc-100 rounded-md p-4 text-[13px] not-prose">
            <p className="font-medium text-zinc-900 mb-2">{EMPRESA_LEGAL}</p>
            <p className="text-zinc-700">NIT {NIT}</p>
            <p className="text-zinc-700">{DIRECCION}</p>
            <p className="text-zinc-700 mt-2">
              <strong>Correo de servicio:</strong>{' '}
              <a href={`mailto:${EMAIL_CONTACTO}`} className="text-blue-600 hover:underline">
                {EMAIL_CONTACTO}
              </a>
            </p>
            <p className="text-zinc-700">
              <strong>Correo de protección de datos:</strong>{' '}
              <a href={`mailto:${EMAIL_DATOS}`} className="text-blue-600 hover:underline">
                {EMAIL_DATOS}
              </a>
            </p>
            <p className="text-zinc-700">
              <strong>Teléfono:</strong> {TEL}
            </p>
          </div>
        </Section>

        <footer className="text-center text-[11px] text-zinc-400 mt-10 pb-8">
          Versión {VERSION} · Vigente desde {FECHA_VIGENCIA}
          <br />© {new Date().getFullYear()} {EMPRESA_LEGAL}. Todos los derechos reservados.
        </footer>
      </main>
    </div>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 first:mt-0">
      <h2 className="text-base font-semibold text-zinc-900 flex items-baseline gap-2 not-prose mb-2">
        <span className="text-zinc-400 font-mono text-sm">{n}.</span>
        <span>{title}</span>
      </h2>
      <div className="text-[14px] text-zinc-700 leading-relaxed [&>p]:mb-3 [&>ul]:mb-3 [&>ul]:list-disc [&>ul]:pl-5 [&>ul>li]:mb-1.5">
        {children}
      </div>
    </section>
  );
}
