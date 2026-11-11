import type { Catalog } from './types.ts';

/**
 * Catalogue espagnol : **version qui fait foi** (19 US-014, 16 NFR-11). Espagnol neutre
 * d'Amérique latine (10b UX-11), tutoiement « tú » dans l'interface (UXQ-04, défaut PROPOSÉ) ;
 * le vouvoiement « usted » est réservé au contrat et aux textes juridiques (UX-12). Jamais de
 * voseo ni de « vosotros ». Termes : glossaire `docs/glossary.md` (UX-13).
 *
 * Toute clé ajoutée ici doit l'être dans `en.ts`, `fr.ts` et `pt.ts` (sinon `pnpm typecheck` et les tests
 * échouent).
 */
export const ES_MESSAGES = {
  'common.locale.switchLabel': 'Idioma',
  'common.locale.current': 'Idioma actual: {language}',
  'common.price.finalForDays': {
    one: 'Precio final · {count} día',
    other: 'Precio final · {count} días',
  },
  'common.auth.sessionRequired': 'Tu sesión terminó. Inicia sesión de nuevo.',
  'common.auth.invalidCredentials': 'Correo o contraseña incorrectos.',
  'common.auth.emailInvalid': 'Ingresa un correo electrónico válido.',
  'common.auth.passwordWeak': 'La contraseña debe tener al menos {min} caracteres.',
  'common.auth.termsNotAccepted':
    'Debes aceptar los Términos y la Política de privacidad para continuar.',
  'common.auth.linkExpired': 'Este enlace ya no es válido. Pide uno nuevo.',
  'common.auth.rateLimited': 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.',
  'common.auth.requestInvalid': 'Revisa los datos ingresados.',
  'common.auth.signupAccepted': 'Revisa tu correo para continuar.',
  'common.auth.emailVerified': 'Tu correo está confirmado.',
  'common.rateLimit.retryLater': 'Demasiadas solicitudes. Espera un momento y vuelve a intentarlo.',
  'common.rateLimit.unavailable':
    'No podemos enviar el mensaje en este momento. Inténtalo de nuevo más tarde.',
  'common.rateLimit.challengeRequired': 'Confirma que eres una persona para continuar.',
  'web.home.tagline': 'Alquila un auto y conoce el precio final desde el inicio.',
  'web.shell.skipToContent': 'Saltar al contenido',
  'web.shell.homeLink': '{brand}, página de inicio',
  'web.shell.languageHint': 'La página se recarga en el idioma elegido.',
  'web.offline.title': 'Sin conexión',
  'web.offline.body':
    'Revisa tu señal o tu wifi. Cuando vuelva la conexión, cargamos la página otra vez.',
  'web.offline.retry': 'Reintentar',
  'common.offline.restored': 'Volviste a estar en línea.',
  'web.s01.title': 'Alquila el auto de un vecino.',
  'web.s01.subtitle': 'Autos de personas reales cerca de ti, vivas aquí o estés de visita.',
  'web.s01.how.title': 'Cómo funciona',
  'web.s01.how.1': 'Encuentra un auto cerca',
  'web.s01.how.1.body': 'Autos de vecinos, con fotos, precio y opiniones reales.',
  'web.s01.how.2': 'Reserva con su dueño',
  'web.s01.how.2.body': 'Reservas y acuerdas con el anfitrión dónde te entrega el auto.',
  'web.s01.how.3': 'Recógelo y disfruta',
  'web.s01.how.3.body': 'Lo recoges en el punto acordado y lo devuelves ahí mismo.',
  'web.s01.owner.title': 'Gana dinero con tu auto',
  'web.s01.owner.body':
    'Cuando no lo usas, tu auto puede ayudar a un vecino y darte un ingreso extra.',
  'backoffice.meta.title': '{brand} — administración',
  'backoffice.meta.description': 'Consola interna.',
  'backoffice.home.heading': '{brand} — administración',
  'backoffice.home.intro': 'Consola interna del equipo.',
  // Bibliothèque de composants (US-032). Textes repris de 10b §4.3 quand la clé y existe ;
  // les autres sont PROPOSÉS (à reporter dans 10b §4.3 par une demande de fusion sur les specs).
  'common.offline.banner': 'Sin conexión. Te mostramos lo último guardado.',
  'common.error.server':
    'Algo falló de nuestro lado. No se perdió nada de lo que escribiste. Inténtalo de nuevo; si sigue, escríbenos por WhatsApp con el código {code}.',
  'common.price.perDay': '{amount} por día',
  'common.price.details': 'Detalle del precio',
  'common.price.total': 'Total',
  'common.ui.loading': 'Cargando…',
  'common.ui.optional': '(opcional)',
  'common.ui.errorSummary.title': {
    one: 'Revisa {count} campo',
    other: 'Revisa {count} campos',
  },
  'common.ui.error.code': 'Código: {code}',
  'common.ui.rating.label': 'Valoración: {rating} de 5',
  'common.ui.rating.trips': { one: '{count} viaje', other: '{count} viajes' },
  'common.ui.distance': 'A {distance} km',
  'common.ui.car.save': 'Guardar {car}',
  'common.ui.steps.progress': 'Paso {current} de {total}',
  'common.ui.steps.done': 'completado',
  'common.ui.host.since': 'Miembro desde {year}',
  'common.ui.host.responseRate': 'Tasa de respuesta: {rate} %',
  'common.ui.host.responseTime': {
    one: 'Suele responder en {count} hora',
    other: 'Suele responder en {count} horas',
  },
  'common.ui.photo.take': 'Tomar foto: {angle}',
  'common.ui.photo.retake': 'Repetir foto: {angle}',
  'common.ui.photo.empty': 'Sin foto todavía',
  'common.ui.photo.saved': 'Guardada en este teléfono',
  'common.ui.photo.uploading': 'Enviando…',
  'common.ui.photo.uploaded': 'Enviada',
  'common.ui.photo.failed': 'No se envió. Lo intentaremos de nuevo.',
  'web.common.save': 'Guardar',
  'web.s01.owner.cta': 'Publica tu auto',
  'web.s02.new': 'Nuevo',
  'web.s02.empty': 'No hay autos disponibles en estas fechas.',
  'web.s03.cta': 'Reservar',
  'web.s03.host.titleMasc': 'Tu anfitrión',
  'web.s03.host.titleFem': 'Tu anfitriona',
  'web.s03.host.titleNeutral': 'Quién te alquila el auto',
  'web.host.guest.verified': 'Identidad verificada',
  'web.s03.deposit.title': 'Depósito de garantía',
  'web.deposit.amount': 'Monto',
  'web.deposit.holder': 'Lo retiene {merchant_name} en tu tarjeta; {host_name} nunca lo cobra.',
  'web.deposit.how.preauth': 'Es un bloqueo temporal en tu tarjeta, no un cargo.',
  'web.deposit.how.chargeRefund': 'Se cobra al inicio y se reembolsa al final.',
  'web.deposit.covers':
    'Cubre solo estos gastos del viaje: combustible faltante, retraso en la devolución, kilómetros extra, limpieza, tabaco o mascotas, y peajes.',
  'web.deposit.notCovers': 'Los daños no se cobran de este depósito.',
  'web.deposit.releaseBy': 'Se libera a más tardar el {date}.',
  'web.deposit.contest': 'Revisar y responder',
  'web.deposit.debitWarning':
    'El depósito se cobra y luego se reembolsa. Emitiremos el reembolso el {date}; tu banco puede tardar de 3 a 10 días hábiles en mostrarlo.',
  // Vitrine de la bibliothèque (US-032) : outil interne de revue du design, PROPOSÉ.
  'web.catalog.title': 'Biblioteca de componentes',
  'web.catalog.intro':
    'Cada componente en sus estados. Elige el idioma, el tema y el ancho para revisarlos.',
  'web.catalog.controls.theme': 'Tema',
  'web.catalog.controls.auto': 'Automático',
  'web.catalog.controls.light': 'Claro',
  'web.catalog.controls.dark': 'Oscuro',
  'web.catalog.controls.width': 'Ancho',
  'web.catalog.controls.mobile': 'Móvil, 360 px',
  'web.catalog.controls.full': 'Ancho completo',
  'web.catalog.state.normal': 'Normal',
  'web.catalog.state.empty': 'Vacío',
  'web.catalog.state.loading': 'Cargando',
  'web.catalog.state.error': 'Error',
  'web.catalog.state.disabled': 'Desactivado',
  'web.catalog.section.buttons': 'Botones',
  'web.catalog.section.fields': 'Campos de formulario',
  'web.catalog.section.badges': 'Insignias, notas y avatares',
  'web.catalog.section.price': 'Precio final',
  'web.catalog.section.carCard': 'Tarjeta de auto',
  'web.catalog.section.host': 'Bloque del anfitrión',
  'web.catalog.section.deposit': 'Bloque del depósito',
  'web.catalog.section.banners': 'Avisos',
  'web.catalog.section.steps': 'Etapas',
  'web.catalog.section.photo': 'Captura de fotos',
  'web.catalog.section.table': 'Tablas de la consola',
  'web.catalog.sample.emailLabel': 'Correo electrónico',
  'web.catalog.sample.emailHint': 'Te enviaremos aquí la confirmación de tu reserva.',
  'web.catalog.sample.nameLabel': 'Nombre',
  'web.catalog.sample.terms': 'Acepto los Términos y la Política de privacidad.',
  'web.catalog.sample.step.dates': 'Fechas',
  'web.catalog.sample.step.identity': 'Identidad',
  'web.catalog.sample.step.payment': 'Pago',
  'web.catalog.sample.step.confirmation': 'Confirmación',
  'web.catalog.sample.line.rent': {
    one: 'Alquiler · {count} día',
    other: 'Alquiler · {count} días',
  },
  'web.catalog.sample.line.tripFee': 'Tarifa del viaje',
  'web.catalog.sample.line.protection': 'Protección básica',
  'web.catalog.sample.line.tax': 'Impuestos',
  'web.catalog.sample.table.caption': 'Próximas entregas',
  'web.catalog.sample.table.trip': 'Viaje',
  'web.catalog.sample.table.dates': 'Fechas',
  'web.catalog.sample.table.status': 'Estado',
  'web.catalog.sample.table.earnings': 'Tu ingreso',
  'web.catalog.sample.table.confirmed': 'Confirmado',
  'web.catalog.sample.table.pending': 'Pendiente',
  'web.catalog.sample.table.empty': 'Aún no tienes entregas.',
  'web.catalog.sample.photo.front': 'Frente',
  'web.catalog.sample.photo.rear': 'Parte trasera',
  'web.catalog.sample.photo.driverSide': 'Lado del conductor',
  'web.catalog.sample.photo.passengerSide': 'Lado del pasajero',
  'web.catalog.sample.photo.dashboard': 'Tablero',
  'web.catalog.sample.hostQuote': 'Entrego el auto limpio y con el tanque lleno.',
  'web.catalog.sample.retry': 'Intentar de nuevo',
  'common.auth.forbidden': 'No tienes permiso para esta acción. Quedó registrada.',
  'common.auth.twoFactorRequired':
    'Confirma tu identidad con el código de tu app de autenticación.',
  'common.auth.totpInvalid': 'El código no es válido. Usa el código actual de tu app.',
  'common.auth.totpLocked':
    'Demasiados códigos incorrectos. Espera 15 minutos o pide a un administrador que restablezca tu acceso.',
  'common.auth.mfaUnavailable':
    'La verificación en dos pasos no está disponible ahora. No se otorgó ningún acceso.',
  'common.auth.actionUnavailable':
    'Esta acción todavía no está disponible en la consola. Quedó registrada.',
  'common.auth.actionRecorded': 'Acción registrada.',
  'common.auth.actionDone': 'Listo. El cambio quedó registrado.',
  'backoffice.login.heading': 'Acceso del equipo',
  'backoffice.login.email': 'Correo electrónico',
  'backoffice.login.password': 'Contraseña',
  'backoffice.login.submit': 'Continuar',
  'backoffice.totp.heading': 'Verificación en dos pasos',
  'backoffice.totp.intro': 'Escribe el código de 6 dígitos que muestra tu app de autenticación.',
  'backoffice.totp.code': 'Código de 6 dígitos',
  'backoffice.totp.submit': 'Verificar',
  'backoffice.enroll.heading': 'Activa tu verificación en dos pasos',
  'backoffice.enroll.intro':
    'Un administrador te entregó un código de activación. Escríbelo para ver la clave de tu app de autenticación.',
  'backoffice.enroll.enrollmentCode': 'Código de activación',
  'backoffice.enroll.reveal': 'Mostrar la clave',
  'backoffice.enroll.secret': 'Clave para tu app (se muestra una sola vez)',
  'backoffice.enroll.openApp': 'Abrir en mi app de autenticación',
  'backoffice.enroll.confirm': 'Activar',
  'backoffice.denied.heading': 'Acceso denegado',
  'backoffice.denied.notStaff': 'Tu cuenta no tiene un rol del equipo interno.',
  'backoffice.denied.noTotp':
    'Tu cuenta del equipo no tiene verificación en dos pasos. Pide a un administrador un código de activación.',
  'backoffice.console.roles': 'Tus roles',
  'backoffice.console.countries': 'Cobertura · {countries}',
  'backoffice.console.signOut': 'Cerrar sesión',
  'backoffice.role.SUPPORT_AGENT': 'Soporte',
  'backoffice.role.OPS_AGENT': 'Operaciones',
  'backoffice.role.FINANCE': 'Finanzas',
  'backoffice.role.ADMIN': 'Administrador',
  'backoffice.role.SUPERADMIN': 'Superadministrador',
  'backoffice.journal.caption': 'Registro de actividad',
  'backoffice.journal.when': 'Fecha',
  'backoffice.journal.who': 'Quién',
  'backoffice.journal.action': 'Acción',
  'backoffice.journal.subject': 'Sobre',
  'backoffice.journal.empty': 'Todavía no hay actividad registrada.',
  'backoffice.action.heading': 'Acción sobre un viaje',
  'backoffice.action.subject': 'Identificador del viaje',
  'backoffice.action.reason': 'Motivo',
  'backoffice.action.reasonHint': 'Entre 10 y 1000 caracteres. Queda en el registro.',
  'backoffice.action.CANCEL_TRIP_PLATFORM': 'Cancelar por la plataforma',
  'backoffice.action.DECLARE_NO_SHOW': 'Declarar no presentación',
  'backoffice.action.RECORD_CLAIM': 'Registrar un reclamo',
  'backoffice.error.network':
    'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.',
  'backoffice.journal.error': 'No pudimos cargar el registro de actividad.',
  'backoffice.journal.scope': 'Solo ves las acciones dentro del alcance de tus roles.',
  // Gabarits de notification (US-021, NTF-001 ; catalogue réduit de la bêta). PROPOSÉS : à
  // reporter dans 10b §4.3 et à relire par l'UX. Variables nommées, identiques dans les quatre langues.
  'ntf.kycApproved.email.subject': 'Tu identidad está verificada · {brand}',
  'ntf.kycApproved.email.body':
    'Hola, {first_name}. Verificamos tu identidad: ya puedes reservar autos en {brand}.',
  'ntf.kycApproved.sms.body':
    '{brand}: {first_name}, tu identidad está verificada. Ya puedes reservar.',
  'ntf.bookingConfirmed.email.subject': 'Reserva {booking_ref} confirmada',
  'ntf.bookingConfirmed.email.body':
    'Hola, {first_name}. Tu reserva {booking_ref} está confirmada: del {start_at} al {end_at}. En la app encuentras el lugar de entrega, el contrato y los mensajes de la reserva.',
  'ntf.bookingConfirmed.sms.body':
    '{brand}: reserva {booking_ref} confirmada, del {start_at} al {end_at}. Detalles en la app.',
  'ntf.bookingCancelled.email.subject': 'Reserva {booking_ref} cancelada',
  'ntf.bookingCancelled.email.body':
    'Hola, {first_name}. La reserva {booking_ref} fue cancelada. En la app ves el detalle y, si corresponde, tu reembolso.',
  'ntf.bookingCancelled.sms.body':
    '{brand}: la reserva {booking_ref} fue cancelada. Detalles en la app.',
  'ntf.tripOverdue.email.subject': 'Reserva {booking_ref}: devolución atrasada',
  'ntf.tripOverdue.email.body':
    'Hola, {first_name}. El auto de la reserva {booking_ref} debía devolverse el {end_at} y la devolución aún no está registrada. Escribe a la otra parte desde los mensajes de la reserva.',
  'ntf.tripOverdue.sms.body':
    '{brand}: devolución atrasada de la reserva {booking_ref}, prevista el {end_at}. Escribe desde los mensajes de la app.',
  'ntf.payoutSent.email.subject': 'Te enviamos {amount}',
  'ntf.payoutSent.email.body':
    'Hola, {first_name}. Enviamos tu pago de {amount}. Tu banco puede tardar en acreditarlo. El detalle está en tus ganancias.',
  'ntf.payoutSent.sms.body': '{brand}: te enviamos un pago de {amount}. Detalle en tus ganancias.',
  'ntf.payoutOnHold.email.subject': 'Tu pago de {amount} está retenido',
  'ntf.payoutOnHold.email.body':
    'Hola, {first_name}. Tu pago de {amount} está retenido por ahora. En tus ganancias ves el motivo y qué hacer.',
  'ntf.payoutOnHold.sms.body':
    '{brand}: tu pago de {amount} está retenido. Motivo en tus ganancias.',
  'common.brand.tokensInvalid': 'El tema no tiene un formato válido. Revisa los valores señalados.',
  'common.brand.fontNotApproved': 'La fuente {font} no está en la lista aprobada.',
  'common.brand.contrastInsufficient':
    'No se publicó: el par {pair} no alcanza el contraste WCAG 2.2 AA.',
  'common.brand.versionNotFound': 'Esta versión no existe.',
  'common.brand.versionUnavailable':
    'El tema publicado no está disponible; se muestra el tema por defecto.',
  'common.brand.versionConflict': 'Esta versión ya cambió. Recarga e inténtalo de nuevo.',
  'common.brand.assetInvalid':
    'El archivo no es válido: PNG, JPEG o WebP (WOFF2 para una fuente), texto alternativo en español, inglés, francés y portugués, y licencia indicada.',
  'common.brand.assetUnavailable':
    'El almacenamiento de archivos no está disponible. Inténtalo más tarde.',
  'common.brand.contentLocaleMissing':
    'Falta el texto en {locale}: un bloque se publica en español, inglés, francés y portugués.',
  'common.brand.contentKeyForbidden': 'Los textos legales no se editan aquí.',
  'common.brand.contentMarkdownForbidden':
    'El texto contiene HTML o un enlace externo. Solo se permiten enlaces internos.',
  'common.brand.contentNotFound': 'Este bloque o esta versión no existe.',
  // Règles photo d'US-031 (ADR-069 point 7), versées depuis
  // `packages/design-tokens/rules/photo.messages.json` sans changer clés ni textes (ADR-071) ;
  // un test de `packages/i18n` vérifie que les deux restent identiques.
  'web.photo.angle.extFront.hint':
    'De frente, a unos tres pasos, con todo el parachoques en la foto.',
  'web.photo.angle.extFront.label': 'Frente',
  'web.photo.angle.extFront34Driver.hint':
    'Desde la esquina delantera del conductor: se ven el frente y el costado.',
  'web.photo.angle.extFront34Driver.label': 'Frente, lado del conductor',
  'web.photo.angle.extFront34Passenger.hint':
    'Desde la esquina delantera del pasajero: se ven el frente y el costado.',
  'web.photo.angle.extFront34Passenger.label': 'Frente, lado del pasajero',
  'web.photo.angle.extProfileDriver.hint':
    'Todo el costado del conductor, de rueda a rueda, desde el centro.',
  'web.photo.angle.extProfileDriver.label': 'Perfil del conductor',
  'web.photo.angle.extProfilePassenger.hint':
    'Todo el costado del pasajero, de rueda a rueda, desde el centro.',
  'web.photo.angle.extProfilePassenger.label': 'Perfil del pasajero',
  'web.photo.angle.extRear.hint': 'Frente al maletero, con todo el parachoques trasero en la foto.',
  'web.photo.angle.extRear.label': 'Parte trasera',
  'web.photo.angle.extRear34Driver.hint':
    'Desde la esquina trasera del conductor: se ven la parte trasera y el costado.',
  'web.photo.angle.extRear34Driver.label': 'Atrás, lado del conductor',
  'web.photo.angle.extRear34Passenger.hint':
    'Desde la esquina trasera del pasajero: se ven la parte trasera y el costado.',
  'web.photo.angle.extRear34Passenger.label': 'Atrás, lado del pasajero',
  'web.photo.angle.extSideDriverFront.hint':
    'Puerta delantera, guardabarros y espejo del conductor.',
  'web.photo.angle.extSideDriverFront.label': 'Costado del conductor, adelante',
  'web.photo.angle.extSideDriverRear.hint': 'Puerta trasera y guardabarros trasero del conductor.',
  'web.photo.angle.extSideDriverRear.label': 'Costado del conductor, atrás',
  'web.photo.angle.extSidePassengerFront.hint':
    'Puerta delantera, guardabarros y espejo del pasajero.',
  'web.photo.angle.extSidePassengerFront.label': 'Costado del pasajero, adelante',
  'web.photo.angle.extSidePassengerRear.hint':
    'Puerta trasera y guardabarros trasero del pasajero.',
  'web.photo.angle.extSidePassengerRear.label': 'Costado del pasajero, atrás',
  'web.photo.angle.extWheelDriverFront.hint': 'De cerca: toda la rueda, aro y neumático.',
  'web.photo.angle.extWheelDriverFront.label': 'Rueda delantera del conductor',
  'web.photo.angle.extWheelDriverRear.hint': 'De cerca: toda la rueda, aro y neumático.',
  'web.photo.angle.extWheelDriverRear.label': 'Rueda trasera del conductor',
  'web.photo.angle.extWheelPassengerFront.hint': 'De cerca: toda la rueda, aro y neumático.',
  'web.photo.angle.extWheelPassengerFront.label': 'Rueda delantera del pasajero',
  'web.photo.angle.extWheelPassengerRear.hint': 'De cerca: toda la rueda, aro y neumático.',
  'web.photo.angle.extWheelPassengerRear.label': 'Rueda trasera del pasajero',
  'web.photo.angle.extWindshieldRoof.hint':
    'Levanta un poco el teléfono: el parabrisas entero y, si se puede, el techo.',
  'web.photo.angle.extWindshieldRoof.label': 'Parabrisas y techo',
  'web.photo.angle.gaugeFuel.hint':
    'Motor encendido: el nivel de combustible o de batería se lee claro.',
  'web.photo.angle.gaugeFuel.label': 'Combustible o carga',
  'web.photo.angle.gaugeOdometer.hint': 'Motor encendido: todos los números del odómetro se leen.',
  'web.photo.angle.gaugeOdometer.label': 'Kilometraje',
  'web.photo.angle.intCenterConsole.hint': 'Palanca, pantalla y portavasos, de cerca.',
  'web.photo.angle.intCenterConsole.label': 'Consola central',
  'web.photo.angle.intDashboard.hint':
    'Desde el centro del asiento trasero: tablero y volante completos.',
  'web.photo.angle.intDashboard.label': 'Tablero',
  'web.photo.angle.intDriverSeat.hint':
    'Puerta abierta: asiento, piso y panel de la puerta del conductor.',
  'web.photo.angle.intDriverSeat.label': 'Asiento del conductor',
  'web.photo.angle.intFrontSeats.hint':
    'Con la puerta del conductor abierta: los dos asientos delanteros.',
  'web.photo.angle.intFrontSeats.label': 'Asientos delanteros',
  'web.photo.angle.intHeadliner.hint':
    'Apunta hacia arriba desde el asiento delantero: techo y espejo interior.',
  'web.photo.angle.intHeadliner.label': 'Techo interior',
  'web.photo.angle.intPassengerSeat.hint':
    'Puerta abierta: asiento, piso y panel de la puerta del pasajero.',
  'web.photo.angle.intPassengerSeat.label': 'Asiento del pasajero',
  'web.photo.angle.intRearSeats.hint': 'Con una puerta trasera abierta: todo el asiento trasero.',
  'web.photo.angle.intRearSeats.label': 'Asientos traseros',
  'web.photo.angle.intRearSeatsDriver.hint':
    'Puerta trasera del conductor abierta: asiento, piso y panel.',
  'web.photo.angle.intRearSeatsDriver.label': 'Atrás, lado del conductor',
  'web.photo.angle.intRearSeatsPassenger.hint':
    'Puerta trasera del pasajero abierta: asiento, piso y panel.',
  'web.photo.angle.intRearSeatsPassenger.label': 'Atrás, lado del pasajero',
  'web.photo.angle.intTrunk.hint': 'Maletero abierto y vacío, con el piso a la vista.',
  'web.photo.angle.intTrunk.label': 'Maletero',
  'web.photo.check.blurry': 'La foto salió movida. Sostén firme el teléfono y repítela.',
  'web.photo.check.galleryForbidden':
    'Para la entrega, toma la foto ahora con la cámara de la app.',
  'web.photo.check.personVisible': 'Hay una persona en la foto. Repítela sin nadie en el cuadro.',
  'web.photo.check.plateVisible': 'Se lee la placa. La difuminaremos antes de publicar la foto.',
  'web.photo.check.portrait': 'Gira el teléfono en horizontal para esta foto.',
  'web.photo.check.tooDark': 'La foto está muy oscura. Busca más luz y repítela.',
  'web.photo.check.tooSmall':
    'La foto es muy pequeña. Tómala con la cámara principal del teléfono.',
  'web.photo.handover.both':
    'El anfitrión y el viajero toman cada uno su serie. Una no reemplaza a la otra.',
  'web.photo.handover.camera': 'Usa la cámara de la app. No se aceptan fotos de la galería.',
  'web.photo.handover.count':
    'Toma {exterior} fotos por fuera, {interior} por dentro, el combustible y el kilometraje.',
  'web.photo.handover.plate':
    'Aquí la placa puede verse: estas fotos son prueba y nunca se publican.',
  'web.photo.handover.title': 'Fotos de entrega',
  'web.photo.listing.count':
    'Sube al menos {min} fotos. Con {recommended}, tu auto se ve completo.',
  'web.photo.listing.cover': 'Esta es la foto de portada: la primera que ven los viajeros.',
  'web.photo.listing.title': 'Fotos de tu auto',
  'web.photo.rule.forbidden.aiGenerated':
    'No se aceptan imágenes creadas o modificadas con inteligencia artificial.',
  'web.photo.rule.forbidden.contact':
    'Sin teléfonos, códigos QR ni enlaces: todo pasa por los mensajes de {brand}.',
  'web.photo.rule.forbidden.documents':
    'No fotografíes documentos ni pantallas con datos personales.',
  'web.photo.rule.forbidden.offensive':
    'Nada indecente, violento ni que ofenda a una persona o a un grupo.',
  'web.photo.rule.forbidden.overlay': 'Sin texto, logos, marcos ni marcas de agua sobre la foto.',
  'web.photo.rule.forbidden.people': 'Sin personas en la foto, ni siquiera en un reflejo.',
  'web.photo.rule.forbidden.plate':
    'Si la placa se puede leer, la difuminamos antes de publicar la foto.',
  'web.photo.rule.forbidden.stock':
    'Solo fotos de tu propio auto, nunca de internet ni de un catálogo.',
  'web.photo.rule.forbidden.unsafe':
    'El auto no debe verse en grúa, accidentado ni en un lugar peligroso.',
  'web.photo.rule.framing.background': 'Elige un fondo despejado, sin otros autos ni personas.',
  'web.photo.rule.framing.clean': 'Lava el auto y saca tus objetos personales antes de las fotos.',
  'web.photo.rule.framing.fill': 'El auto ocupa casi todo el ancho de la foto, sin cortarlo.',
  'web.photo.rule.framing.height': 'Para las fotos de afuera, ponte a la altura de los faros.',
  'web.photo.rule.framing.level': 'Sostén el teléfono en horizontal, con el horizonte recto.',
  'web.photo.rule.framing.safeArea':
    'Deja aire alrededor del auto: la portada se recorta un poco arriba y abajo.',
  'web.photo.rule.light.backlight': 'Ponte de espaldas al sol, nunca con el sol detrás del auto.',
  'web.photo.rule.light.daylight':
    'Toma las fotos de día, con luz suave: mañana, tarde o cielo nublado.',
  'web.photo.rule.light.night':
    'De noche, solo para la entrega: enciende una luz y acércate a cada daño.',
  'web.photo.rule.light.noFilter': 'Sin filtros ni retoques: la foto muestra el auto tal como es.',
  'web.photo.rule.light.reflections':
    'Muévete un poco si ves tu reflejo en la carrocería o en los vidrios.',
  'web.photo.slot.damage': 'Daño {number}',
  'web.photo.slot.key': 'Llave',
  // US-102 : inscription (S15), consentements versionnés et e-mails d'identité
  'common.auth.emailVerification.subject': 'Confirma tu correo en {brand}',
  'common.auth.emailVerification.body':
    'Hola: confirma tu correo para activar tu cuenta en {brand}.\n\n{link}\n\nEl enlace vence pronto. Si no creaste esta cuenta, ignora este mensaje.',
  'common.auth.accountExists.subject': 'Tu cuenta en {brand}',
  'common.auth.accountExists.body':
    'Alguien intentó crear una cuenta en {brand} con este correo. Si fuiste tú, ya tienes una cuenta: inicia sesión.\n\n{link}\n\nSi no fuiste tú, ignora este mensaje.',
  'common.legal.current': 'Tus documentos están al día.',
  'common.legal.reacceptRequired': 'Actualizamos los Términos. Acéptalos para seguir reservando.',
  'common.legal.versionChanged': 'Los documentos cambiaron mientras leías. Revísalos de nuevo.',
  'common.legal.unavailable': 'No podemos mostrar los documentos ahora. Inténtalo más tarde.',
  'common.legal.countryUnknown': 'Este destino todavía no está disponible. Elige otro.',
  'common.legal.notFound': 'No encontramos este documento.',
  'common.legal.consentRecorded': 'Listo, guardamos tu preferencia.',
  'web.s15.legalName': 'Nombre y apellido como en tu licencia',
  'web.s15.signup': 'Crear cuenta',
  'web.s15.title': 'Crea tu cuenta para reservar',
  'web.s15.intro': 'Solo te pedimos una cuenta cuando vas a reservar.',
  'web.s15.email': 'Correo electrónico',
  'web.s15.password': 'Contraseña',
  'web.s15.passwordHint': 'Al menos 10 caracteres.',
  'web.s15.terms': 'Acepto los Términos y la Política de privacidad',
  'web.s15.marketing': 'Quiero recibir novedades y ofertas (opcional)',
  'web.s15.login': 'Ya tengo cuenta',
  'web.s15.firstName': 'Nombre como en tu licencia',
  'web.s15.lastName': 'Apellido como en tu licencia',
  'web.s15.readTerms': 'Leer los Términos',
  'web.s15.readPrivacy': 'Leer la Política de privacidad',
  'web.s15.sent.title': 'Revisa tu correo',
  'web.s15.sent.body':
    'Si la dirección es correcta, te enviamos un enlace para confirmar tu cuenta. Ábrelo para seguir.',
  'web.s15.sent.spam': '¿No lo ves? Busca en tu carpeta de correo no deseado.',
  'web.s15.loginTitle': 'Inicia sesión',
  'web.s15.loginSubmit': 'Entrar',
  'web.s15.createAccount': 'Crear una cuenta nueva',
  'web.s15.verifyTitle': 'Confirma tu correo',
  'web.s15.verifyCta': 'Confirmar mi correo',
  'web.s15.loggedIn': 'Sesión iniciada. Ya puedes seguir.',
  'web.s15.reaccept.title': 'Actualizamos nuestros documentos',
  'web.s15.reaccept.intro': 'Antes de tu próxima reserva, lee y acepta la nueva versión.',
  'web.s15.reaccept.cta': 'Aceptar y seguir',
  'web.legal.draft': 'BORRADOR — pendiente de validación jurídica',
  'web.legal.version': 'Versión {version}',
  'web.legal.back': 'Volver al formulario',
  // US-113 : catalogue de référence des véhicules (16 HST-050), libellés partagés web / console
  'common.vehicle.bodyType.suv': 'SUV',
  'common.vehicle.bodyType.pickup': 'Pickup',
  'common.vehicle.bodyType.sedan': 'Sedán',
  'common.vehicle.bodyType.hatchback': 'Hatchback',
  'common.vehicle.bodyType.van': 'Van',
  'common.vehicle.bodyType.minivan': 'Minivan',
  'common.vehicle.bodyType.coupe': 'Cupé',
  'common.vehicle.bodyType.convertible': 'Convertible',
  'common.vehicle.bodyType.wagon': 'Station wagon',
  'common.vehicle.gearbox.manual': 'Manual',
  'common.vehicle.gearbox.automatic': 'Automática',
  'common.vehicle.gearbox.cvt': 'Automática (CVT)',
  'common.vehicle.gearbox.dualClutch': 'Automática de doble embrague',
  'common.vehicle.fuel.gasoline': 'Gasolina',
  'common.vehicle.fuel.diesel': 'Diésel',
  'common.vehicle.fuel.hybrid': 'Híbrido',
  'common.vehicle.fuel.plugInHybrid': 'Híbrido enchufable',
  'common.vehicle.fuel.electric': 'Eléctrico',
  'common.vehicle.fuel.lpg': 'GLP',
  'common.vehicle.drive.front': 'Tracción delantera',
  'common.vehicle.drive.rear': 'Tracción trasera',
  'common.vehicle.drive.allWheel': 'Tracción integral',
  'common.vehicle.drive.fourByFour': '4x4',
  'common.vehicle.consumption.value': '{value} L/100 km',
  'common.vehicle.consumption.usReference': 'referencia EE. UU.',
  'common.vehicle.catalog.notListed': 'Mi auto no está en la lista',
  'common.vehicle.catalog.variantRetired': 'Esta versión ya no está en el catálogo. Elige otra.',
  'common.vehicle.catalog.variantNotFound': 'No encontramos esta versión en el catálogo.',
} as const satisfies Catalog;

export type MessageKey = keyof typeof ES_MESSAGES;
