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
  // US-225 (ADR-164) : refus de la caution avant le paiement (10b UX-24 ; 08 BR-PAY-06, T59)
  'web.deposit.unavailable': {
    one: 'Para estas fechas no podemos tomar el depósito en tu tarjeta. Puedes reservar hasta {count} día.',
    other:
      'Para estas fechas no podemos tomar el depósito en tu tarjeta. Puedes reservar hasta {count} días.',
  },
  'web.deposit.unavailableNone':
    'Por ahora no podemos tomar el depósito en tu tarjeta para este auto.',
  // US-701 (ADR-169) : S05, aucune caution pour ce trip (08 BR-PAY-06 : l'absence est affichée)
  'web.deposit.none': 'Este viaje no requiere depósito de garantía.',
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
  'backoffice.content.gaps.title': {
    one: '{count} texto publicado necesita revisión',
    other: '{count} textos publicados necesitan revisión',
  },
  'backoffice.content.gaps.hint':
    'Mientras tanto, la página muestra el texto original en ese idioma.',
  'backoffice.content.gaps.missing': '{key} · {scope}: falta {locales}',
  'backoffice.content.gaps.invalid': '{key} · {scope}: formato no permitido ({locales})',
  'backoffice.content.gaps.notEditable':
    '{key} · {scope}: esta clave no es un texto editable; nunca se muestra.',
  'backoffice.content.gaps.common': 'común',
  'backoffice.content.gaps.error': 'No pudimos revisar los textos publicados.',
  'backoffice.o02.open': 'Apariencia y marca',
  'backoffice.o02.title': 'Apariencia y marca',
  'backoffice.o02.intro':
    'Cambia el nombre, el logo, los colores, las tipografías y los textos de la portada. El sitio no cambia hasta que publicas.',
  'backoffice.o02.back': 'Volver a la consola',
  'backoffice.o02.denied':
    'Esta pantalla es solo para administradores con sesión verificada. Abre la consola e inicia sesión con tu código.',
  'backoffice.o02.noVersion':
    'Aún no hay una versión publicada: el sitio usa el tema por defecto (Lienzo · Tinta).',
  'backoffice.o02.loadError': 'No pudimos cargar el historial de versiones. Recarga la página.',
  'backoffice.o02.history.title': 'Historial de versiones',
  'backoffice.o02.history.version': 'Versión {no} · {name}',
  'backoffice.o02.history.publish': 'Publicar la versión {no}',
  'backoffice.o02.status.DRAFT': 'Borrador',
  'backoffice.o02.status.PUBLISHED': 'Publicada',
  'backoffice.o02.status.ARCHIVED': 'Archivada',
  'backoffice.o02.rollback.action': 'Volver a la versión anterior',
  'backoffice.o02.rollback.hint':
    'Restaura la versión publicada antes de la actual, en un clic. Queda registrado en el diario.',
  'backoffice.o02.rollback.done':
    'Versión anterior restaurada (versión {no}). El sitio la muestra en menos de un minuto.',
  'backoffice.o02.publish.done':
    'Versión {no} publicada. El sitio la muestra en menos de un minuto.',
  'backoffice.o02.publish.refused':
    'Publicación rechazada: estos pares de colores no alcanzan el contraste mínimo (WCAG 2.2 AA).',
  'backoffice.o02.contrast.pair': '{pair}, modo {mode}: {ratio}:1 (mínimo {min}:1)',
  'backoffice.o02.contrast.ok':
    'Contraste AA: todos los pares de colores pasan. Este borrador se puede publicar.',
  'backoffice.o02.contrast.failing': {
    one: '{count} par de colores no alcanza el contraste: la publicación será rechazada.',
    other: '{count} pares de colores no alcanzan el contraste: la publicación será rechazada.',
  },
  'backoffice.o02.mode.light': 'claro',
  'backoffice.o02.mode.dark': 'oscuro',
  'backoffice.o02.draft.title': 'Nuevo borrador',
  'backoffice.o02.draft.base': 'Punto de partida',
  'backoffice.o02.draft.fromVersion': 'Versión {no} · {name}',
  'backoffice.o02.draft.fromPalette': 'Paleta {palette}',
  'backoffice.o02.draft.fromPaletteFailing':
    'Paleta {palette} (no pasa el contraste: corrige los colores antes de publicar)',
  'backoffice.o02.draft.brandName': 'Nombre de la marca',
  'backoffice.o02.draft.colors': 'Colores, modo {mode}',
  'backoffice.o02.draft.invalid': 'Este borrador no es válido: corrige los campos señalados.',
  'backoffice.o02.draft.save': 'Guardar el borrador',
  'backoffice.o02.draft.saved':
    'Borrador guardado (versión {no}). Revísalo en la vista previa y publícalo desde el historial.',
  'backoffice.o02.color.primary': 'Color de acción',
  'backoffice.o02.color.onPrimary': 'Texto sobre el color de acción',
  'backoffice.o02.color.accent': 'Acento',
  'backoffice.o02.color.onAccent': 'Texto sobre el acento',
  'backoffice.o02.color.surface': 'Fondo de página',
  'backoffice.o02.color.surfaceRaised': 'Fondo de tarjetas',
  'backoffice.o02.color.text': 'Texto',
  'backoffice.o02.color.textMuted': 'Texto secundario',
  'backoffice.o02.color.hint': 'Formato #RRGGBB: seis cifras hexadecimales.',
  'backoffice.o02.color.invalid': 'Escribe un color con el formato #RRGGBB.',
  'backoffice.o02.font.heading': 'Tipografía de los títulos',
  'backoffice.o02.font.body': 'Tipografía del texto',
  'backoffice.o02.font.keep': 'La del punto de partida',
  'backoffice.o02.font.hint': 'Solo tipografías de la lista aprobada (licencia verificada).',
  'backoffice.o02.logo.light': 'Logo (archivo SVG)',
  'backoffice.o02.logo.dark': 'Logo para el modo oscuro (archivo SVG)',
  'backoffice.o02.logo.hint':
    'SVG simple, de 20 000 caracteres como máximo, sin scripts, enlaces ni recursos externos. Sin archivo, se conserva el logo del punto de partida.',
  'backoffice.o02.logo.invalid':
    'Logo rechazado: debe ser un SVG simple, sin scripts, enlaces ni recursos externos.',
  'backoffice.o02.preview.title': 'Vista previa',
  'backoffice.o02.preview.hint':
    'Así se verá el sitio con este borrador. El sitio público no cambia hasta que publicas.',
  'backoffice.o02.preview.options': 'Opciones de la vista previa',
  'backoffice.o02.preview.light': 'Claro',
  'backoffice.o02.preview.dark': 'Oscuro',
  'backoffice.o02.preview.mobile': 'Móvil',
  'backoffice.o02.preview.desktop': 'Escritorio',
  'backoffice.o02.preview.unavailable':
    'Vista previa no disponible: el tema del borrador no es válido.',
  'backoffice.o02.preview.s01': 'Portada',
  'backoffice.o02.preview.s03': 'Ficha del auto',
  'backoffice.o02.preview.s05': 'Pago',
  'backoffice.o02.preview.a02': 'Espacio del anfitrión',
  'backoffice.o02.preview.email': 'Correo electrónico',
  'backoffice.o02.sample.where': '¿Dónde quieres recoger el auto?',
  'backoffice.o02.sample.search': 'Buscar autos',
  'backoffice.o02.sample.car': 'Auto de ejemplo · 2020',
  'backoffice.o02.sample.host': 'Ana',
  'backoffice.o02.sample.guest': 'Luis',
  'backoffice.o02.sample.verified': 'Identidad verificada',
  'backoffice.o02.sample.checkout': 'Confirma y paga',
  'backoffice.o02.sample.plan1': 'Protección básica',
  'backoffice.o02.sample.plan2': 'Protección estándar',
  'backoffice.o02.sample.plan3': 'Protección completa',
  'backoffice.o02.sample.checkoutNote': 'El anfitrión te entrega el auto en el punto acordado.',
  'backoffice.o02.sample.pay': 'Confirmar y pagar',
  'backoffice.o02.sample.greeting': 'Hola, Ana',
  'backoffice.o02.sample.confirmed': 'Confirmada',
  'backoffice.o02.sample.pending': 'Por aprobar',
  'backoffice.o02.sample.late': 'Con retraso',
  'backoffice.o02.sample.nextTrip': 'Próxima entrega: mañana',
  'backoffice.o02.sample.addCar': 'Agregar un auto',
  'backoffice.o02.sample.mailTitle': 'Tu reserva está confirmada',
  'backoffice.o02.sample.mailBody':
    'Ana te espera en el punto acordado. Revisa los detalles de tu viaje.',
  'backoffice.o02.sample.mailCta': 'Ver mi reserva',
  'backoffice.o02.sample.mailFooter': 'Recibes este correo porque reservaste un auto.',
  'backoffice.o02.assets.title': 'Imágenes de la marca',
  'backoffice.o02.assets.hint':
    'PNG, JPEG o WebP de 64 KB como máximo. Cada imagen pasa por el antivirus antes de guardarse; si el antivirus no está disponible, se rechaza.',
  'backoffice.o02.assets.kind': 'Tipo de imagen',
  'backoffice.o02.assets.kind.LOGO': 'Logo',
  'backoffice.o02.assets.kind.FAVICON': 'Icono de pestaña',
  'backoffice.o02.assets.kind.PWA_ICON': 'Icono de la aplicación',
  'backoffice.o02.assets.kind.HERO_IMAGE': 'Imagen de portada',
  'backoffice.o02.assets.file': 'Archivo',
  'backoffice.o02.assets.alt': 'Texto alternativo en {language}',
  'backoffice.o02.assets.license': 'Origen y licencia de la imagen',
  'backoffice.o02.assets.upload': 'Enviar la imagen',
  'backoffice.o02.assets.done': 'Imagen recibida y analizada por el antivirus.',
  'backoffice.o02.assets.empty': 'Elige un archivo.',
  'backoffice.o02.assets.tooBig': 'La imagen supera {max} KB.',
  'backoffice.o02.assets.badType': 'Solo se aceptan imágenes PNG, JPEG o WebP.',
  'backoffice.o02.content.title': 'Textos de la portada',
  'backoffice.o02.content.key': 'Texto que quieres cambiar',
  'backoffice.o02.content.body': 'Texto en {language}',
  'backoffice.o02.content.hintPlain':
    'Una sola línea, {max} caracteres como máximo, en los cuatro idiomas.',
  'backoffice.o02.content.hintRich':
    'Párrafos, listas, **negrita**, *cursiva* y enlaces internos; {max} caracteres como máximo, en los cuatro idiomas.',
  'backoffice.o02.content.publish': 'Guardar y publicar',
  'backoffice.o02.content.rollback': 'Volver al texto anterior',
  'backoffice.o02.content.published':
    'Texto publicado en los cuatro idiomas (versión {no}). El sitio lo muestra en menos de un minuto.',
  'backoffice.o02.content.rolledBack': 'Texto anterior restaurado.',
  'backoffice.o02.content.refused': 'No se guardó nada:',
  'backoffice.o02.content.legal':
    'No se puede editar aquí: la palabra «{word}» indica un texto legal (condiciones, contrato, privacidad, seguro…). Los textos legales son plantillas con versiones, fuera de esta pantalla.',
  'backoffice.o02.content.zwj':
    'Texto en {language}: contiene un carácter de unión invisible (ZWJ). Los emojis compuestos, como familias, persona con profesión o algunas banderas, no se aceptan, porque ese carácter puede disfrazar un texto. Usa un emoji simple.',
  'backoffice.o02.content.blank': 'Texto en {language}: está vacío o solo tiene espacios.',
  'backoffice.o02.content.tooLong': 'Texto en {language}: supera {max} caracteres.',
  'backoffice.o02.content.format':
    'Texto en {language}: formato no permitido (sin HTML, enlaces externos ni caracteres invisibles; una sola línea en los textos simples).',
  'backoffice.journal.caption': 'Registro de actividad',
  'backoffice.journal.when': 'Fecha',
  'backoffice.journal.who': 'Quién',
  'backoffice.journal.action': 'Acción',
  'backoffice.journal.subject': 'Sobre',
  'backoffice.journal.empty': 'Todavía no hay actividad registrada.',
  'backoffice.action.heading': 'Acción de consola',
  'backoffice.action.subject': 'Identificador del objeto (viaje, cuenta, caso…)',
  'backoffice.action.reason': 'Motivo',
  'backoffice.action.reasonHint': 'Entre 10 y 1000 caracteres. Queda en el registro.',
  'backoffice.action.CANCEL_TRIP_PLATFORM': 'Cancelar por la plataforma',
  'backoffice.action.DECLARE_NO_SHOW': 'Declarar no presentación',
  'backoffice.action.RECORD_CLAIM': 'Registrar un reclamo',
  // Cadre des actions de console (US-101), PROPOSÉS
  'common.auth.actionRequested': 'Solicitud registrada. Otra persona del equipo debe aprobarla.',
  'common.auth.actionRefused':
    'La acción fue rechazada: el estado actual no la permite. Quedó registrada.',
  'common.auth.selfApproval': 'No puedes aprobar tu propia solicitud. Debe hacerlo otra persona.',
  'backoffice.action.evidence': 'Comprobantes (identificadores)',
  'backoffice.action.evidenceHint':
    'Obligatorios para un registro: identificadores de los archivos recibidos, separados por comas (20 como máximo).',
  'backoffice.action.groupState': 'Cambiar un estado',
  'backoffice.action.groupRecord': 'Solo registrar (con comprobantes)',
  'backoffice.action.groupFinance': 'Decisiones financieras (dos personas)',
  'backoffice.action.amountNote': 'Nunca se ingresa un monto: lo calcula la plataforma.',
  'backoffice.action.CANCEL_TRIP_GUEST': 'Cancelar a pedido del viajero',
  'backoffice.action.CANCEL_TRIP_HOST': 'Cancelar a pedido del anfitrión',
  'backoffice.action.REFUSE_AT_PICKUP': 'Rechazar en la entrega',
  'backoffice.action.KYC_DECISION': 'Decidir la verificación de identidad',
  'backoffice.action.HOST_VERIFICATION_DECISION': 'Decidir la verificación del anfitrión',
  'backoffice.action.PUBLISH_LISTING': 'Publicar el anuncio',
  'backoffice.action.ESCALATE_OVERDUE': 'Escalar un retraso de devolución',
  'backoffice.action.REVIEW_FLAGGED_BOOKING': 'Revisar una reserva señalada',
  'backoffice.action.ISSUE_DECISION': 'Registrar una decisión',
  'backoffice.action.RECORD_CHARGEBACK': 'Registrar un contracargo',
  'backoffice.action.OPEN_INCIDENT': 'Abrir un incidente',
  'backoffice.action.RECORD_REVIEW': 'Registrar una reseña recibida por correo',
  'backoffice.action.HANDLE_DSR': 'Tratar una solicitud de datos personales',
  'backoffice.action.ISSUE_BORDEREAU': 'Solicitar la emisión del bordereau',
  'backoffice.action.DECIDE_ADVANCE': 'Solicitar la decisión de un anticipo',
  'backoffice.action.WRITE_OFF_RECEIVABLE': 'Solicitar dar por perdida una deuda',
  // Compte d'hôte d'une personne physique (US-107), PROPOSÉS
  'common.host.accountOpened':
    'Tu cuenta de anfitrión está abierta. Completa la verificación para publicar tu auto.',
  'common.host.accountExists': 'Ya tienes una cuenta de anfitrión aquí.',
  'common.host.entityNotAllowed':
    'Solo las personas pueden ser anfitrionas. No aceptamos empresas ni agencias.',
  'common.host.underAge': 'Todavía no tienes la edad mínima para ser anfitrión.',
  'common.host.notEligible':
    'Confirma tu correo y revisa el estado de tu cuenta antes de ser anfitrión.',
  'common.host.unavailable':
    'No podemos abrir cuentas de anfitrión en este momento. Inténtalo más tarde.',
  // Téléphone par OTP (US-104, 16 VER-013 ; PROPOSÉ, common.error.phoneDigits : 10b §4.3)
  'common.otp.sent': 'Te enviamos un código por SMS.',
  'common.otp.verified': 'Listo: tu teléfono está verificado.',
  'common.otp.alreadyVerified': 'Este número ya está verificado en tu cuenta.',
  'common.otp.invalid': 'El código no es correcto. Intentos que te quedan: {attempts}.',
  'common.otp.expired': 'Este código venció. Pide uno nuevo.',
  'common.otp.locked': 'Demasiados intentos. Vuelve a intentarlo en {minutes} min.',
  'common.otp.duplicatePhone':
    'Este número ya está verificado en otra cuenta. Usa otro número o escríbenos.',
  'common.otp.notEligible': 'Confirma tu correo antes de verificar tu teléfono.',
  'common.otp.phoneRequired': 'Verifica tu teléfono para seguir.',
  'common.otp.unavailable': 'No podemos enviar códigos en este momento. Inténtalo más tarde.',
  'common.otp.sms':
    '{brand}: tu código es {code}. Vence en {minutes} min. No lo compartas con nadie.',
  'common.error.phoneDigits': 'El número debe tener {digits} dígitos, por ejemplo {example}.',
  'backoffice.action.CREATE_HOST_ACCOUNT': 'Crear la cuenta de anfitrión de una persona',
  // Files de revue, fiche 360°, notes, dossiers, pièces et restrictions (US-109), PROPOSÉS
  'common.ops.caseRequired':
    'Para ver o anotar esta ficha, abre un caso o toma un elemento de la cola que la cubra.',
  'common.ops.selfForbidden':
    'No puedes tratar un expediente que te concierne (tu cuenta, tu auto o una cuenta vinculada). Otra persona del equipo debe hacerlo.',
  'common.ops.itemTaken': 'Otra persona del equipo ya tomó este elemento.',
  'common.bookingReview.notBooking':
    'Este elemento no es una reserva señalada. Ábrelo desde la ficha 360°.',
  'common.ops.userNotFound': 'No encontramos a nadie con ese correo en tu alcance.',
  'common.evidence.rejected':
    'Archivo rechazado: solo JPEG, PNG, HEIC o PDF sanos, de tamaño limitado.',
  'common.evidence.unavailable': 'No podemos recibir archivos por ahora. No se guardó nada.',
  'common.evidenceBundle.notFound':
    'No encontramos este expediente de pruebas entre los tuyos. Solo quien lo pidió puede abrirlo.',
  'common.evidenceBundle.notReady':
    'El expediente de pruebas aún se está preparando. Vuelve a intentarlo en unos minutos.',
  'common.evidenceBundle.expired':
    'El enlace del expediente de pruebas venció (7 días). Pide un expediente nuevo.',
  'common.evidenceBundle.failed':
    'No se pudo entregar el expediente: una prueba no coincide con su huella o falta. El hallazgo quedó registrado.',
  'common.evidenceBundle.unavailable':
    'El expediente de pruebas no está disponible por ahora. No se pidió ni se entregó nada.',
  'common.claim.notFound': 'No encontramos esta declaración.',
  'common.claim.deadlinePassed':
    'El plazo para declarar venció: se cuenta desde el fin del viaje (el más tardío entre el fin previsto y la devolución). No se registró nada.',
  'common.claim.windowUnknown':
    'El plazo de declaración no está configurado aquí. No se registró nada.',
  'common.claim.tripNotEligible':
    'Este viaje no empezó o fue cancelado: no admite una declaración de daño.',
  'common.claim.alreadyOpen':
    'Ya hay una declaración abierta de esta persona y de esta naturaleza para el viaje.',
  'common.claim.alreadyDecided':
    'Esta declaración ya tiene una decisión. Una revisión pasa por una impugnación.',
  'common.claim.decisionWithoutEvidence':
    'No se puede retener nada sin las fotos de salida y de devolución del viaje.',
  'common.claim.rationaleRequired':
    'Escribe los hechos de la decisión (20 caracteres como mínimo).',
  'common.claim.finalityForbidden':
    'Una decisión nunca es definitiva: quita esa mención, las vías de recurso se citan siempre.',
  'common.claim.legSumMismatch':
    'La suma de las partes no es igual al monto cobrado. No se preparó ninguna orden.',
  'common.claim.outcomeMismatch':
    'El resultado elegido no coincide con los montos (cobro al viajero, franquicia del anfitrión, cobertura).',
  'common.claim.capUnknown':
    'No encontramos la franquicia aceptada por el viajero en su contrato: no se puede cobrar nada.',
  'common.claim.aboveAcceptedAmount':
    'El monto supera la franquicia que el viajero aceptó en su contrato.',
  'common.claim.aboveRepairCost':
    'La reparación imputada o la franquicia del anfitrión supera el costo de reparación constatado.',
  'common.claim.adminRequired':
    'Una decisión que cobra al viajero o al anfitrión la toma un administrador.',
  'common.claim.agreementFileInvalid':
    'El acuerdo firmado del viajero no está entre las pruebas recibidas.',
  'common.claim.unavailable':
    'Las declaraciones de daño no están disponibles por ahora. No se registró nada.',
  'backoffice.claim.detailHeading': 'Declaración registrada',
  'backoffice.claim.adminOnly':
    'Esta decisión cobra al viajero o al anfitrión: solo un administrador puede registrarla. Pásale el caso.',
  'backoffice.claim.confirmCharge': 'Vas a cobrar {amount} en la tarjeta del viajero.',
  'backoffice.claim.confirmRetain': 'Vas a retener {retained} de los pagos del anfitrión.',
  'backoffice.claim.confirmFinal':
    'Una vez ejecutada por Kmino, la decisión no se deshace aquí: solo una impugnación puede revisarla.',
  'backoffice.claim.issueCharge': 'Cobrar {amount} y registrar la decisión',
  'backoffice.claim.amountHint': 'Ejemplo: 450 o 450,50',
  'backoffice.claim.amountHintWhole': 'Sin decimales, ejemplo: 450000',
  'backoffice.claim.heading': 'Daños, incidentes y decisiones',
  'backoffice.claim.lead':
    'Registra la declaración recibida en tu caso de soporte, revisa las pruebas y decide con la plantilla. Kmino ejecuta la decisión; nunca el anfitrión.',
  'backoffice.claim.recordHeading': 'Registrar una declaración',
  'backoffice.claim.trip': 'Identificador del viaje',
  'backoffice.claim.case': 'Identificador del caso de soporte',
  'backoffice.claim.caseHint': 'Un caso de categoría daño, abierto, de este viaje y asignado a ti.',
  'backoffice.claim.declaredBy': '¿Quién declara?',
  'backoffice.claim.declaredBy.HOST': 'El anfitrión',
  'backoffice.claim.declaredBy.GUEST': 'El viajero',
  'backoffice.claim.kind': 'Naturaleza',
  'backoffice.claim.kind.DAMAGE': 'Daño al vehículo',
  'backoffice.claim.kind.INCIDENT': 'Incidente o accidente',
  'backoffice.claim.description': 'Resumen de la declaración',
  'backoffice.claim.descriptionHint': 'De 10 a 1 000 caracteres. Sin nombres ni datos de contacto.',
  'backoffice.claim.deadlineNote':
    'El servidor juzga el plazo al registrar, según la configuración local: se cuenta desde el fin del viaje (el más tardío entre el fin previsto y la devolución).',
  'backoffice.claim.record': 'Registrar la declaración',
  'backoffice.claim.recorded':
    'Declaración registrada. El pago al anfitrión de este viaje queda retenido hasta la decisión.',
  'backoffice.claim.readHeading': 'Abrir una declaración',
  'backoffice.claim.claimId': 'Identificador de la declaración',
  'backoffice.claim.read': 'Ver la declaración',
  'backoffice.claim.error.trip': 'Escribe el identificador completo del viaje.',
  'backoffice.claim.error.case': 'Escribe el identificador completo del caso de soporte.',
  'backoffice.claim.error.who': 'Elige quién declara y la naturaleza de la declaración.',
  'backoffice.claim.error.description': 'El resumen debe tener de 10 a 1 000 caracteres.',
  'backoffice.claim.error.claim': 'Escribe el identificador completo de la declaración.',
  'backoffice.claim.error.amount':
    'Un monto no es válido en la moneda del viaje. No se envió nada.',
  'backoffice.claim.statusLabel': 'Estado',
  'backoffice.claim.status.REPORTED': 'Declarada, en instrucción',
  'backoffice.claim.status.DECIDED': 'Decidida',
  'backoffice.claim.deadline': 'Plazo',
  'backoffice.claim.deadlineValue': 'Declarada el {reported} · plazo hasta el {deadline}',
  'backoffice.claim.cap': 'Franquicia aceptada por el viajero',
  'backoffice.claim.capUnknown': 'Sin contrato firmado: no se puede cobrar nada',
  'backoffice.claim.evidenceHeading': 'Pruebas del viaje',
  'backoffice.claim.evidence.checkin': 'Fotos de salida recibidas',
  'backoffice.claim.evidence.checkinMissing': 'Faltan las fotos de salida',
  'backoffice.claim.evidence.checkout': 'Fotos de devolución recibidas',
  'backoffice.claim.evidence.checkoutMissing': 'Faltan las fotos de devolución',
  'backoffice.claim.decisionHeading': 'Preparar la decisión',
  'backoffice.claim.decisionLead':
    'Escribe los hechos y los montos por línea. La vista previa muestra la plantilla; nada se guarda antes de confirmar.',
  'backoffice.claim.outcome': 'Resultado',
  'backoffice.claim.outcome.GUEST_LIABLE': 'El viajero paga su parte del daño',
  'backoffice.claim.outcome.NO_GUEST_CHARGE': 'Nada que cobrar al viajero',
  'backoffice.claim.outcome.INELIGIBLE':
    'Declaración no admisible (desgaste, daño previo, fuera del viaje)',
  'backoffice.claim.covered':
    'El daño entra en la protección: se declara a la aseguradora asociada',
  'backoffice.claim.repairCost': 'Costo de reparación constatado ({currency})',
  'backoffice.claim.linesLegend': 'Líneas cobradas al viajero',
  'backoffice.claim.line.REPAIR': 'Reparación para el anfitrión',
  'backoffice.claim.line.INSURER_RECOVERY': 'Reembolso de la aseguradora',
  'backoffice.claim.line.PROCESSING_FEE': 'Cargo de gestión',
  'backoffice.claim.line.PROCESSING_FEE_TAX': 'Impuesto del cargo de gestión',
  'backoffice.claim.line.RECOVERY_PARKING':
    'Estacionamiento pagado por el anfitrión para recuperar su vehículo',
  'backoffice.claim.line.NOT_ATTRIBUTABLE': 'Cargo que no se puede imputar al viajero',
  'backoffice.claim.hostDeductible': 'Franquicia del anfitrión según su plan ({currency})',
  'backoffice.claim.hostDeductibleHint':
    'Se descuenta de los próximos pagos del anfitrión; nunca se cobra al viajero.',
  'backoffice.claim.facts': 'Hechos de la decisión',
  'backoffice.claim.factsCount': '{n} de 2000 caracteres (mínimo 20)',
  'backoffice.claim.factsHint':
    'Lo que muestran las pruebas, en 20 caracteres como mínimo. Sin nombres ni datos de contacto.',
  'backoffice.claim.preview': 'Ver la plantilla',
  'backoffice.claim.templateHeading': 'Plantilla de la decisión',
  'backoffice.claim.template.facts': 'Hechos',
  'backoffice.claim.template.rule': 'Regla aplicada',
  'backoffice.claim.template.amount': 'Monto cobrado al viajero',
  'backoffice.claim.template.amountValue':
    '{amount} (franquicia aceptada: {cap}) · cobro separado de la tarjeta, nunca con el depósito',
  'backoffice.claim.template.hostDeductible': 'Franquicia del anfitrión',
  'backoffice.claim.template.insurer': 'Aseguradora asociada',
  'backoffice.claim.template.insurerValue':
    'Declaración registrada para la aseguradora, sin compromiso de cobertura.',
  'backoffice.claim.template.recourse':
    'Esta decisión puede impugnarse: cada parte puede responder con nuevas pruebas y acudir a la autoridad de protección del consumidor.',
  'backoffice.claim.rule.GUEST_LIABLE':
    'El viajero responde del daño ocurrido durante el viaje, dentro de la franquicia que aceptó.',
  'backoffice.claim.rule.NO_GUEST_CHARGE': 'Las pruebas no justifican un cobro al viajero.',
  'backoffice.claim.rule.INELIGIBLE':
    'Desgaste, daño previo documentado o hecho fuera del viaje: no admisible.',
  'backoffice.claim.legsCaption': 'Partes del cobro, una por destinatario',
  'backoffice.claim.legColumn': 'Destinatario',
  'backoffice.claim.amountColumn': 'Monto',
  'backoffice.claim.excludedHeading': 'Excluido por la plantilla',
  'backoffice.claim.excludedLine': '{line}: {amount} — {why}',
  'backoffice.claim.excluded.parking':
    'no refacturable al viajero (estacionamiento para recuperar el vehículo)',
  'backoffice.claim.excluded.notAttributable': 'no refacturable al viajero (no le es imputable)',
  'backoffice.claim.issue': 'Registrar la decisión',
  'backoffice.claim.executionNote':
    'Kmino ejecuta la decisión: cobro separado notificado al viajero, franquicia en los pagos del anfitrión y declaración a la aseguradora.',
  'backoffice.claim.decided':
    'Decisión registrada. Kmino la ejecuta; el pago al anfitrión se libera cuando está ejecutada.',
  'backoffice.claim.decidedHeading': 'Decisión registrada',
  'backoffice.claim.execution': 'Ejecución por Kmino',
  'backoffice.claim.execution.PENDING': 'En curso',
  'backoffice.claim.execution.DONE': 'Ejecutada',
  'backoffice.claim.execution.BLOCKED': 'Bloqueada: sin tarjeta del alquiler, revisión del equipo',
  'backoffice.claim.insurer.PENDING': 'Registrada, pendiente de envío',
  'backoffice.claim.insurer.SENT': 'Enviada a la aseguradora',
  'common.reconciliation.statementTooLarge':
    'El extracto es demasiado grande para un solo envío (400 líneas como máximo). No se registró nada.',
  'common.reconciliation.statementNearLimit':
    'Este extracto tiene {lines} líneas, cerca del máximo de {max}. Prepara la conciliación automática antes del próximo mes.',
  'common.reconciliation.statementMissing':
    'Falta el extracto del PSP: agrega al menos una línea. No se registró nada.',
  'common.reconciliation.formatInvalid':
    'El extracto no es válido: línea mal formada, duplicada, en otra moneda o de un mes futuro. No se registró nada.',
  'common.reconciliation.checklistIncomplete':
    'La lista de control del mes no está completa: marca los cinco puntos para cerrar la conciliación.',
  'common.reconciliation.runClosed':
    'Esta conciliación ya está cerrada y firmada. No admite más cambios.',
  'common.reconciliation.itemSettled':
    'Esta diferencia ya está explicada, o la línea ya cuadra. No hay nada más que resolver.',
  'common.reconciliation.unavailable':
    'Las vistas y la conciliación no están disponibles por ahora. No se leyó ni se registró nada.',
  'backoffice.action.RESTRICT_ACCOUNT': 'Restringir la cuenta',
  'backoffice.action.LIFT_RESTRICTION': 'Levantar la restricción',
  'backoffice.queues.current': 'Cola mostrada',
  'common.evidence.tooLarge': 'Archivo demasiado grande: {max} KiB como máximo.',
  'common.evidence.badType': 'Formato no admitido: solo JPEG, PNG, HEIC o PDF.',
  'common.evidence.scanRefused': 'El análisis antivirus rechazó el archivo.',
  'backoffice.queues.heading': 'Colas de revisión',
  'backoffice.queues.summary': '{total} abiertos · {late} vencidos',
  'backoffice.queues.show': 'Ver la cola',
  'backoffice.queues.caption': 'Elementos de la cola',
  'backoffice.queues.subject': 'Asunto',
  'backoffice.queues.due': 'Plazo',
  'backoffice.queues.state': 'Asignación',
  'backoffice.queues.actions': 'Acciones',
  'backoffice.queues.overdue': 'Vencido',
  'backoffice.queues.onTime': 'A tiempo',
  'backoffice.queues.unassigned': 'Sin asignar',
  'backoffice.queues.mine': 'Tuyo',
  'backoffice.queues.taken': 'Tomado por otra persona',
  'backoffice.queues.claim': 'Tomar',
  'backoffice.queues.openKyc': 'Abrir el expediente KYC',
  'backoffice.queues.empty': 'No hay elementos abiertos.',
  'backoffice.queues.error': 'No pudimos leer las colas.',
  'backoffice.queue.KYC': 'Identidad',
  'backoffice.queue.LISTING': 'Anuncios',
  'backoffice.queue.HOST_VERIFICATION': 'Verificación de anfitriones',
  'backoffice.queue.RISK_BOOKING': 'Reservas señaladas',
  'backoffice.queue.CATALOG_ADDITION': 'Altas al catálogo',
  'backoffice.queue.OVERDUE': 'Devoluciones atrasadas',
  'backoffice.queue.GRAY_MARKET': 'Desvío de la plataforma',
  'backoffice.queue.LEG_RECONCILIATION': 'Conciliación de tramos',
  'backoffice.kyc.heading': 'Expediente KYC',
  'backoffice.kyc.logged': 'Esta consulta quedó en el registro de accesos.',
  'backoffice.kyc.birthDate': 'Fecha de nacimiento',
  'backoffice.kyc.residence': 'Residencia declarada',
  'backoffice.kyc.unknown': 'No indicado',
  'backoffice.kyc.NOT_STARTED': 'Verificación no iniciada',
  'backoffice.kyc.PHONE_VERIFIED': 'Teléfono verificado',
  'backoffice.kyc.DOCS_SUBMITTED': 'Documentos enviados',
  'backoffice.kyc.AUTO_CHECKS': 'Controles automáticos',
  'backoffice.kyc.MANUAL_REVIEW': 'En revisión manual',
  'backoffice.kyc.MORE_INFO_REQUIRED': 'Nuevo documento solicitado',
  'backoffice.kyc.APPROVED': 'Aprobada',
  'backoffice.kyc.RECHECK': 'Por revisar de nuevo',
  'backoffice.kyc.EXPIRED': 'Vencida',
  'backoffice.kyc.REVOKED': 'Revocada',
  'backoffice.kyc.REJECTED': 'Rechazada',
  'backoffice.kyc.APPEAL': 'En apelación',
  'backoffice.kyc.REJECTED_FINAL': 'Rechazo definitivo',
  'backoffice.kyc.BANNED': 'Excluida del servicio',
  'backoffice.kyc.reason': 'Causa',
  'backoffice.kyc.reason.PROVIDER_REVIEW': 'El proveedor pide una revisión',
  'backoffice.kyc.reason.PROVIDER_DECLINED': 'Rechazado por el proveedor',
  'backoffice.kyc.reason.DOCUMENT_MISSING': 'Faltan los datos de la licencia',
  'backoffice.kyc.reason.DOCUMENT_NOT_LICENSE': 'El documento no es una licencia de conducir',
  'backoffice.kyc.reason.LICENSE_PROVISIONAL': 'Licencia provisional o sin confirmar',
  'backoffice.kyc.reason.LICENSE_EXPIRED': 'Licencia vencida',
  'backoffice.kyc.reason.CONSENT_WITHDRAWN': 'Consentimiento biométrico retirado',
  'backoffice.kyc.reason.LIVENESS_FAILED': 'Prueba de vida o selfie no concluyentes',
  'backoffice.kyc.reason.ID_DOCUMENT_REFUSED': 'Documento de identidad rechazado',
  'backoffice.kyc.reason.LICENSE_NOT_ACCEPTED': 'Licencia fuera de la lista aceptada',
  'backoffice.kyc.reason.DUPLICATE_ACCOUNT': 'Cuenta duplicada o vinculada',
  'backoffice.kyc.reason.MORE_INFO_REQUESTED': 'Nuevo documento pedido por operaciones',
  'backoffice.kyc.reason.LEGAL_NAME_MISMATCH': 'El nombre de la cuenta no coincide con la licencia',
  'backoffice.kyc.reason.LEGAL_NAME_MISSING':
    'Nombre del titular ausente o ilegible en la licencia',
  'backoffice.kyc.reason.LEGAL_NAME_CHANGED': 'Nombre legal cambiado después de la aprobación',
  'backoffice.kyc.attempt': 'Intento y lugar del expediente',
  'backoffice.kyc.consentMissing':
    'Consentimiento biométrico ausente o desactualizado: no se puede aprobar.',
  'backoffice.kyc.document': 'Licencia devuelta por el proveedor',
  'backoffice.kyc.noDocument': 'No se recibió ningún dato de la licencia.',
  'backoffice.kyc.documentType': 'Clase de documento',
  'backoffice.kyc.issuingCountry': 'Emitido en',
  'backoffice.kyc.expiresOn': 'Vencimiento',
  'backoffice.kyc.licenseClass': 'Categoría',
  'backoffice.kyc.permanent': 'Licencia definitiva',
  'backoffice.kyc.holderName': 'Nombre en la licencia',
  'backoffice.kyc.nameMatch': 'Nombre de la cuenta y de la licencia',
  'backoffice.kyc.nameMatch.MATCH': 'Coinciden',
  'backoffice.kyc.nameMatch.MISMATCH': 'No coinciden: compáralos',
  'backoffice.kyc.nameMatch.MISSING': 'No se leyó el nombre de la licencia',
  'backoffice.kyc.yes': 'Sí',
  'backoffice.kyc.no': 'No',
  'backoffice.kyc.biometrics': 'Puntajes biométricos (lectura registrada)',
  'backoffice.kyc.noScores': 'Ningún puntaje conservado (borrado o no recibido).',
  'backoffice.kyc.livenessScore': 'Prueba de vida',
  'backoffice.kyc.faceMatchScore': 'Coincidencia facial',
  'backoffice.kyc.percent': '{value} %',
  'backoffice.kyc.doc.DRIVER_LICENSE': 'Licencia de conducir',
  'backoffice.kyc.doc.NATIONAL_ID': 'Cédula de identidad',
  'backoffice.kyc.doc.FOREIGN_RESIDENT_ID': 'Carné de residente extranjero',
  'backoffice.kyc.doc.PASSPORT': 'Pasaporte',
  'backoffice.kyc.doc.IDP': 'Permiso internacional (IDP)',
  'backoffice.kyc.decisionHeading': 'Decisión KYC',
  'backoffice.kyc.decisionHint':
    'Marcar cada control hecho en el portal del proveedor. Aprobar solo si los cuatro pasaron y la licencia es definitiva; rechazar si al menos uno falló.',
  'backoffice.kyc.check.livenessCheck': 'Selfie y prueba de vida',
  'backoffice.kyc.check.idDocumentCheck': 'Documento de identidad según el estatus',
  'backoffice.kyc.check.licenseListCheck': 'Licencia en la lista aceptada',
  'backoffice.kyc.check.duplicateCheck': 'Ninguna cuenta duplicada ni vinculada',
  'backoffice.kyc.passed': 'Aprobado',
  'backoffice.kyc.failed': 'Fallido',
  'backoffice.kyc.reasonHint':
    'Entre 10 y 1000 caracteres; queda en el registro con el autor y los controles marcados. Nunca lo ve la persona.',
  'backoffice.kyc.decide.APPROVED': 'Aprobar',
  'backoffice.kyc.decide.REJECTED': 'Rechazar',
  'backoffice.kyc.decide.MORE_INFO_REQUIRED': 'Pedir un nuevo documento',
  'backoffice.kyc.decided': 'Decisión registrada; el elemento de la cola quedó cerrado.',
  'backoffice.queues.openHost': 'Abrir el expediente del anfitrión',
  'backoffice.host.heading': 'Expediente del anfitrión',
  'backoffice.host.intro':
    'Revisión por excepción: un expediente completo y sin alertas se aprueba solo al cumplirse el plazo de revisión. Los motivos de alerta, si los hay, aparecen abajo.',
  'backoffice.host.status': 'Estado del expediente',
  'backoffice.host.status.NOT_SUBMITTED': 'No enviado',
  'backoffice.host.status.OPEN': 'Abierto',
  'backoffice.host.status.DOCS_PENDING': 'Incompleto',
  'backoffice.host.status.IN_REVIEW': 'En revisión',
  'backoffice.host.status.APPROVED': 'Aprobado',
  'backoffice.host.status.REJECTED': 'Rechazado',
  'backoffice.host.status.REVOKED': 'Revocado',
  'backoffice.host.hold':
    'Retención por sanciones: coincidencia posible que revisa un ADMIN. El anfitrión no recibe ningún aviso.',
  'backoffice.host.reviewReasons': 'Motivo de la revisión',
  'backoffice.host.reason.SCREENING_HOLD': 'Coincidencia en una lista de sanciones',
  'backoffice.host.reason.ACCOUNT_RESTRICTED':
    'Cuenta restringida, cerrada o con una retención activa',
  'backoffice.host.reason.COUNTRY_REVIEW':
    'La configuración exige una revisión del equipo de operaciones',
  'backoffice.host.noReason': 'Ninguna alerta',
  'backoffice.host.checklist': 'Lista de control',
  'backoffice.host.item.IDENTITY': 'Identidad verificada',
  'backoffice.host.item.AGE': 'Edad mínima',
  'backoffice.host.item.RESIDENCE': 'Residencia',
  'backoffice.host.item.SANCTIONS': 'Listas de sanciones',
  'backoffice.host.item.TAX_PROFILE': 'Perfil fiscal',
  'backoffice.host.item.HOST_TERMS': 'Condiciones del anfitrión aceptadas',
  'backoffice.host.item.PAYOUT_ACCOUNT': 'Cuenta de pagos con el proveedor',
  'backoffice.host.item.PSP_CAPABILITIES': 'Capacidades del proveedor de pagos',
  'backoffice.host.item.COUNTRY_OPEN': 'Mercado abierto a anfitriones particulares',
  'backoffice.host.item.INSURER_CONTRACT': 'Contrato de la aseguradora activo',
  'backoffice.host.state.OK': 'Cumplido',
  'backoffice.host.state.MISSING': 'Por completar',
  'backoffice.host.state.BLOCKED': 'Bloqueado',
  'backoffice.host.state.HELD': 'Retenido',
  'backoffice.host.screening': 'Filtrado de sanciones',
  'backoffice.host.source': 'Fuente',
  'backoffice.host.source.OPS_MANUAL': 'Consulta manual del equipo de operaciones',
  'backoffice.host.source.MANUAL': 'Revisión de un ADMIN',
  'backoffice.host.screenedAt': 'Fecha del filtrado',
  'backoffice.host.result': 'Resultado',
  'backoffice.host.result.CLEAR': 'Sin coincidencia',
  'backoffice.host.result.POTENTIAL_MATCH': 'Coincidencia posible',
  'backoffice.host.result.CONFIRMED_MATCH': 'Coincidencia confirmada',
  'backoffice.host.noScreening': 'Todavía no hay filtrado registrado.',
  'backoffice.host.evidence': {
    one: '{count} documento adjunto al filtrado',
    other: '{count} documentos adjuntos al filtrado',
  },
  'backoffice.host.subject': 'Identificador de la cuenta de anfitrión',
  'backoffice.host.screeningHeading': 'Filtrado manual de sanciones',
  'backoffice.host.screeningHint':
    'Consulta cada lista y luego indica su resultado. Una coincidencia pasa a un ADMIN; el anfitrión no recibe ningún aviso.',
  'backoffice.host.list.unList': 'Lista consolidada de las Naciones Unidas',
  'backoffice.host.list.ofacList': 'Lista OFAC',
  'backoffice.host.list.nationalList': 'Lista nacional que corresponde a la cuenta',
  'backoffice.host.clear': 'Sin coincidencia',
  'backoffice.host.match': 'Coincidencia posible',
  'backoffice.host.record': 'Registrar el filtrado',
  'backoffice.booking.open': 'Abrir la reserva',
  'backoffice.booking.heading': 'Reserva señalada',
  'backoffice.booking.introBefore':
    'Revisión antes del cobro: no se cobra nada al viajero antes de tu decisión.',
  'backoffice.booking.introAfter': 'Revisión después del pago: el viaje ya puede estar pagado.',
  'backoffice.booking.status': 'Estado de la reserva',
  'backoffice.booking.expires': 'Vence',
  'backoffice.booking.period': 'Periodo del viaje',
  'backoffice.booking.score': 'Puntuación de riesgo',
  'backoffice.booking.signals': 'Señales',
  'backoffice.booking.signal.ACCOUNT_AGE': 'Cuenta creada hace menos de 24 h',
  'backoffice.booking.signal.START_SOON': 'Salida en menos de 3 h',
  'backoffice.booking.signal.PREMIUM': 'Vehículo Premium',
  'backoffice.booking.signal.LUXE': 'Vehículo de lujo',
  'backoffice.booking.signal.ENTRY_NOT_DECLARED': 'Licencia extranjera, entrada no declarada',
  'backoffice.booking.signal.RESIDENT_FOREIGN_LICENSE': 'Residente con licencia extranjera',
  'backoffice.booking.signal.BEYOND_90_DAYS': 'Fin del viaje más de 90 días después de la entrada',
  'backoffice.booking.entry': 'Entrada declarada',
  'backoffice.booking.entryNone': 'Sin declaración',
  'backoffice.booking.entryTourist': 'Turista, entró el {date}',
  'backoffice.booking.entryResident': 'Residente',
  'backoffice.booking.decisionHeading': 'Decisión',
  'backoffice.booking.decisionHint':
    'Aprobar le da al viajero {minutes} min para pagar; todavía no recibe aviso automático. Rechazar libera las fechas sin ningún cobro.',
  'backoffice.booking.decision': 'Tu decisión',
  'backoffice.booking.approve': 'Aprobar la reserva',
  'backoffice.booking.reject': 'Rechazar la reserva',
  'backoffice.booking.record': 'Guardar la decisión',
  'backoffice.booking.approved':
    'Reserva aprobada. El viajero tiene {minutes} min para pagar y todavía no recibe aviso automático: avísale tú.',
  'backoffice.booking.rejected':
    'Reserva rechazada. Las fechas quedan libres, sin cobro. El viajero todavía no recibe aviso automático.',
  'backoffice.booking.hold.ACTIVE': 'En revisión',
  'backoffice.booking.hold.ACTIVE_OPEN': 'Activa',
  'backoffice.booking.hold.PAYMENT_IN_FLIGHT': 'Pago en curso',
  'backoffice.booking.hold.CONVERTED': 'Pagada',
  'backoffice.booking.hold.EXPIRED': 'Vencida',
  'backoffice.booking.hold.RELEASED': 'Liberada',
  'backoffice.booking.hold.COMPENSATED': 'Compensada',
  'backoffice.booking.refusal.alreadyDecided': 'Esta reserva ya tiene una decisión.',
  'backoffice.booking.refusal.bookingUnavailable':
    'No encontramos el periodo de esta reserva. Avisa a un administrador.',
  'backoffice.booking.refusal.paramMissing':
    'Falta un parámetro del plazo de pago. Avisa a un administrador.',
  'backoffice.booking.refusal.notFound': 'Esta evaluación no es una reserva en revisión.',
  'backoffice.booking.refusal.notClaimed': 'Toma el elemento en la fila antes de decidir.',
  'backoffice.booking.refusal.notLive': 'Esta reserva ya no está activa.',
  'backoffice.booking.refusal.expired':
    'El plazo de revisión venció: recházala ahora. Si no, se liberará sola en un minuto, sin cobro.',
  'backoffice.booking.refusal.startPassed': 'El viaje ya empezó. Solo puedes rechazar la reserva.',
  'backoffice.booking.refusal.ineligible':
    'El viajero ya no cumple los controles. Solo puedes rechazar la reserva.',
  'backoffice.booking.refusal.paymentInFlight':
    'Hay un pago en curso. Inténtalo de nuevo en unos minutos.',
  'backoffice.booking.refusal.cancellationUnavailable':
    'El viaje ya está pagado. Su anulación con reembolso aún no está disponible aquí.',
  'backoffice.host.recorded': 'Filtrado registrado.',
  'backoffice.host.refused.HOST_ALREADY_SCREENED':
    'Este expediente ya tiene un filtrado registrado.',
  'backoffice.host.refused.HOST_VERIFICATION_NOT_READY':
    'El anfitrión todavía no envió su expediente.',
  'backoffice.host.refused.SELF_FORBIDDEN': 'No puedes filtrar tu propia cuenta.',
  'backoffice.dsr.hint':
    'Registra cada etapa de una solicitud recibida por un expediente de soporte: el plazo legal se sigue y un retraso se señala.',
  'backoffice.dsr.subject': 'Identificador del expediente de soporte',
  'backoffice.dsr.kind': 'Tipo de solicitud',
  'backoffice.dsr.kind.ACCESS': 'Acceso',
  'backoffice.dsr.kind.RECTIFICATION': 'Rectificación',
  'backoffice.dsr.kind.DELETION': 'Supresión',
  'backoffice.dsr.kind.OPPOSITION': 'Oposición',
  'backoffice.dsr.kind.PORTABILITY': 'Portabilidad',
  'backoffice.dsr.step': 'Etapa',
  'backoffice.dsr.step.RECEIVED': 'Recibida',
  'backoffice.dsr.step.VERIFYING': 'Verificación de identidad',
  'backoffice.dsr.step.IN_PROGRESS': 'En curso (identidad verificada)',
  'backoffice.dsr.step.BLOCKED_LEGAL_HOLD': 'Suspendida por una obligación legal de conservación',
  'backoffice.dsr.step.DONE': 'Respondida',
  'backoffice.dsr.step.REJECTED': 'Rechazada',
  'backoffice.dsr.record': 'Registrar la etapa',
  'backoffice.dsr.recorded': 'Etapa registrada; el plazo sigue en curso hasta la respuesta.',
  'backoffice.dsr.refused.DSR_INPUT_REQUIRED': 'Indica el tipo de solicitud y la etapa.',
  'backoffice.dsr.refused.DSR_NOT_OPEN':
    'Este expediente aún no tiene solicitud: registra primero la etapa «Recibida».',
  'backoffice.dsr.refused.DSR_ALREADY_OPEN': 'Este expediente ya tiene una solicitud abierta.',
  'backoffice.dsr.refused.DSR_KIND_MISMATCH':
    'El tipo no coincide con el de la solicitud abierta en este expediente.',
  'backoffice.dsr.refused.DSR_TRANSITION_INVALID':
    'Esta etapa no puede seguir a la etapa actual de la solicitud.',
  'backoffice.dsr.refused.DSR_DELAY_UNKNOWN':
    'El plazo legal de respuesta aún no está configurado: no se registró nada.',
  'backoffice.review.hint':
    'Registra una reseña recibida por correo sobre un viaje terminado, dentro del plazo de calificación que sigue a su fin. Adjunta el correo como pieza.',
  'backoffice.review.subject': 'Identificador del viaje',
  'backoffice.review.author': 'Autor de la reseña',
  'backoffice.review.author.GUEST': 'El viajero (reseña del anfitrión y del auto)',
  'backoffice.review.author.HOST': 'El anfitrión (reseña del viajero)',
  'backoffice.review.overall': 'Calificación general',
  'backoffice.review.overall.ONE': '1 estrella',
  'backoffice.review.overall.TWO': '2 estrellas',
  'backoffice.review.overall.THREE': '3 estrellas',
  'backoffice.review.overall.FOUR': '4 estrellas',
  'backoffice.review.overall.FIVE': '5 estrellas',
  'backoffice.review.record': 'Registrar la reseña',
  'backoffice.review.recorded': 'Reseña registrada y vinculada al viaje.',
  'backoffice.review.refused.REVIEW_INPUT_REQUIRED':
    'Indica el autor de la reseña y la calificación.',
  'backoffice.review.refused.REVIEW_TRIP_NOT_COMPLETED':
    'Este viaje aún no ha terminado: no se registró nada.',
  'backoffice.review.refused.REVIEW_WINDOW_CLOSED':
    'El plazo de calificación de este viaje ya cerró: no se registró nada.',
  'backoffice.review.refused.REVIEW_WINDOW_UNKNOWN':
    'El plazo de calificación no está configurado: no se registró nada.',
  'backoffice.review.refused.REVIEW_AUTHOR_UNKNOWN':
    'No se encontró al autor de esta reseña: no se registró nada.',
  'backoffice.review.refused.REVIEW_ALREADY_RECORDED':
    'Esta persona ya calificó este viaje: no se registró nada.',
  'backoffice.kyc.refused.CHECKS_REQUIRED':
    'Decisión rechazada: hay que marcar los cuatro controles.',
  'backoffice.kyc.refused.CHECKS_INCONSISTENT':
    'Decisión rechazada: aprobar exige cuatro controles aprobados y rechazar, al menos uno fallido.',
  'backoffice.kyc.refused.ITEM_NOT_CLAIMED':
    'Decisión rechazada: primero hay que tomar el elemento en la cola KYC.',
  'backoffice.kyc.refused.NOT_IN_REVIEW':
    'Decisión rechazada: el expediente ya no está en revisión (ya decidido o consentimiento retirado).',
  'backoffice.kyc.refused.SELF_FORBIDDEN':
    'Decisión rechazada: nadie decide su propia verificación.',
  'backoffice.kyc.refused.CONSENT_WITHDRAWN':
    'Aprobación rechazada: falta el consentimiento biométrico vigente.',
  'backoffice.kyc.refused.LICENSE_NOT_ACCEPTED':
    'Aprobación rechazada: solo se acepta una licencia de conducir definitiva y vigente (no un IDP solo ni una licencia provisional).',
  'backoffice.kyc.refused.PRODUCTION_BLOCKED':
    'Decisión no disponible: la verificación de identidad está cerrada en este entorno.',
  'backoffice.profile.heading': 'Ficha 360°',
  'backoffice.profile.intro':
    'Cada consulta queda registrada con su motivo. El soporte y operaciones necesitan un caso o un elemento de cola asignado.',
  'backoffice.profile.email': 'Correo de la persona',
  'backoffice.profile.userId': 'Identificador de la persona',
  'backoffice.profile.purpose': 'Motivo de la consulta',
  'backoffice.profile.purposeHint': 'Entre 10 y 500 caracteres; queda en el registro de accesos.',
  'backoffice.profile.search': 'Buscar',
  'backoffice.profile.open': 'Abrir la ficha',
  'backoffice.profile.identity': 'Identidad y contacto',
  'backoffice.profile.verified': 'verificado',
  'backoffice.profile.notVerified': 'sin verificar',
  'backoffice.profile.accountStatus': 'Estado de la cuenta: {status}',
  'backoffice.profile.kycStatus': 'Verificación de identidad',
  'backoffice.profile.restricted':
    'Cuenta restringida: no puede reservar y sus autos están cerrados a reservas.',
  'backoffice.profile.restrictions': 'Restricciones',
  'backoffice.profile.kind': 'Tipo de restricción',
  'backoffice.profile.reason': 'Motivo',
  'backoffice.profile.since': 'Desde',
  'backoffice.profile.active': 'Activa',
  'backoffice.profile.lifted': 'Levantada',
  'backoffice.profile.noRestriction': 'Ninguna restricción.',
  'backoffice.restriction.TS_HOLD': 'Bloqueo de seguridad',
  'backoffice.restriction.POLICY_VIOLATION': 'Incumplimiento de las reglas',
  'backoffice.restriction.UNPAID_BALANCE': 'Saldo impago',
  'backoffice.restriction.CHARGEBACK': 'Contracargo',
  'backoffice.restriction.PAYMENT_PLAN_ACTIVE': 'Plan de pagos activo',
  'backoffice.restriction.KYC_REVOKED': 'Verificación revocada',
  'backoffice.profile.restrictKind': 'Tipo de restricción',
  'backoffice.profile.hostAccounts': 'Cuentas de anfitrión',
  'backoffice.profile.bookable': 'Reservable',
  'backoffice.profile.closed': 'Cerrada a reservas',
  'backoffice.profile.noHost': 'No es anfitrión.',
  'backoffice.profile.trips': 'Viajes como huésped',
  'backoffice.profile.noTrip': 'Ningún viaje.',
  'backoffice.profile.hostTrips': 'Viajes próximos como anfitrión',
  'backoffice.profile.noHostTrip': 'Ningún viaje próximo como anfitrión.',
  'backoffice.profile.cases': 'Casos de soporte',
  'backoffice.profile.noCase': 'Ningún caso.',
  'backoffice.profile.notes': 'Notas internas',
  'backoffice.profile.noNote': 'Ninguna nota.',
  'backoffice.profile.note': 'Nota interna (nunca visible para la persona)',
  'backoffice.profile.addNote': 'Agregar la nota',
  'backoffice.profile.noteAdded': 'Nota agregada.',
  'backoffice.case.heading': 'Abrir un caso para esta persona',
  'backoffice.case.category': 'Categoría',
  'backoffice.case.channel': 'Canal de contacto',
  'backoffice.case.open': 'Abrir el caso',
  'backoffice.case.resolve': 'Marcar resuelto',
  'backoffice.case.opened': 'Caso abierto y asignado a ti.',
  'backoffice.case.status.OPEN': 'Abierto',
  'backoffice.case.status.PENDING': 'En espera',
  'backoffice.case.status.RESOLVED': 'Resuelto',
  'backoffice.case.status.CLOSED': 'Cerrado',
  'backoffice.case.category.TRIP': 'Viaje',
  'backoffice.case.category.PAYMENT': 'Pago',
  'backoffice.case.category.ACCOUNT': 'Cuenta',
  'backoffice.case.category.LISTING': 'Anuncio',
  'backoffice.case.category.CLAIM': 'Daño',
  'backoffice.case.category.SAFETY': 'Seguridad',
  'backoffice.case.category.OTHER': 'Otro',
  'backoffice.case.channel.WHATSAPP': 'Mensaje de WhatsApp',
  'backoffice.case.channel.EMAIL': 'Correo',
  'backoffice.case.channel.PHONE': 'Teléfono',
  'backoffice.case.channel.IN_APP': 'En la app',
  'backoffice.evidence.heading': 'Agregar una pieza',
  'backoffice.evidence.file': 'Archivo JPEG, PNG, HEIC o PDF (64 KiB como máximo)',
  'backoffice.evidence.upload': 'Subir la pieza',
  'backoffice.evidence.received': 'Pieza recibida: {id}. Úsala en una acción de consola.',
  'backoffice.approvals.caption': 'Solicitudes financieras por aprobar',
  'backoffice.approvals.hint': 'Una solicitud la aprueba otra persona, nunca quien la hizo.',
  'backoffice.approvals.request': 'Solicitud',
  'backoffice.approvals.country': 'Ámbito',
  'backoffice.approvals.reason': 'Motivo indicado',
  'backoffice.approvals.requestedAt': 'Solicitada el',
  'backoffice.approvals.approve': 'Aprobar',
  'backoffice.approvals.empty': 'No hay solicitudes pendientes.',
  'backoffice.approvals.error': 'No pudimos cargar las solicitudes financieras.',
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
    'Hola, {first_name}. Tu reserva {booking_ref} está confirmada: del {start_at} al {end_at}. En tu reserva en {brand} encuentras la dirección exacta del lugar de entrega, el contrato para leer y firmar antes de la entrega y los mensajes con tu anfitrión. Lleva tu licencia de conducir física y tu documento de identidad: el anfitrión los revisará en la entrega. Para tu seguridad: encuéntrense en un lugar público e iluminado, avisa a alguien de confianza dónde estarás y escribe solo por {brand}. {assistance}',
  'ntf.bookingConfirmed.sms.body':
    '{brand}: reserva {booking_ref} confirmada, del {start_at} al {end_at}. Lleva tu licencia física. Dirección y contrato en la app. {assistance}',
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
  'common.brand.contentKeyNotEditable': 'Este texto no se puede editar como bloque.',
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
  // Étape OTP de S15 (US-104) : clés du prototype US-033 devenues officielles, puis PROPOSÉES
  'web.s15.phone': 'Teléfono',
  'web.s15.code': 'Código de 6 dígitos',
  'web.s15.verify': 'Verificar',
  'web.s15.codeSent': 'Código enviado a {phone}',
  'web.s15.resendIn': { one: 'Reenviar en {count} segundo', other: 'Reenviar en {count} segundos' },
  'web.s15.phoneTitle': 'Verifica tu teléfono',
  'web.s15.phoneIntro':
    'Lo usamos para coordinar la entrega del auto. Nunca se lo mostramos al anfitrión.',
  'web.s15.phoneCountry': 'Prefijo internacional',
  'web.s15.phoneHint': 'Por ejemplo {example}',
  'web.s15.sendCode': 'Enviar código',
  'web.s15.resend': 'Enviar un código nuevo',
  'web.s15.changePhone': 'Usar otro número',
  'web.s15.phoneVerified': 'Teléfono verificado: {phone}',
  'web.s15.codeHint': 'Te llega por SMS. Puedes pegarlo.',
  'web.legal.version': 'Versión {version}',
  'web.legal.back': 'Volver al formulario',
  'web.legal.validFrom': 'Vigente desde el {date}',
  'web.legal.translation': 'Traducción: el texto en español hace fe.',
  'web.legal.backHost': 'Volver a tu espacio de anfitrión',
  // US-113 : catalogue de référence des véhicules (16 HST-050), libellés partagés web / console
  // US-115 : écrans A10 (espace de l'hôte) et S03 (fiche publique d'une annonce)
  'web.host.title': 'Publicar tu auto',
  'web.host.intro': 'Tu lugar de entrega, tu auto y su precio. Guardamos tu avance.',
  'web.host.loginRequired': 'Inicia sesión para publicar tu auto.',
  'web.host.login': 'Iniciar sesión',
  'web.host.noAccount': 'Todavía no tienes cuenta de anfitrión',
  'web.host.noAccount.body': 'Ábrela desde tu perfil para publicar tu primer auto.',
  'web.host.error': 'No pudimos cargar tus autos. Revisa tu conexión e inténtalo de nuevo.',
  'web.host.retry': 'Reintentar',
  'web.host.loading': 'Cargando tus autos…',
  'web.host.saved': 'Guardado',
  'web.host.empty': 'Aún no publicaste ningún auto',
  'web.host.empty.body': 'Te guiamos paso a paso y guardamos tu avance.',
  'web.host.places.title': 'Lugares de entrega',
  'web.host.places.empty': 'Agrega el lugar donde entregas el auto.',
  'web.host.place.kind': 'Tipo de lugar',
  'web.host.place.kind.HOME': 'Mi casa',
  'web.host.place.kind.POI': 'Un lugar público',
  'web.host.place.kind.AIRPORT': 'En el aeropuerto',
  'web.host.place.label': 'Nombre del lugar (solo lo ves tú)',
  'web.host.place.address': 'Dirección exacta',
  'web.host.place.city': 'Ciudad o localidad',
  'web.host.place.area': 'Barrio o zona, sin calle ni número (lo ve el viajero)',
  'web.host.place.privacy': 'La dirección exacta se muestra solo después de reservar.',
  'web.host.place.add': 'Guardar el lugar',
  'web.host.cars.title': 'Tus autos',
  'web.host.cars.needPlace': 'Primero agrega un lugar de entrega.',
  'web.host.car.plate': 'Placa',
  'web.host.car.vin': 'Número de chasis (VIN)',
  'web.host.car.vinHint':
    'VIN de 17 caracteres (ej.: 1HGCM82633A004352) o número de chasis de un auto importado (ej.: GRJ150-0012345).',
  'web.host.car.make': 'Marca',
  'web.host.car.model': 'Modelo',
  'web.host.car.year': 'Año',
  'web.host.car.seats': 'Asientos',
  'web.host.car.place': 'Lugar de entrega',
  'web.host.car.transmission': 'Caja de cambios',
  'web.host.car.transmission.MANUAL': 'Manual',
  'web.host.car.transmission.AUTOMATIC': 'Automática',
  'web.host.car.fuel': 'Combustible',
  'web.host.car.fuel.GASOLINE': 'Gasolina',
  'web.host.car.fuel.DIESEL': 'Diésel',
  'web.host.car.fuel.HYBRID': 'Híbrido',
  'web.host.car.fuel.EV': 'Eléctrico',
  'web.host.car.add': 'Guardar el auto',
  'web.host.listings.title': 'Tus anuncios',
  'web.host.listings.needCar': 'Primero agrega un auto.',
  'web.host.listing.car': 'Auto',
  'web.host.listing.price': 'Precio por día ({currency})',
  'web.host.listing.km': 'Kilómetros incluidos por día (vacío: ilimitado)',
  'web.host.listing.extraKm': 'Precio por kilómetro extra ({currency})',
  'web.host.listing.create': 'Crear el borrador',
  'web.host.listing.photos': { one: '{count} foto', other: '{count} fotos' },
  'web.host.listing.savePrice': 'Guardar el precio',
  'web.host.listing.photo': 'Foto del auto (JPEG, PNG o WebP)',
  'web.host.listing.addPhoto': 'Agregar la foto',
  'web.host.listing.submit': 'Publicar el anuncio',
  'web.host.listing.delete': 'Eliminar el borrador',
  'web.host.listing.unlist': 'Retirar el anuncio',
  'web.host.listing.relist': 'Volver a publicar',
  'web.host.account.market': 'Cuenta: {country} · precios en {currency}',
  'web.host.account.switch': 'Tus cuentas de anfitrión',
  'web.host.listing.photo.hint': 'Hasta {max} por foto.',
  'web.host.listing.photo.closed':
    'Todavía no recibimos fotos: podrás agregarlas pronto. Tu borrador queda guardado.',
  'web.host.listing.deleteListing': 'Eliminar el anuncio',
  'web.host.listing.deleteConfirm': 'Sí, eliminar este anuncio. No se puede deshacer.',
  'web.host.listing.view': 'Ver la ficha pública',
  'web.host.listing.unlimited': 'Kilometraje ilimitado',
  'web.host.listing.kmPerDay': { one: '{count} km por día', other: '{count} km por día' },
  'web.host.status.DRAFT': 'Borrador',
  'web.host.status.BLOCKED_ELIGIBILITY': 'Bloqueado',
  'web.host.status.PENDING_REVIEW': 'En revisión',
  'web.host.status.LISTED': 'Publicado',
  'web.host.status.REJECTED': 'Rechazado',
  'web.host.status.SNOOZED': 'En pausa',
  'web.host.status.UNLISTED': 'Retirado',
  'web.host.status.RESTRICTED': 'Restringido',
  'web.host.status.REMOVED_BY_PLATFORM': 'Retirado por la plataforma',
  'web.host.status.DELETED': 'Eliminado',
  // US-126 : CGU de l'hôte (A07, LEG-001)
  'web.host.terms.title': 'Condiciones del anfitrión',
  'web.host.terms.intro':
    'Alquilas tu propio auto directamente al viajero; nosotros solo somos intermediarios y no somos parte del contrato de alquiler.',
  'web.host.terms.version': 'Versión {version}, vigente desde el {date}',
  'web.host.terms.read': 'Leer las Condiciones del anfitrión',
  'web.host.terms.required': 'Acéptalas antes de enviar tu primer anuncio.',
  'web.host.terms.reaccept':
    'Publicamos una nueva versión. Acéptala para seguir enviando anuncios.',
  'web.host.terms.checkbox': 'Leí y acepto las Condiciones del anfitrión',
  'web.host.terms.accept': 'Aceptar las condiciones',
  'web.host.terms.accepted': 'Aceptaste la versión {version} el {date}.',
  'web.listing.notFound': 'Este auto ya no está disponible',
  'web.listing.notFound.body': 'Puede que el anfitrión lo haya retirado. Busca otro auto cerca.',
  'web.listing.search': 'Buscar otro auto',
  'web.listing.error': 'No pudimos cargar este auto. Inténtalo de nuevo.',
  'web.listing.loading': 'Cargando el auto…',
  'web.listing.perDay': '{amount} por día',
  'web.listing.features': 'Lo esencial',
  'web.listing.seats': { one: '{count} asiento', other: '{count} asientos' },
  'web.listing.instant': 'Confirmación inmediata',
  'web.listing.request': 'Reserva por solicitud',
  'web.listing.meet.title': 'Dónde recoges el auto',
  'web.listing.meet.approx': 'Zona aproximada. La dirección exacta aparece al confirmar.',
  // US-115 : lieux de remise, véhicules et annonces de l'hôte (codes de 16 A.8 et PROPOSÉS)
  'common.listing.locationCreated': 'Lugar de entrega guardado.',
  'common.listing.vehicleCreated': 'Auto guardado.',
  'common.listing.created': 'Borrador del anuncio creado.',
  'common.listing.saved': 'Guardado',
  'common.listing.submitted': 'Enviamos tu anuncio a revisión.',
  'common.listing.published': 'Tu anuncio está publicado.',
  'common.listing.unlisted': 'Retiramos tu anuncio. Puedes volver a publicarlo cuando quieras.',
  'common.listing.hasFutureTrips':
    'Tu auto tiene viajes reservados por venir. Podrás retirar el anuncio cuando terminen o se cancelen.',
  'common.listing.vehicleEligibilityRequired':
    'Antes de publicar, confirma los datos de tu auto (propiedad, kilometraje y número de chasis).',
  'common.listing.areaLooksLikeAddress':
    'Indica solo el barrio o la zona, sin calle ni número: el viajero lo ve antes de reservar.',
  'common.listing.cityInvalid': 'Indica solo la ciudad, sin dirección, teléfono ni enlace.',
  'common.listing.offPlatformPayment':
    'No propongas pagos fuera de la plataforma (efectivo, transferencias o billeteras): todos los pagos se hacen en la app.',
  'common.listing.vehicleDescriptionInvalid':
    'Escribe solo la marca y el modelo del auto, sin teléfono, enlace ni dirección.',
  'common.listing.photoAdded': 'Foto agregada.',
  'common.listing.deleted': 'Anuncio eliminado.',
  'common.listing.hostSuspended':
    'Tu cuenta de anfitrión está suspendida: no puedes modificar tus anuncios.',
  'common.listing.hostNotFound': 'No encontramos esta cuenta de anfitrión.',
  'common.listing.locationNotFound': 'No encontramos este lugar de entrega.',
  'common.listing.vehicleNotFound': 'No encontramos este auto.',
  'common.listing.notFound': 'No encontramos este anuncio.',
  'common.listing.variantNotFound':
    'Esta versión no está en el catálogo para tu auto. Elige otra o pide que la agreguemos.',
  'common.listing.variantRetired': 'Esta versión ya no está disponible en el catálogo. Elige otra.',
  'common.listing.plateDuplicate': 'Esta placa o este número de chasis (VIN) ya está registrado.',
  'common.listing.exists': 'Este auto ya tiene un anuncio.',
  'common.listing.transitionForbidden':
    'No es posible hacer este cambio en el estado actual del anuncio.',
  'common.listing.vehicleFieldRequired':
    'Revisa los datos del auto: falta un campo obligatorio o no es válido.',
  'common.listing.locationFieldInvalid':
    'Revisa el lugar de entrega: falta un campo o no es válido.',
  'common.listing.priceInvalid': 'El precio por día no es válido para esta moneda.',
  'common.listing.mileageInvalid': 'Revisa la distancia incluida y el precio por kilómetro extra.',
  'common.listing.requestModeNotAllowed': 'En un aeropuerto, la reserva es siempre inmediata.',
  'common.listing.photoMinCount': 'Agrega más fotos de tu auto antes de publicar el anuncio.',
  'common.listing.photoFormat': 'Esta foto no se puede usar. Sube una foto JPEG, PNG o WebP.',
  'common.listing.photoLimitReached':
    'Este anuncio ya tiene el número máximo de fotos. Quita una foto antes de agregar otra.',
  'common.listing.hostTermsRequired':
    'Antes de publicar tu anuncio, lee y acepta la versión vigente de las Condiciones del anfitrión.',
  'common.listing.vehicleNotCovered':
    'Este vehículo no cumple las condiciones de la protección de los viajes (antigüedad, valor o uso). No se puede publicar.',
  'common.listing.insurerInactive':
    'Todo listo de tu lado. La protección de los viajes todavía no está disponible aquí; podrás publicar tu anuncio cuando lo esté.',
  'common.listing.hostNotActivated':
    'Todo listo de tu lado. Podrás publicar tu anuncio cuando tu cuenta de anfitrión esté activa y abramos a anfitriones aquí.',
  // US-202 : devis (16 PRC-025, PRC-020) : prix impossible, dates invalides, prix changé
  'common.quote.unavailable':
    'No podemos calcular el precio de este auto para estas fechas. Prueba otras fechas o elige otro auto.',
  'common.quote.datesInvalid': 'Revisa las fechas: la devolución debe ser después de la entrega.',
  'common.quote.changed': 'El precio cambió. Revisa el nuevo total antes de continuar.',
  'common.quote.line.tripFee': 'Tarifa del viaje',
  'common.quote.line.tripFeeHint':
    'Cubre el servicio de la plataforma: la reserva, el pago seguro y la ayuda durante el viaje. Se reembolsa si cancelas sin costo.',
  'common.listing.unavailable':
    'No podemos guardar tu anuncio en este momento. Inténtalo más tarde.',
  'common.listing.photoUnavailable': 'Todavía no podemos recibir fotos. Inténtalo más tarde.',
  'common.listing.field.required': 'Este campo es obligatorio.',
  'common.listing.field.invalid': 'Este valor no es válido.',
  'common.listing.photoTooLarge': 'Esta foto pesa demasiado: hasta {max} por foto.',
  'common.listing.deleteConfirmRequired': 'Marca la casilla para confirmar.',
  'common.listing.priceFormat': 'Escribe el precio así: {example}.',
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
  'common.catalogAddition.requested':
    'Pedimos agregar tu auto al catálogo. Te avisaremos cuando esté listo.',
  'common.catalogAddition.pending':
    'Tu auto todavía no está en el catálogo. Podrás enviar el anuncio cuando el equipo lo agregue.',
  'common.catalogAddition.duplicate': 'Ya hay una solicitud abierta para este auto.',
  'common.catalogAddition.alreadyLinked': 'Este auto ya está en el catálogo.',
  'common.catalogAddition.closed': 'Esta solicitud ya fue resuelta.',
  'common.catalogAddition.variantExists':
    'Esta versión ya está en el catálogo. Vincúlala en lugar de crearla.',
  'common.catalogAddition.variantNotFound':
    'Esta versión no sirve para este auto: otro mercado, otro año o ya retirada.',
  'common.catalogAddition.entryInvalid':
    'Revisa los datos de la versión: hay un valor no válido o no cubren el año del auto.',
  'web.host.car.catalogHint':
    'Si tu auto no está en el catálogo, el equipo lo revisa y lo agrega antes de que publiques.',
  'web.host.catalog.status.OPEN': 'Pendiente de catálogo',
  'web.host.catalog.status.APPROVED': 'En el catálogo',
  'web.host.catalog.status.MERGED': 'En el catálogo',
  'web.host.catalog.status.REJECTED': 'No agregado',
  'web.host.catalog.pending':
    'El equipo lo revisa antes del {date}. Mientras tanto, tu anuncio queda en borrador.',
  'web.host.catalog.reason.INSUFFICIENT_DETAILS': 'Faltan datos para identificar tu auto.',
  'web.host.catalog.reason.UNKNOWN_MODEL': 'No pudimos identificar la marca o el modelo.',
  'web.host.catalog.reason.NOT_ELIGIBLE': 'Este vehículo no se puede publicar en la plataforma.',
  'web.host.catalog.retry': 'Corrige la marca y el modelo, y vuelve a pedirlo',
  'web.host.catalog.send': 'Volver a pedir',
  'ntf.catalogAdditionApproved.email.subject': 'Tu auto ya está en el catálogo',
  'ntf.catalogAdditionApproved.email.body':
    'Hola, {first_name}. Agregamos tu auto al catálogo de {brand}. Ya puedes enviar tu anuncio desde tu espacio de anfitrión.',
  'ntf.catalogAdditionApproved.sms.body':
    '{brand}: tu auto ya está en el catálogo. Ya puedes enviar tu anuncio.',
  'ntf.catalogAdditionRejected.email.subject': 'No pudimos agregar tu auto al catálogo',
  'ntf.catalogAdditionRejected.email.body':
    'Hola, {first_name}. No pudimos agregar tu auto al catálogo de {brand}. En tu espacio de anfitrión ves el motivo y puedes corregir la marca y el modelo.',
  'ntf.catalogAdditionRejected.sms.body':
    '{brand}: no pudimos agregar tu auto al catálogo. Motivo en tu espacio de anfitrión.',
  'ntf.tripHostRestricted.email.subject': 'Reserva {booking_ref}: aviso sobre tu anfitrión',
  'ntf.tripHostRestricted.email.body':
    'Hola, {first_name}. Estamos revisando la cuenta del anfitrión de tu reserva {booking_ref}. Tu reserva sigue registrada y te mantendremos informado. Si el anfitrión la cancela, recibes el reembolso total. Detalles en la app.',
  'ntf.tripHostRestricted.sms.body':
    '{brand}: estamos revisando la cuenta del anfitrión de tu reserva {booking_ref}. Reembolso total si el anfitrión la cancela. Detalles en la app.',
  'ntf.tripNoShowReported.email.subject': 'Reserva {booking_ref}: el viajero indicó tu ausencia',
  'ntf.tripNoShowReported.email.body':
    'Hola, {first_name}. El viajero de la reserva {booking_ref} indicó que no te presentaste a la entrega. Kmino lo está verificando antes de decidir. Si estuviste ahí, escríbenos desde la ayuda del viaje en la app.',
  'ntf.tripNoShowReported.sms.body':
    '{brand}: el viajero de la reserva {booking_ref} indicó que no llegaste. Lo estamos verificando. Si estuviste ahí, escríbenos desde la app.',
  'ntf.tripHostRestrictionLifted.email.subject':
    'Reserva {booking_ref}: novedad sobre tu anfitrión',
  'ntf.tripHostRestrictionLifted.email.body':
    'Hola, {first_name}. Terminamos la revisión de la cuenta del anfitrión de tu reserva {booking_ref}. Tu reserva sigue en pie, sin cambios. Detalles en la app.',
  'ntf.tripHostRestrictionLifted.sms.body':
    '{brand}: terminamos la revisión del anfitrión de tu reserva {booking_ref}. Tu reserva sigue en pie. Detalles en la app.',
  // confirmation et demandes de réservation (US-213, ADR-157)
  'ntf.bookingConfirmedHost.email.subject': 'Reserva {booking_ref} confirmada',
  'ntf.bookingConfirmedHost.email.body':
    'Hola, {first_name}. La reserva {booking_ref} de tu auto está confirmada: del {start_at} al {end_at}. {brand} ya recibió el pago del viajero. En tu espacio de anfitrión ves el viaje y los mensajes con el viajero. En la entrega, revisa su licencia de conducir física y que su nombre sea el de la reserva. {assistance}',
  'ntf.bookingConfirmedHost.sms.body':
    '{brand}: reserva {booking_ref} confirmada, del {start_at} al {end_at}. Detalles en tu espacio de anfitrión. {assistance}',
  // numéros du support et de l’assistance de l’assureur (US-213, ADR-174)
  'ntf.assistance.guest.email.numbers':
    'Soporte de {brand}: {support_phone}. Asistencia de la aseguradora (avería o accidente): {insurer_phone}.',
  'ntf.assistance.guest.email.inApp':
    'Para hablar con el soporte de {brand} o pedir asistencia por una avería o un accidente, entra a tu reserva en la app.',
  'ntf.assistance.guest.sms.numbers': 'Soporte: {support_phone}. Asistencia: {insurer_phone}.',
  'ntf.assistance.guest.sms.inApp': 'Soporte y asistencia en la app.',
  'ntf.assistance.host.email.numbers': 'Soporte de {brand}: {support_phone}.',
  'ntf.assistance.host.email.inApp':
    'Para hablar con el soporte de {brand}, entra a tu espacio de anfitrión.',
  'ntf.assistance.host.sms.numbers': 'Soporte: {support_phone}.',
  'ntf.assistance.host.sms.inApp': 'Soporte en tu espacio de anfitrión.',
  'ntf.bookingRequestReceived.email.subject': 'Nueva solicitud de reserva {booking_ref}',
  'ntf.bookingRequestReceived.email.body':
    'Hola, {first_name}. Un viajero te envió la solicitud de reserva {booking_ref}. Tienes hasta el {respond_by} para aceptarla o rechazarla en tu espacio de anfitrión de {brand}. Si no respondes a tiempo, la solicitud vence y no se le cobra nada al viajero.',
  'ntf.bookingRequestReceived.sms.body':
    '{brand}: nueva solicitud {booking_ref}. Responde antes del {respond_by} en tu espacio de anfitrión.',
  'ntf.bookingRequestDeclined.email.subject': 'Solicitud {booking_ref} no aceptada',
  'ntf.bookingRequestDeclined.email.body':
    'Hola, {first_name}. El anfitrión no aceptó tu solicitud {booking_ref}. No se te cobró nada: anulamos la autorización de tu pago. Puedes buscar otro auto para las mismas fechas en {brand}.',
  'ntf.bookingRequestDeclined.sms.body':
    '{brand}: tu solicitud {booking_ref} no fue aceptada. No se te cobró nada. Busca otro auto en la app.',
  'ntf.bookingRequestExpired.email.subject': 'Solicitud {booking_ref} sin respuesta del anfitrión',
  'ntf.bookingRequestExpired.email.body':
    'Hola, {first_name}. El anfitrión no respondió a tiempo a tu solicitud {booking_ref}. No se te cobró nada: anulamos la autorización de tu pago. Puedes buscar otro auto para las mismas fechas en {brand}.',
  'ntf.bookingRequestExpired.sms.body':
    '{brand}: tu solicitud {booking_ref} venció sin respuesta. No se te cobró nada. Busca otro auto en la app.',
  'ntf.bookingRequestFailed.email.subject': 'Reserva {booking_ref} no confirmada',
  'ntf.bookingRequestFailed.email.body':
    'Hola, {first_name}. El anfitrión aceptó tu solicitud {booking_ref}, pero no pudimos confirmar el cobro y la reserva no se hizo. No pagues de nuevo: anulamos la autorización de tu pago. Si ves un cargo, escríbenos desde tu reserva en {brand} y te devolvemos todo el pago.',
  'ntf.bookingRequestFailed.sms.body':
    '{brand}: la reserva {booking_ref} no se confirmó. No pagues de nuevo. Si ves un cargo, te devolvemos todo. Detalles en la app.',
  'ntf.bookingRequestFailedHost.email.subject': 'Reserva {booking_ref} no confirmada',
  'ntf.bookingRequestFailedHost.email.body':
    'Hola, {first_name}. Aceptaste la solicitud {booking_ref}, pero no pudimos confirmar el cobro al viajero y la reserva no se hizo. Las fechas vuelven a estar libres en tu calendario de {brand}. No entregues el auto para esta solicitud.',
  'ntf.bookingRequestFailedHost.sms.body':
    '{brand}: la solicitud {booking_ref} que aceptaste no se confirmó. Fechas liberadas. No entregues el auto.',
  'ntf.depositReleased.email.subject': 'Liberamos tu depósito de {amount}',
  'ntf.depositReleased.email.body':
    'Hola, {first_name}. Liberamos tu depósito de garantía de {amount} del viaje {booking_ref}. Tu banco puede tardar unos días en mostrarlo.',
  'ntf.depositReleased.sms.body':
    '{brand}: liberamos tu depósito de {amount} del viaje {booking_ref}. Tu banco puede tardar unos días en mostrarlo.',
  'ntf.depositPartiallyCaptured.email.subject': 'Tu depósito: {captured} cobrado, resto liberado',
  'ntf.depositPartiallyCaptured.email.body':
    'Hola, {first_name}. Del depósito de garantía del viaje {booking_ref}, cobramos {captured} por los cargos adicionales que te avisamos y liberamos {amount}. Tu banco puede tardar unos días en mostrarlo.',
  'ntf.depositPartiallyCaptured.sms.body':
    '{brand}: de tu depósito del viaje {booking_ref}, cobramos {captured} de cargos ya avisados y liberamos {amount}.',
  'ntf.depositBlockedUntilExpiry.email.subject': 'Tu depósito de {amount} sigue bloqueado',
  'ntf.depositBlockedUntilExpiry.email.body':
    'Hola, {first_name}. No pudimos anular la retención de tu depósito de garantía de {amount} del viaje {booking_ref}. No te cobramos nada: tu banco mantiene ese monto bloqueado como máximo hasta el {expires_at} y luego lo libera automáticamente.',
  'ntf.depositBlockedUntilExpiry.sms.body':
    '{brand}: tu depósito de {amount} del viaje {booking_ref} sigue bloqueado por tu banco hasta el {expires_at}, sin cobro. Luego se libera solo.',
  'backoffice.catalog.open': 'Abrir la solicitud',
  'backoffice.catalog.heading': 'Solicitud de alta al catálogo',
  'backoffice.catalog.requested': 'Lo que escribió el anfitrión',
  'backoffice.catalog.vin': 'VIN (sin número de serie)',
  'backoffice.catalog.declared': 'Datos declarados del auto',
  'backoffice.catalog.due': 'Decidir antes del {date}',
  'backoffice.catalog.candidates': 'Versiones del catálogo para este auto',
  'backoffice.catalog.noCandidate': 'Ninguna versión del catálogo corresponde a la marca y al año.',
  'backoffice.catalog.version': 'Versión',
  'backoffice.catalog.years': 'Años',
  'backoffice.catalog.modelMatch': 'Mismo modelo',
  'backoffice.catalog.merge': 'Vincular esta versión',
  'backoffice.catalog.approveHeading': 'Crear la versión en el catálogo',
  'backoffice.catalog.makeName': 'Marca',
  'backoffice.catalog.modelName': 'Modelo',
  'backoffice.catalog.bodyType': 'Carrocería',
  'backoffice.catalog.yearFrom': 'Desde el año',
  'backoffice.catalog.yearTo': 'Hasta el año',
  'backoffice.catalog.trimName': 'Versión o acabado',
  'backoffice.catalog.transmission': 'Caja de cambios',
  'backoffice.catalog.fuel': 'Combustible',
  'backoffice.catalog.drive': 'Tracción',
  'backoffice.catalog.seats': 'Asientos',
  'backoffice.catalog.doors': 'Puertas',
  'backoffice.catalog.licenseNote': 'Fuente y licencia de los datos',
  'backoffice.catalog.licenseHint':
    'Indica de dónde vienen los datos, por ejemplo el título del vehículo. Nunca copies otro sitio ni un anuncio.',
  'backoffice.catalog.approve': 'Crear y vincular',
  'backoffice.catalog.rejectHeading': 'Rechazar con un motivo',
  'backoffice.catalog.reject.INSUFFICIENT_DETAILS': 'Datos insuficientes',
  'backoffice.catalog.reject.UNKNOWN_MODEL': 'Modelo desconocido',
  'backoffice.catalog.reject.NOT_ELIGIBLE': 'Vehículo no admitido',
  'backoffice.catalog.done.APPROVED': 'Versión creada y vinculada. Avisamos al anfitrión.',
  'backoffice.catalog.done.MERGED': 'Versión vinculada. Avisamos al anfitrión.',
  'backoffice.catalog.done.REJECTED': 'Solicitud rechazada. Avisamos al anfitrión.',
  'common.calendar.blockCreated': 'Fechas bloqueadas.',
  'common.calendar.blockRemoved': 'Fechas desbloqueadas.',
  'common.calendar.noticeSaved': 'Preaviso guardado.',
  'common.calendar.vehicleUnavailable': 'Esas fechas ya están ocupadas. Elige otras.',
  'common.calendar.notListed': 'Publica tu anuncio antes de bloquear fechas.',
  'common.calendar.blockNotFound': 'Este bloqueo ya no existe.',
  'common.calendar.invalidPeriod':
    'Revisa las fechas: el final debe ser posterior al inicio y aún no haber pasado.',
  'common.calendar.noticeInvalid': 'Elige un preaviso entre 1 hora y 7 días.',
  'web.calendar.title': 'Calendario',
  'web.calendar.intro':
    'Mira cuándo está ocupado tu auto, bloquea días u horas y fija tu preaviso.',
  'web.calendar.open': 'Ver calendario',
  'web.calendar.back': 'Volver a mis autos',
  'web.calendar.notFound': 'No encontramos este auto.',
  'web.calendar.timezone': 'Horas en la zona horaria del auto ({timezone}).',
  'web.calendar.upcoming.title': 'Próximas ocupaciones',
  'web.calendar.empty': 'No hay ocupaciones próximas: tu auto está disponible.',
  'web.calendar.kind.TRIP': 'Viaje confirmado',
  'web.calendar.kind.HOLD': 'Reserva en curso',
  'web.calendar.kind.HOST_BLOCK': 'Bloqueado por ti',
  'web.calendar.kind.BUFFER': 'Margen entre viajes',
  'web.calendar.range': 'Del {start} al {end}',
  'web.calendar.remove': 'Desbloquear',
  'web.calendar.block.title': 'Bloquear fechas',
  'web.calendar.block.notListed': 'Podrás bloquear fechas cuando tu anuncio esté publicado.',
  'web.calendar.block.days': 'Bloquear días completos',
  'web.calendar.block.from': 'Desde el día',
  'web.calendar.block.to': 'Hasta el día (incluido)',
  'web.calendar.block.submitDays': 'Bloquear estos días',
  'web.calendar.block.hours': 'Bloquear algunas horas',
  'web.calendar.block.date': 'Día',
  'web.calendar.block.start': 'Desde',
  'web.calendar.block.end': 'Hasta',
  'web.calendar.block.hoursHint': 'En intervalos de 30 minutos.',
  'web.calendar.block.submitHours': 'Bloquear estas horas',
  'web.calendar.notice.title': 'Preaviso mínimo',
  'web.calendar.notice.intro':
    'Tiempo mínimo entre la reserva y el inicio del viaje en tu punto de entrega. Nadie podrá reservar con menos anticipación.',
  'web.calendar.notice.label': 'Preaviso',
  'web.calendar.notice.default': 'Predeterminado',
  'web.calendar.notice.current': 'Preaviso en vigor: {duration}.',
  'web.calendar.notice.save': 'Guardar preaviso',
  'web.calendar.duration.hours': { one: '{count} hora', other: '{count} horas' },
  'web.calendar.duration.days': { one: '{count} día', other: '{count} días' },
  'web.calendar.duration.hoursDecimal': '{value} horas',
  // Vérification d’identité et consentement biométrique (US-105, 16 VER-001, VER-004 ; écran S04,
  // 10b §4.3 : web.s04.checking, .result.verified, .result.retake ; autres clés PROPOSÉES)
  'common.kyc.state': 'Estado de tu verificación de identidad.',
  'common.kyc.consentRecorded': 'Guardamos tu respuesta sobre el consentimiento biométrico.',
  'common.kyc.consentVersionChanged':
    'El texto del consentimiento cambió. Léelo de nuevo antes de aceptar.',
  'common.kyc.consentUnavailable':
    'No podemos mostrar el consentimiento en este momento. Inténtalo más tarde.',
  'common.kyc.sessionStarted':
    'Te llevamos a la página segura de nuestro proveedor de verificación.',
  'common.kyc.sessionInProgress':
    'Ya empezaste tu verificación: puedes retomarla donde la dejaste.',
  'common.kyc.consentMissing':
    'Para verificar tu identidad, primero acepta el consentimiento biométrico.',
  'common.kyc.notEligible':
    'No podemos verificar tu identidad desde aquí. Escríbenos para revisarlo juntos.',
  'common.kyc.inReview':
    'Tu verificación está en revisión: te avisamos apenas tengamos la decisión.',
  'common.kyc.alreadyApproved': 'Tu identidad ya está verificada. No tienes que hacer nada más.',
  'common.kyc.documentUnsupported':
    'Todavía no podemos verificar una licencia emitida en ese lugar. Elige otro o escríbenos.',
  'common.kyc.sessionFailed':
    'No pudimos abrir la verificación. Inténtalo de nuevo en unos minutos.',
  'common.kyc.providerUnavailable':
    'La verificación de identidad no está disponible en este momento. Inténtalo más tarde.',
  'common.kyc.notApproved': 'Verifica tu identidad y tu licencia antes de pagar.',
  'common.kyc.licenseExpired':
    'Tu licencia vence antes del final del viaje. Actualízala para poder pagar.',
  'common.kyc.driverEligible': 'Tu licencia es válida para todo el viaje.',
  'common.kyc.legalNameUpdated':
    'Guardamos tu nombre. Si tu identidad ya estaba verificada, verifícala de nuevo antes de tu próximo viaje.',
  'common.kyc.legalNameUnchanged': 'Tu nombre ya era ese. No cambiamos nada.',
  'common.kyc.legalNameRequired':
    'Escribe tu nombre y tus apellidos tal como aparecen en tu licencia de conducir.',
  'common.kyc.legalNameLocked':
    'Estamos revisando tu identidad. Podrás cambiar tu nombre cuando terminemos.',
  'common.kyc.entryDeclared':
    'Guardamos tu fecha de entrada. El equipo la revisará si tu reserva lo necesita.',
  'common.kyc.entryDateInvalid': 'Revisa la fecha de entrada: no puede ser posterior a hoy.',
  'web.s04.title': 'Verifica tu identidad',
  'web.s04.intro': 'Lo hacemos antes del pago para que nadie te cobre si no puedes manejar.',
  'web.s04.progress': 'Paso {step} de {total}',
  'web.s04.consent.heading': 'Consentimiento biométrico',
  'web.s04.consent.checkbox':
    'Acepto que el proveedor use mis datos biométricos para verificar mi identidad.',
  'web.s04.consent.submit': 'Aceptar y seguir',
  'web.s04.consent.required': 'Marca la casilla para aceptar el consentimiento biométrico.',
  'web.s04.consent.refusal':
    'Sin este consentimiento no podemos verificarte, y no podrás reservar ni publicar un auto.',
  'web.s04.consent.withdraw': 'Retirar mi consentimiento',
  'web.s04.consent.withdrawHeading': 'Tu consentimiento biométrico',
  'web.s04.consent.withdrawHint':
    'Puedes retirarlo cuando quieras. Pediremos al proveedor que borre tus datos biométricos y ya no podrás reservar ni publicar un auto hasta verificarte de nuevo.',
  'web.s04.consent.given': 'Aceptaste el consentimiento biométrico.',
  'web.s04.country': 'Lugar de emisión de tu licencia',
  'web.s04.start': 'Verificar mi identidad',
  'web.s04.resume': 'Retomar mi verificación',
  'web.s04.hosted':
    'Tomarás las fotos en la página segura del proveedor. Nosotros no guardamos ninguna foto: solo el resultado.',
  'web.s04.checking': 'Verificando…',
  'web.s04.result.verified': 'Verificado',
  'web.s04.result.retake': 'Necesitamos otra foto',
  'web.s04.licenseValid': 'Licencia válida hasta el {date}.',
  'web.s04.result.rejected':
    'Tu verificación de identidad no fue aprobada. Por ahora no puedes reservar.',
  'web.s04.result.rejectedHelp':
    'Tu cuenta sigue abierta. Puedes retirar tu consentimiento biométrico aquí abajo cuando quieras.',
  'web.s04.moreInfo.LIVENESS_FAILED':
    'Repite la selfie con tu licencia, la cara bien iluminada, sin lentes de sol ni sombrero.',
  'web.s04.moreInfo.ID_DOCUMENT_REFUSED':
    'Tu documento de identidad no pudo aceptarse: usa uno vigente y acorde a tu estatus (pasaporte si eres turista).',
  'web.s04.moreInfo.LICENSE_NOT_ACCEPTED':
    'Necesitamos tu licencia de conducir física y definitiva, por ambos lados. Un permiso internacional solo o una licencia provisional no alcanza.',
  'web.s04.moreInfo.generic': 'Vuelve a hacer la verificación con fotos nítidas de tus documentos.',
  'web.s04.phoneFirst':
    'Primero verifica tu teléfono: lo usamos para coordinar la entrega del auto.',
  'web.s04.phoneLink': 'Verificar mi teléfono',
  'common.hostVerification.state': 'Estado de tu verificación como anfitrión.',
  'common.hostVerification.submitted': 'Recibimos tu solicitud para ser anfitrión.',
  'common.hostVerification.taxSaved': 'Guardamos tu número fiscal.',
  'common.hostVerification.ageUnverified':
    'No pudimos confirmar tu fecha de nacimiento. Vuelve a verificar tu identidad.',
  'common.hostVerification.kycRequired': 'Primero verifica tu identidad y tu licencia.',
  'common.hostVerification.residenceMismatch':
    'Tu residencia verificada no coincide con el lugar de tu cuenta de anfitrión.',
  'common.hostVerification.accountNotEligible':
    'Tu cuenta de anfitrión no puede recibir esta solicitud ahora. Escríbenos.',
  'common.hostVerification.locked':
    'Tu solicitud está en revisión o ya fue revisada. Para cambiar un dato, escríbenos.',
  'common.hostVerification.taxKindInvalid': 'Elige uno de los tipos de número fiscal de la lista.',
  'common.hostVerification.taxIdInvalid': 'Revisa tu número fiscal: solo cifras, letras y guiones.',
  'common.hostVerification.vaultUnavailable':
    'No podemos guardar tu número fiscal de forma segura en este momento. Inténtalo más tarde.',
  'common.hostVerification.unavailable':
    'No podemos revisar tu solicitud de anfitrión en este momento. Inténtalo más tarde.',
  // compte de versement de l’hôte (US-707)
  'common.payoutAccount.state': 'Estado de tu cuenta de cobro.',
  'common.payoutAccount.saved': 'Guardamos tu cuenta de cobro.',
  'common.payoutAccount.manageForbidden':
    'Solo el titular de la cuenta de anfitrión puede ver o cambiar la cuenta de cobro.',
  'common.payoutAccount.taxRequired':
    'Primero guarda tu número fiscal: lo comparamos con el titular de la cuenta.',
  'common.payoutAccount.invalid': 'Revisa el número de cuenta: no tiene el formato esperado.',
  'common.payoutAccount.railUnsupported':
    'Elige un tipo de cuenta y un banco o billetera de la lista.',
  'common.payoutAccount.holderMismatch':
    'La cuenta debe estar a tu nombre: el titular o su número de documento no coinciden con tu identidad verificada.',
  'common.payoutAccount.vaultUnavailable':
    'No podemos guardar tu cuenta de forma segura en este momento. Inténtalo más tarde.',
  'common.payoutAccount.unavailable': 'No pudimos cargar tu cuenta de cobro. Inténtalo más tarde.',
  'common.payoutAccount.railUnavailable': 'Los pagos a anfitriones aún no están disponibles.',
  'web.a07.payout.title': 'Tu cuenta de cobro',
  'web.a07.payout.intro': 'Aquí te pagamos tus ganancias. La cuenta debe estar a tu nombre.',
  'web.a07.payout.loginRequired': 'Inicia sesión para ver tu cuenta de cobro.',
  'web.a07.payout.error': 'No pudimos cargar tu cuenta de cobro.',
  'web.a07.payout.currentHeading': 'Cuenta registrada',
  'web.a07.payout.masked': '•••• {last4}',
  'web.a07.payout.kind.BANK_ACCOUNT': 'Cuenta bancaria',
  'web.a07.payout.kind.WALLET': 'Billetera móvil',
  'web.a07.payout.institutionOf': 'Banco o billetera: {institution}',
  'web.a07.payout.status.VERIFIED': 'Verificada',
  'web.a07.payout.status.PENDING': 'En verificación',
  'web.a07.payout.status.REJECTED': 'Rechazada',
  'web.a07.payout.pendingHint': 'El proveedor de pagos aún está revisando esta cuenta.',
  'web.a07.payout.reject.HOLDER_MISMATCH':
    'El titular de la cuenta no coincide con tu identidad verificada.',
  'web.a07.payout.reject.TAX_ID_MISMATCH':
    'El número de documento del titular no coincide con el tuyo.',
  'web.a07.payout.reject.ACCOUNT_INVALID': 'El proveedor de pagos no reconoció esta cuenta.',
  'web.a07.payout.hold': 'Cambiaste de cuenta: por seguridad, retenemos tus pagos hasta el {date}.',
  'web.a07.payout.railsClosed':
    'Los pagos a anfitriones en {country} aún no están abiertos. Te avisaremos.',
  'web.a07.payout.taxFirst':
    'Antes de registrar tu cuenta, guarda tu número fiscal: lo comparamos con el titular.',
  'web.a07.payout.taxAction': 'Guardar mi número fiscal',
  'web.a07.payout.formHeading': 'Registrar mi cuenta',
  'web.a07.payout.changeHeading': 'Cambiar de cuenta',
  'web.a07.payout.kindLabel': 'Tipo de cuenta',
  'web.a07.payout.institution': 'Banco o billetera',
  'web.a07.payout.institutionCode': 'Código del banco',
  'web.a07.payout.institutionHint': 'Tal como te lo indica tu banco.',
  'web.a07.payout.accountNumber': 'Número de cuenta',
  'web.a07.payout.accountNumberHint':
    'Solo cifras. Para una billetera móvil, tu número de teléfono.',
  'web.a07.payout.holderGiven': 'Nombres del titular',
  'web.a07.payout.holderSurnames': 'Apellidos del titular',
  'web.a07.payout.holderHint': 'Tal como aparecen en tu documento.',
  'web.a07.payout.holderTaxId': 'Número {kind} del titular',
  'web.a07.payout.required': 'Completa este campo.',
  'web.a07.payout.ownNameOnly':
    'Solo cuentas a tu nombre: no aceptamos cuentas de otra persona ni de una empresa.',
  'web.a07.payout.private': 'Guardamos el número cifrado y solo mostramos sus últimas 4 cifras.',
  'web.a07.payout.changeHint':
    'Si cambias de cuenta, retenemos tus pagos durante 48 horas por seguridad.',
  'web.a07.payout.save': 'Guardar mi cuenta',
  'web.a07.payout.back': 'Volver a mis tareas de anfitrión',
  'web.a07.loginRequired': 'Inicia sesión para ver tus tareas de anfitrión.',
  'web.a07.login': 'Iniciar sesión',
  'web.a07.noHostAccount': 'Aún no tienes una cuenta de anfitrión.',
  'web.a07.openHost': 'Ir a mi espacio de anfitrión',
  'web.a07.error': 'No pudimos cargar tus tareas.',
  'web.a07.retry': 'Reintentar',
  'web.a07.tasksHeading': 'Tus tareas',
  'web.a07.done': 'Listo',
  'web.a07.todo': 'Por hacer',
  'web.a07.waiting': 'En espera',
  'web.a07.task.identityAction': 'Verificar mi identidad',
  'web.a07.task.age': 'Edad mínima para ser anfitrión',
  'web.a07.task.ageHint': 'La tomamos de tu identidad verificada o, si falta, de tu cuenta.',
  'web.a07.task.termsAction': 'Leer y aceptar',
  'web.a07.task.screening': 'Controles de seguridad',
  'web.a07.task.screeningHint': 'Los hacemos nosotros cuando envías tu solicitud.',
  'web.a07.task.payments': 'Cuenta de cobro revisada por el proveedor de pagos',
  'web.a07.task.paymentsHint': 'Esta revisión la hace el proveedor de pagos, no tú.',
  'web.a07.tax.heading': 'Tu número fiscal',
  'web.a07.tax.kind': 'Tipo de número',
  'web.a07.tax.number': 'Número de tu documento',
  'web.a07.tax.numberHint': 'Tal como aparece en tu documento, con o sin guiones.',
  'web.a07.tax.regime': 'Régimen tributario',
  'web.a07.tax.regimeHint': 'Código en mayúsculas, si lo conoces.',
  'web.a07.tax.save': 'Guardar mi número',
  'web.a07.tax.saved': 'Número guardado ({kind}).',
  'web.a07.tax.private': 'Lo guardamos cifrado y nunca lo mostramos a los viajeros.',
  'web.a07.tax.individualOnly': 'Solo personas físicas: no aceptamos empresas.',
  'web.a07.optional': 'Opcional',
  'web.a07.tax.optionalHint':
    'Puedes agregar tu número fiscal ahora o más tarde. Solo te lo pediremos si nuestro proveedor de pagos lo necesita para pagarte.',
  'web.a07.tax.reminder':
    'Tus impuestos son tu responsabilidad. Según las reglas fiscales locales, es posible que debas inscribirte ante la administración tributaria, por ejemplo para obtener un número de contribuyente, dentro de un plazo después de tus primeros ingresos por alquiler. Consulta con la administración tributaria o con un contador.',
  'web.a07.submit': 'Enviar mi solicitud',
  'web.a07.submitHint': 'Puedes enviarla aunque falte una tarea: te diremos qué falta.',
  'web.a07.status.DOCS_PENDING': 'Tu solicitud está incompleta.',
  'web.a07.status.IN_REVIEW': 'Estamos revisando tu solicitud.',
  'web.a07.status.APPROVED': 'Aprobamos tu solicitud.',
  'web.a07.status.REJECTED': 'No pudimos aprobar tu solicitud. Escríbenos si quieres saber más.',
  'web.a07.missing': 'Falta: {tasks}.',
  'web.a07.pendingActivation':
    'Aprobamos tu solicitud, pero tu cuenta de anfitrión aún no está activa.',
  'web.a07.active': 'Tu cuenta de anfitrión está activa.',
  'web.a07.back': 'Volver a mi espacio de anfitrión',
  'web.host.verificationLink': 'Mi verificación de anfitrión',
  'web.a07.waitingCountry':
    'Todo listo de tu lado. Avisaremos cuando {brand} abra a anfitriones en {country}.',
  'web.a07.title': 'Antes de recibir viajeros',
  'web.a07.intro': 'Te decimos qué falta y quién lo hace. Puedes salir y volver cuando quieras.',
  'web.a07.task.identity': 'Tu identidad',
  'web.a07.task.tax': 'Datos fiscales',
  'web.a07.task.terms': 'Condiciones para anfitriones',
  // US-127 : refus d'une réservation par l'hôte lui-même ou un compte lié (16 ACC-014,
  // SELF_BOOKING_FORBIDDEN) ; le même texte dans tous les cas, sans dire pourquoi (ADR-110)
  'common.booking.selfBookingForbidden.title': 'No puedes reservar este auto',
  'common.booking.selfBookingForbidden.body':
    'Este auto no se puede reservar con tu cuenta. Elige otro auto o escríbenos si crees que es un error.',
  // US-207 : refus des commandes de la machine à états du trip (16 TRP-045 ; 08 BR-CXL règle 3)
  'common.trip.transitionForbidden':
    'Esta acción ya no es posible para esta reserva. Recarga la página para ver en qué estado está.',
  'common.trip.concurrentUpdate':
    'Esta reserva acaba de cambiar. Recarga la página y vuelve a intentarlo.',
  'common.trip.noShowTooEarly':
    'Todavía es pronto para avisar que el viajero no llegó. Vuelve a intentarlo cuando termine el tiempo de espera indicado en la reserva.',
  // US-211 : contrat de location hôte–voyageur (16 BKG-018, BKG-019), texte figé dans le PDF
  'ctr.contract.ref': 'Contrato {ref}, versión {version}',
  'ctr.contract.parties': 'Partes',
  'ctr.contract.host': 'Anfitrión: {name}, {capacity}',
  'ctr.contract.hostCapacity.owner': 'propietario del vehículo',
  'ctr.contract.hostCapacity.authorized':
    'autorizado por el titular del vehículo mediante poder notarial',
  'ctr.contract.guest': 'Conductor (viajero): {name}',
  'ctr.contract.vehicleHeading': 'Vehículo y período',
  'ctr.contract.vehicle': 'Vehículo: {make} {model} ({year}), placa {plate}',
  'ctr.contract.period': 'Del {start} al {end} (hora local de {country})',
  'ctr.contract.handover': 'Entrega y devolución: {place}',
  'ctr.contract.priceHeading': 'Precio y condiciones',
  'ctr.contract.total': 'Total pagado, impuestos incluidos: {amount}',
  'ctr.contract.priceLine': '{label}: {amount}',
  'ctr.contract.platform': 'Plataforma intermediaria: {brand}',
  'ctr.contract.priceLineTax': '{label}: {amount} (impuestos: {tax})',
  'ctr.contract.line.tripPrice': 'Alquiler',
  'ctr.contract.line.tripFee': 'Tarifa del viaje',
  'ctr.contract.line.protection': 'Protección',
  'ctr.contract.line.promo': 'Descuento',
  'ctr.contract.line.delivery': 'Entrega a domicilio',
  'ctr.contract.line.other': 'Otros cargos',
  'ctr.contract.protection':
    'Protección: plan {level}; franquicia de {deductible}; responsabilidad civil frente a terceros de {rc}; aseguradora: {insurer}',
  'ctr.contract.broker': 'Corredor de seguros: {broker}',
  'ctr.contract.level.basica': 'Básica',
  'ctr.contract.level.estandar': 'Estándar',
  'ctr.contract.level.total': 'Total',
  'ctr.contract.deposit': 'Depósito de garantía con tarjeta: {amount}',
  'ctr.contract.depositGeneric': 'Depósito de garantía: según las condiciones de pago.',
  'ctr.contract.mileageIncluded': 'Kilometraje incluido: {km} km; kilómetro adicional: {price}',
  'ctr.contract.mileageUnlimited': 'Kilometraje ilimitado',
  'ctr.contract.cancelFree':
    'Cancelación gratuita hasta el {date}; después se retiene {dur} de alquiler: {amount}',
  'ctr.contract.cancelOneDay': '1 día',
  'ctr.contract.cancelHalfDay': 'medio día',
  'ctr.contract.cancelPolicy': 'Cancelación: según la política aceptada en la reserva.',
  'ctr.contract.lateReturn':
    'Devolución: tolerancia de {minutes} min; después, el retraso se cobra según la política publicada.',
  'ctr.contract.lateReturnPolicy': 'Devolución: el retraso se cobra según la política publicada.',
  'ctr.contract.clauses': 'Cláusulas',
  'ctr.contract.signatureHeading': 'Firma electrónica del viajero',
  'ctr.contract.signedBy': 'Firma: {value}',
  'ctr.contract.signedAt': 'Fecha y hora del servidor (UTC): {value}',
  'ctr.contract.documentHash': 'Huella SHA-256 del documento: {value}',
  'ctr.contract.seal': 'Sello: {value}',
  'ctr.contract.signatureId': 'Firma n.º: {value}',
  'ctr.contract.courtesy':
    'Traducción de cortesía ({language}). En caso de diferencia, el texto en español hace fe.',
  // US-212 : constancia d'arrendamiento et centre juridique (ADR-162), textes PROPOSÉS
  'ctr.constancia.title': 'CONSTANCIA DE ALQUILER ENTRE PARTICULARES',
  'ctr.constancia.draft': 'BORRADOR: texto pendiente de validación jurídica; puede cambiar.',
  'ctr.constancia.ref': 'Viaje {ref} · según el contrato de alquiler, versión {version}',
  'ctr.constancia.partiesHeading': 'Las partes',
  'ctr.constancia.host': 'Anfitrión (particular): {name}, {capacity}',
  'ctr.constancia.driver': 'Conductor autorizado: {name}',
  'ctr.constancia.platform':
    'Plataforma intermediaria entre particulares: {brand}. No es empresa de alquiler ni propietaria del vehículo.',
  'ctr.constancia.tripHeading': 'Vehículo y período',
  'ctr.constancia.vehicle': 'Vehículo: {make} {model} {year}, placa {plate}',
  'ctr.constancia.period': 'Período: del {start} al {end} (hora local de {country})',
  'ctr.constancia.handover': 'Lugar de entrega y devolución: {place}',
  'ctr.constancia.total': 'Total pagado por el viajero: {amount}',
  'ctr.constancia.signed':
    'Contrato de alquiler aceptado electrónicamente por el viajero el {date} (hora local)',
  'ctr.constancia.unsigned': 'Contrato de alquiler aún no firmado por el viajero',
  'ctr.constancia.noticeHeading': 'Alcance de esta constancia',
  'ctr.constancia.notice.purpose':
    'Esta constancia acredita que el vehículo indicado está alquilado entre particulares al conductor nombrado durante el período indicado.',
  'ctr.constancia.notice.parties':
    'El alquiler es un contrato entre el anfitrión y el viajero; {brand} solo intermedia y cobra el pago como comerciante de referencia.',
  'ctr.constancia.notice.documents':
    'Se presenta junto con el documento de identidad y la licencia de conducir vigentes del conductor.',
  'ctr.constancia.notice.fines':
    'Las multas e infracciones cometidas durante el período corresponden al conductor, según el contrato de alquiler.',
  'ctr.constancia.courtesy':
    'Traducción ({language}). En caso de diferencia, el texto en español hace fe.',
  // US-125 : avertissements réglementaires versionnés par pays (16 LEG-021), textes PROPOSÉS
  'common.regulatory.heading': 'Aviso importante',
  'common.regulatory.version': 'Versión {version} de este aviso',
  'common.regulatory.unavailable':
    'Los avisos no están disponibles por ahora. Vuelve a intentarlo más tarde.',
  'common.regulatory.privatePlate.v1.host.title': 'Placa particular y alquiler entre personas',
  'common.regulatory.privatePlate.v1.host.body':
    'En Panamá, un auto con placa particular está registrado para uso privado. El alquiler entre personas de un auto con esta placa está en revisión legal. Antes de publicar, confirma con tu aseguradora y en tu registro vehicular que puedes ofrecerlo.',
  'common.regulatory.privatePlate.v1.guest.title': 'Auto de una persona particular',
  'common.regulatory.privatePlate.v1.guest.body':
    'Este auto pertenece a una persona y tiene placa particular. El alquiler entre personas con este tipo de placa está en revisión legal en Panamá. Revisa las condiciones del alquiler antes de reservar.',
  'common.regulatory.hostTaxStatus.v1.host.title': 'Tu situación tributaria como anfitrión',
  'common.regulatory.hostTaxStatus.v1.host.body':
    'En Paraguay, los ingresos por alquilar tu auto pueden tener que declararse según tu situación tributaria. El tratamiento tributario de los anfitriones particulares está en revisión. Registra tu número tributario y guarda tus resúmenes de ganancias.',
  'common.regulatory.hostTaxStatus.v1.guest.title': 'Alquiler con una persona particular',
  'common.regulatory.hostTaxStatus.v1.guest.body':
    'Este auto lo alquila una persona particular. En Paraguay, la situación tributaria de los anfitriones particulares está en revisión. Tu comprobante detalla lo que pagas.',
  'common.catalogAddition.rejected':
    'Tu auto no se agregó al catálogo. Revisa el motivo debajo del auto.',
  'common.catalogAddition.notAllowed':
    'Ya no puedes pedir agregar este auto. Si crees que es un error, escribe al soporte.',
  'web.host.catalog.final':
    'Este auto no se puede publicar. Si crees que es un error, escribe al soporte.',
  'backoffice.catalog.choose': 'Elige una opción',
  'backoffice.catalog.rejectConfirm': 'Confirmo el rechazo: se avisará al anfitrión.',
  'backoffice.catalog.ongoing': 'en curso',
  'common.vehicleDocs.declarationSaved': 'Datos del auto guardados.',
  'common.vehicleDocs.documentAdded': 'Documento recibido. Lo revisaremos.',
  'common.vehicleDocs.submitted': 'Enviado a revisión. Te avisaremos del resultado.',
  'common.vehicleDocs.claimOpened': 'Reclamo recibido. Lo revisaremos con tu título.',
  'common.vehicleDocs.underReview':
    'Este auto está en revisión: no puedes cambiarlo hasta que terminemos.',
  'common.vehicleDocs.ineligible': 'Este auto no se puede publicar.',
  'common.vehicleDocs.released': 'Este auto se retiró de tu cuenta tras un reclamo.',
  'common.vehicleDocs.alreadyEligible': 'Este auto ya está aprobado.',
  'common.vehicleDocs.claimNotNeeded':
    'Ninguna otra cuenta tiene esta placa ni este VIN: puedes registrar tu auto.',
  'common.vehicleDocs.claimDuplicate':
    'Ya enviaste un reclamo por este auto. Lo estamos revisando.',
  'common.vehicleDocs.claimLimitReached':
    'Ya tienes varios reclamos en revisión. Espera nuestra respuesta antes de enviar otro.',
  'common.vehicleDocs.tooOld': 'El auto supera la antigüedad máxima permitida.',
  'common.vehicleDocs.mileageTooHigh': 'El kilometraje supera el máximo permitido.',
  'common.vehicleDocs.titleMismatch':
    'Declara que eres el propietario del auto o que el propietario te autoriza.',
  'common.vehicleDocs.lenderConsentRequired':
    'El auto está financiado: declara que tienes el acuerdo del acreedor.',
  'common.vehicleDocs.documentRequired': 'Falta un documento obligatorio del auto.',
  'common.vehicleDocs.documentExpired': 'Un documento del auto está vencido. Sube uno vigente.',
  'common.vehicleDocs.documentInvalid':
    'No pudimos aceptar este archivo. Sube una foto (JPG, PNG, HEIC) o un PDF.',
  'common.vehicleDocs.uploadUnavailable':
    'El envío de documentos aún no está disponible. Inténtalo más tarde.',
  'common.vehicleReview.closed': 'Este auto ya no está en revisión.',
  'common.listingReview.closed': 'Este anuncio ya no está en revisión.',
  'common.listingReview.rationaleRequired': 'Elige el motivo del rechazo.',
  'common.listingReview.notPublishable':
    'No se puede aprobar: el anuncio no pasa un control automático ({reason}).',
  'common.vehicleReview.checklistInvalid':
    'Marca cada punto de control y da un veredicto para cada documento.',
  'common.vehicleReview.claimClosed': 'Este reclamo ya fue resuelto.',
  'common.vehicleReview.claimReasonInvalid': 'Elige un motivo para rechazar; ninguno para aceptar.',
  'common.vehicleReview.adminRequired':
    'Solo un administrador puede liberar el auto de otra cuenta.',
  'common.vehicleReview.fileNotFound': 'Este documento no pertenece a este elemento.',
  'common.vehicleReview.fileUnavailable': 'No pudimos abrir el documento. Inténtalo más tarde.',
  'web.vehicleDocs.open': 'Validar el auto',
  'web.vehicleDocs.title': 'Validar el auto',
  'web.vehicleDocs.intro':
    'Confirma unos datos y tu auto queda listo para publicar. Solo te pedimos documentos si hace falta.',
  'web.vehicleDocs.back': 'Volver a mis autos',
  'web.vehicleDocs.notFound': 'No encontramos este auto',
  'web.vehicleDocs.status.ELIGIBLE': 'Aprobado',
  'web.vehicleDocs.status.PENDING': 'Por revisar',
  'web.vehicleDocs.status.INELIGIBLE': 'No publicable',
  'web.vehicleDocs.underReview': 'En revisión. Te avisaremos del resultado.',
  'web.vehicleDocs.released': 'Este auto se retiró de tu cuenta tras un reclamo.',
  'web.vehicleDocs.publishable': 'Listo para publicar',
  'web.vehicleDocs.reasons': 'Qué falta',
  'web.vehicleDocs.reason.CATALOG_ADDITION_PENDING': 'El modelo aún no está en nuestro catálogo.',
  'web.vehicleDocs.reason.VEHICLE_TOO_OLD': 'El auto supera la antigüedad máxima.',
  'web.vehicleDocs.reason.VEHICLE_MILEAGE_TOO_HIGH': 'El kilometraje supera el máximo.',
  'web.vehicleDocs.reason.VEHICLE_FIELD_REQUIRED':
    'Completa los datos del auto: número de chasis (VIN), kilometraje y titular.',
  'web.vehicleDocs.reason.VEHICLE_TITLE_MISMATCH':
    'Falta declarar que eres el propietario o que el propietario te autoriza.',
  'web.vehicleDocs.reason.VEHICLE_LENDER_CONSENT_REQUIRED':
    'Falta declarar que tienes el acuerdo del acreedor.',
  'web.vehicleDocs.reason.VEHICLE_DOCUMENT_REQUIRED': 'Falta un documento obligatorio.',
  'web.vehicleDocs.reason.VEHICLE_DOCUMENT_EXPIRED': 'Un documento está vencido.',
  'web.vehicleDocs.reason.VEHICLE_PLATE_MISMATCH': 'La placa no coincide con el título.',
  'web.vehicleDocs.reason.VEHICLE_VIN_MISMATCH':
    'El número de chasis (VIN) no coincide con el título.',
  'web.vehicleDocs.reason.VEHICLE_INSPECTION_INVALID': 'La inspección no es válida.',
  'web.vehicleDocs.reason.VEHICLE_DOCUMENT_REJECTED':
    'Rechazamos un documento: mira el motivo abajo.',
  'web.vehicleDocs.reason.VEHICLE_TITLE_FORBIDDEN': 'El título no permite alquilar el auto.',
  'web.vehicleDocs.reason.VEHICLE_REGISTRY_FLAGGED':
    'El registro público muestra un problema con el auto.',
  'web.vehicleDocs.reason.VEHICLE_RELEASED': 'El auto se retiró de tu cuenta.',
  'web.vehicleDocs.reason.other': 'Hay un punto por resolver. Escribe al soporte.',
  'web.vehicleDocs.declaration.title': 'Datos del auto',
  'web.vehicleDocs.declaration.holder': '¿A nombre de quién está el título?',
  'web.vehicleDocs.declaration.holder.HOST': 'A mi nombre',
  'web.vehicleDocs.declaration.holder.THIRD_PARTY':
    'A nombre de otra persona (con su autorización notariada)',
  'web.vehicleDocs.declaration.lien': 'El auto está financiado (prenda o crédito vigente)',
  'web.vehicleDocs.declaration.odometer': 'Kilometraje actual',
  'web.vehicleDocs.declaration.save': 'Guardar datos',
  'web.vehicleDocs.type.TITLE': 'Título o registro del auto',
  'web.vehicleDocs.type.OWNER_AUTHORIZATION': 'Autorización notariada del dueño',
  'web.vehicleDocs.type.PLATE_VIN_PHOTO': 'Foto de la placa y del VIN',
  'web.vehicleDocs.type.INSPECTION': 'Inspección técnica vigente',
  'web.vehicleDocs.type.LENDER_CONSENT': 'Consentimiento escrito del acreedor',
  'web.vehicleDocs.type.COMPULSORY_INSURANCE': 'Seguro obligatorio del auto',
  'web.vehicleDocs.doc.status.SUBMITTED': 'En revisión',
  'web.vehicleDocs.doc.status.VALID': 'Documento válido',
  'web.vehicleDocs.doc.status.REJECTED': 'Rechazado',
  'web.vehicleDocs.doc.missing': 'Pendiente de subir',
  'web.vehicleDocs.doc.validUntil': 'Vence el {date}',
  'web.vehicleDocs.doc.rejected.ILLEGIBLE': 'No se puede leer',
  'web.vehicleDocs.doc.rejected.EXPIRED': 'Vencido',
  'web.vehicleDocs.doc.rejected.MISMATCH': 'No coincide con el auto',
  'web.vehicleDocs.doc.rejected.WRONG_DOCUMENT': 'No es el documento pedido',
  'web.vehicleDocs.doc.rejected.SUSPECTED_FORGERY': 'No pudimos validarlo',
  'web.vehicleDocs.documents.title': 'Documentos',
  'web.vehicleDocs.upload.title': 'Subir un documento',
  'web.vehicleDocs.upload.type': 'Tipo de documento',
  'web.vehicleDocs.upload.file': 'Archivo (foto o PDF)',
  'web.vehicleDocs.upload.validUntil': 'Válido hasta (si tiene fecha)',
  'web.vehicleDocs.upload.send': 'Subir',
  'web.vehicleDocs.upload.max': 'Hasta {max}. Solo tú y nuestro equipo de revisión lo ven.',
  'web.vehicleDocs.upload.closed':
    'El envío de documentos aún no está disponible. Puedes completar los datos del auto.',
  'web.vehicleDocs.upload.tooLarge': 'El archivo pesa más de {max}.',
  'web.vehicleDocs.submit.title': 'Validar',
  'web.vehicleDocs.submit.intro':
    'Revisamos tus datos al instante. Si se piden documentos, los revisa nuestro equipo.',
  'web.vehicleDocs.submit.send': 'Validar mi auto',
  'web.vehicleDocs.claims.title': '¿Tu placa ya está registrada?',
  'web.vehicleDocs.claims.intro':
    'Si otra cuenta registró tu auto, envíanos tu título y lo revisamos.',
  'web.vehicleDocs.claims.open': 'Reclamar mi placa',
  'web.vehicleDocs.claims.plate': 'Placa',
  'web.vehicleDocs.claims.vin': 'Número de chasis (VIN), si lo tienes',
  'web.vehicleDocs.claims.file': 'Título a tu nombre (foto o PDF)',
  'web.vehicleDocs.claims.send': 'Enviar el reclamo',
  'web.vehicleDocs.claims.mine': 'Mis reclamos',
  'web.vehicleDocs.claims.status.OPEN': 'En revisión',
  'web.vehicleDocs.claims.status.UPHELD': 'Aceptado: ya puedes registrar tu auto',
  'web.vehicleDocs.claims.status.DISMISSED': 'Rechazado',
  'backoffice.vehicle.open': 'Abrir el auto',
  'backoffice.vehicle.heading': 'Revisión del auto',
  'backoffice.vehicle.holder': 'Titular de la cuenta',
  'backoffice.vehicle.plate': 'Placa',
  'backoffice.vehicle.vin': 'VIN',
  'backoffice.vehicle.titleHolder': 'Título declarado',
  'backoffice.vehicle.lien': 'Financiado',
  'backoffice.vehicle.documents': 'Documentos',
  'backoffice.vehicle.viewFile': 'Ver el documento',
  'backoffice.vehicle.checklist': 'Lista de control (marca cada punto)',
  'backoffice.vehicle.check.TITLE_HOLDER': 'Título a nombre del anfitrión o autorización notariada',
  'backoffice.vehicle.check.TITLE_CLEAN': 'Título sin restricción (no pérdida total, no robo)',
  'backoffice.vehicle.check.PLATE_MATCH': 'La placa coincide con el título',
  'backoffice.vehicle.check.VIN_MATCH': 'El VIN coincide con el título',
  'backoffice.vehicle.check.LIEN': 'Prenda: sin financiación, o consentimiento del acreedor válido',
  'backoffice.vehicle.check.INSPECTION': 'Inspección vigente',
  'backoffice.vehicle.check.REGISTRY': 'Registro público consultado',
  'backoffice.vehicle.pass': 'Correcto',
  'backoffice.vehicle.fail': 'No correcto',
  'backoffice.vehicle.notConsultable': 'No consultable',
  'backoffice.vehicle.verdict.VALID': 'Es válido',
  'backoffice.vehicle.verdict.REJECTED': 'Rechazar',
  'backoffice.vehicle.validUntil': 'Válido hasta',
  'backoffice.vehicle.decide': 'Registrar la revisión',
  'backoffice.vehicle.result.ELIGIBLE': 'Auto aprobado.',
  'backoffice.vehicle.result.PENDING': 'El auto queda pendiente con sus motivos.',
  'backoffice.vehicle.result.INELIGIBLE': 'Auto no publicable.',
  'backoffice.vehicle.claim.open': 'Abrir el reclamo',
  'backoffice.vehicle.claim.heading': 'Reclamo de placa o VIN',
  'backoffice.vehicle.claim.claimant': 'Quien reclama',
  'backoffice.vehicle.claim.target': 'Auto registrado por la otra cuenta',
  'backoffice.vehicle.claim.uphold': 'Aceptar y liberar el auto (administrador)',
  'backoffice.vehicle.claim.dismiss': 'Rechazar con un motivo',
  'backoffice.vehicle.claim.reason.INSUFFICIENT_PROOF': 'Prueba insuficiente',
  'backoffice.vehicle.claim.reason.CLAIMANT_NOT_OWNER': 'Quien reclama no es el dueño',
  'backoffice.vehicle.claim.done.UPHELD': 'Reclamo aceptado: el auto fue liberado.',
  'backoffice.vehicle.claim.done.DISMISSED': 'Reclamo rechazado.',
  'backoffice.vehicle.purpose': 'Motivo de la consulta',
  'web.listing.hostName': 'Anfitrión: {name}',
  'common.vehicleReview.dossierNotRead': 'Lee el expediente del reclamo antes de decidir.',
  'common.vehicleReview.noteRequired': 'Escribe el motivo de la decisión (10 a 500 caracteres).',
  'common.vehicleReview.checksFailed': 'Un punto de control no es correcto: rechaza el reclamo.',
  'common.vehicleReview.targetReleased':
    'El auto en cuestión ya fue liberado: rechaza este reclamo.',
  'common.vehicleReview.targetBooked': {
    one: 'El auto tiene {count} reserva en curso o futura: no se puede liberar.',
    other: 'El auto tiene {count} reservas en curso o futuras: no se puede liberar.',
  },
  'common.vehicleReview.sameAdmin': 'Otro administrador debe decidir: ya liberaste esta placa.',
  'common.vehicleDocs.confirmed': 'Auto aprobado: ya puedes publicarlo.',
  'web.vehicleDocs.declaration.owner':
    'Soy el propietario del auto o el propietario me autoriza a alquilarlo',
  'web.vehicleDocs.declaration.lienOk':
    'El auto no está prendado, o tengo el acuerdo escrito del acreedor',
  'web.vehicleDocs.declaration.vin': 'Número de chasis (VIN)',
  'web.vehicleDocs.declaration.vinHint':
    'VIN de 17 caracteres (ej.: 1HGCM82633A004352) o número de chasis de un auto importado (ej.: GRJ150-0012345).',
  'common.vehicleDocs.vinInvalid':
    'El número de chasis no es válido. Escribe el VIN de 17 caracteres (sin I, O ni Q) o el número de chasis de tu auto importado, por ejemplo GRJ150-0012345.',
  'web.vehicleDocs.declaration.attested': 'Lo declaraste el {date}.',
  'backoffice.catalog.specsPending': 'Ficha técnica por completar',
  // US-219 (ADR-128) : espace hôte, accueil A02 et réservations A05
  'common.hostTrips.notFound': 'No encontramos esta reserva.',
  'common.hostTrips.unavailable':
    'Tus reservas no están disponibles por ahora. Inténtalo en unos minutos.',
  'web.a02.empty': 'Aún no tienes reservas. Tu auto ya es visible para los viajeros.',
  'web.a02.upcoming.title': 'Próximas entregas',
  'web.a02.returns.title': 'Próximas devoluciones',
  'web.a02.trips.all': 'Ver todas mis reservas',
  'web.a05.heading': 'Mis reservas',
  'web.a05.intro': 'Prepara cada entrega: fecha, lugar y lo que puedes ver del viajero.',
  'web.a05.empty': 'Sin reservas por ahora',
  'web.a05.tab.UPCOMING': 'Próximas',
  'web.a05.tab.IN_PROGRESS': 'En curso',
  'web.a05.tab.DONE': 'Terminadas',
  'web.a05.tab.CANCELLED': 'Canceladas',
  'web.a05.tabs': 'Estado de las reservas',
  'web.a05.filter.title': 'Filtrar',
  'web.a05.filter.vehicle': 'Auto',
  'web.a05.filter.allVehicles': 'Todos mis autos',
  'web.a05.filter.from': 'Desde',
  'web.a05.filter.to': 'Hasta',
  'web.a05.filter.apply': 'Aplicar filtros',
  'web.a05.filter.invalid':
    'Revisa los filtros: la fecha final no puede ser anterior a la inicial.',
  'web.a05.reference': 'Reserva n.º {ref}',
  'web.a05.place': 'Entrega en {place}',
  'web.a05.start': 'Entrega: {date}',
  'web.a05.end': 'Devolución: {date}',
  'web.a05.guest.title': 'Viajero',
  'web.a05.guest.age': '{age} años',
  'web.a05.guest.unverified': 'Identidad sin verificar',
  'web.a05.guest.noRating': 'Sin reseñas aún',
  'web.a05.guest.rating': 'Calificación: {rating}',
  'web.a05.guest.hidden': 'Datos no disponibles',
  'web.a05.privacy':
    'Por tu seguridad y la del viajero, nunca ves su licencia ni sus documentos de identidad.',
  'web.a05.payment.CONFIRMED': 'Pago confirmado',
  'web.a05.payment.REFUNDED_PARTIAL': 'Reembolso parcial',
  'web.a05.payment.REFUNDED': 'Reembolsada',
  'web.a05.earnings': 'Ganancia estimada: {amount}',
  'web.a05.earnings.note':
    'Estimación según tu plan; el monto final aparece en tus ganancias después del viaje.',
  'web.a05.open': 'Ver la reserva',
  'web.a05.back': 'Volver a mis reservas',
  'web.a05.loadError': 'No pudimos cargar tus reservas.',
  'web.a05.retry': 'Reintentar',
  // US-201 : recherche publique par zone, lieu, dates et heures (S01, S02 simplifié, S03)
  'common.search.locationRequired': 'Elige dónde quieres recoger el auto.',
  'common.search.datesInvalid':
    'Revisa las fechas: la devolución debe ser después de la recogida, a la hora en punto o a la media hora, y la recogida no puede estar en el pasado.',
  'common.search.durationExceeded': 'Este viaje es demasiado largo. Elige una duración más corta.',
  'common.search.unavailable':
    'La búsqueda no está disponible en este momento. Inténtalo de nuevo en unos minutos.',
  'web.search.title': 'Buscar un auto',
  'web.search.where': 'Dónde lo recoges',
  'web.search.choosePlace': 'Elige un lugar',
  'web.search.wholeCity': '{city} (toda la ciudad)',
  'web.search.from': 'Desde',
  'web.search.until': 'Hasta',
  'web.search.date': 'Fecha',
  'web.search.time': 'Hora',
  'web.search.localTime': 'Las horas son las del lugar donde recoges el auto.',
  'web.search.go': 'Buscar autos',
  'web.search.noAreas.title': 'Por ahora no hay autos para alquilar',
  'web.search.noAreas.body': 'Todavía no hay autos disponibles. Vuelve más tarde.',
  'web.search.areasError': 'No pudimos cargar los lugares.',
  'web.search.results.title': 'Autos disponibles',
  'web.search.results.none': 'No hay autos disponibles en esas fechas',
  'web.search.results.none.body': 'Prueba con otras fechas u otra zona.',
  'web.search.result.period': 'Del {from} al {to}',
  'web.search.result.timezone': 'Hora local de {city}',
  'web.search.loading': 'Buscando autos…',
  'web.search.result.open': 'Ver el auto',
  'web.search.results.count': {
    one: '{count} auto disponible',
    other: '{count} autos disponibles',
  },
  'web.search.deposit.amount': 'Depósito de garantía: {amount}, bloqueado en tu tarjeta',
  'web.search.deposit.maybe': 'Puede pedirse un depósito según el perfil del conductor.',
  'web.search.map.title': 'Mapa de los autos',
  'web.search.map.sameAsList':
    'Las ubicaciones son aproximadas. Los mismos autos y precios están en la lista.',
  'web.search.map.marker': '{car}, {total} en total',
  'web.search.map.noPoint': 'Sin punto en el mapa',
  'web.listing.dates.title': 'Tus fechas',
  'web.listing.dates.change': 'Cambiar la búsqueda',
  'common.listing.datesNoticeTooShort': {
    one: 'El anfitrión pide al menos {count} hora de anticipación. Elige una hora de inicio más tarde.',
    other:
      'El anfitrión pide al menos {count} horas de anticipación. Elige una hora de inicio más tarde.',
  },
  'common.listing.datesUnavailable':
    'Este auto no está disponible en esas fechas. Prueba con otras.',
  'common.listing.meetingPointNotFound': 'No hay una reserva confirmada de este auto en tu cuenta.',
  'web.s03.photos': '{n} / {total} fotos de {host_name}',
  'web.listing.gallery.title': 'Fotos del auto',
  'web.listing.gallery.photoAlt': '{car}, foto {n} de {total}',
  'web.listing.gallery.broken': 'Foto no disponible',
  'web.listing.slot.title': 'Elige tus fechas',
  'web.listing.slot.check': 'Ver disponibilidad',
  'web.listing.slot.ok': 'Disponible en estas fechas.',
  'web.listing.slot.error': 'No pudimos comprobar estas fechas. Inténtalo de nuevo.',
  'web.listing.meet.exact.title': 'Dirección del encuentro',
  'web.listing.meet.exact.only': 'Solo tú la ves: tienes una reserva confirmada de este auto.',
  'web.listing.meet.sameReturn': 'Devuelves el auto en el mismo lugar.',
  // US-205 (ADR-138) : conditions de la fiche S03 (annulation, distance, protection, caution)
  'web.listing.cancel.title': 'Cancelación',
  'web.listing.cancel.until': 'Cancelación gratuita hasta el {date}.',
  'web.listing.cancel.lastMinute': {
    one: 'Cancelación gratuita durante {count} hora después de reservar.',
    other: 'Cancelación gratuita durante {count} horas después de reservar.',
  },
  'web.listing.cancel.lead': {
    one: 'Cancelación gratuita hasta {count} hora antes del inicio del viaje.',
    other: 'Cancelación gratuita hasta {count} horas antes del inicio del viaje.',
  },
  'web.listing.cancel.late': {
    one: 'Si reservas con menos de {count} hora de anticipación, es gratuita durante {window} h después de reservar.',
    other:
      'Si reservas con menos de {count} horas de anticipación, es gratuita durante {window} h después de reservar.',
  },
  'web.listing.cancel.after':
    'Después, se retiene una parte del alquiler según la duración del viaje.',
  'web.listing.cancel.policyLink': 'Ver la política de cancelación',
  'web.listing.cancel.unavailable':
    'No pudimos mostrar la política de cancelación. Revísala antes de pagar.',
  'web.listing.distance.title': 'Distancia incluida',
  'web.listing.distance.total': { one: '{count} km incluido', other: '{count} km incluidos' },
  'web.listing.distance.extra': 'Cada km adicional: {amount}',
  'web.listing.protection.title': 'Protección',
  'web.listing.protection.insurer':
    'La protección se vende por cuenta de {insurer}, la aseguradora asociada, que la cubre.',
  'web.listing.protection.license': 'Registro de {name}: {ref}',
  'web.listing.protection.broker': 'Intermediario de seguros: {broker}',
  'web.listing.protection.rc':
    'Responsabilidad civil frente a terceros incluida en todos los niveles: hasta {amount} por evento.',
  'web.listing.protection.basic':
    'La protección básica es obligatoria y ya está en el precio final. Puedes subirla al reservar.',
  'web.listing.protection.deductibles': 'Lo que pagas tú por un daño cubierto (franquicia)',
  'web.listing.protection.noDeductible': 'Sin franquicia',
  'web.listing.protection.exclusions': 'Lo que no cubre',
  'web.listing.protection.unavailable':
    'Este auto todavía no tiene protección disponible, así que no se puede reservar por ahora.',
  'web.listing.protection.error':
    'No pudimos cargar la protección ni el depósito de este auto. Inténtalo de nuevo.',
  // US-205b (ADR-140) : dernière minute en minutes, jusqu'au départ ; conditions du checkout S05
  'web.listing.cancel.untilStart': 'Cancelación gratuita hasta el inicio del viaje ({date}).',
  'web.listing.cancel.lastMinuteMinutes': {
    one: 'Cancelación gratuita durante {count} minuto después de reservar.',
    other: 'Cancelación gratuita durante {count} minutos después de reservar.',
  },
  'web.listing.cancel.lateMinutes': {
    one: 'Si reservas con menos de {count} hora de anticipación, es gratuita durante {window} min después de reservar.',
    other:
      'Si reservas con menos de {count} horas de anticipación, es gratuita durante {window} min después de reservar.',
  },
  'web.listing.protection.unavailableShort': 'Este auto todavía no tiene protección disponible.',
  'web.s05.conditions.title': 'Condiciones del viaje',
  'web.s05.conditions.ifNow': 'Fechas calculadas si reservas ahora, a la hora del lugar.',
  'web.s05.cancel.retainedDay':
    'Después, se retiene 1 día de alquiler, impuestos incluidos: {amount}.',
  'web.s05.cancel.retainedHalfDay':
    'Después, se retiene medio día de alquiler, impuestos incluidos: {amount}.',
  'web.s05.cancel.ifCancelDay':
    'Si cancelas, se retiene 1 día de alquiler, impuestos incluidos: {amount}.',
  'web.s05.cancel.ifCancelHalfDay':
    'Si cancelas, se retiene medio día de alquiler, impuestos incluidos: {amount}.',
  // US-208 (ADR-133) : refus de la route du checkout (devis figé et pose du hold)
  'common.quote.notFound': 'No encontramos este presupuesto. Vuelve a la ficha del auto.',
  'common.quote.rateLimited':
    'Pediste muchos precios en poco tiempo. Espera unos minutos y vuelve a intentarlo.',
  'common.quote.expired': 'Este precio ya no es válido. Te mostramos el precio actualizado.',
  'common.quote.lineNotSupported':
    'Esta opción todavía no se puede reservar. Quítala para continuar.',
  'common.quote.protectionRequired':
    'Elige una protección para continuar: todo viaje incluye al menos la protección básica.',
  'common.quote.protectionNotEligible':
    'Esta protección no está disponible para este conductor o este auto. Elige otra.',
  'common.quote.insurerContractInactive':
    'La protección de los viajes todavía no está disponible aquí, así que aún no se puede reservar.',
  'common.listing.earningsPlanSaved':
    'Plan de ganancias guardado. Se aplica a los viajes que se reserven desde ahora; los ya reservados conservan su plan.',
  'common.listing.earningsPlanNotAvailable':
    'Este plan de ganancias no está disponible donde publicas tu auto. Elige uno de la lista.',
  'common.quote.line.protection': 'Protección',
  'common.quote.line.protectionBasica': 'Protección básica',
  'common.quote.line.protectionEstandar': 'Protección estándar',
  'common.quote.line.protectionTotal': 'Protección total',
  'common.checkout.requestModeUnavailable':
    'Este auto se reserva con solicitud al anfitrión, y eso todavía no está disponible. Elige otro auto.',
  'common.checkout.manualNotConfirmed':
    'Este auto es de caja manual. Confirma que sabes manejarlo para continuar.',
  'common.checkout.driverMustBeAccountHolder':
    'Solo el titular de la cuenta puede conducir. Escribe tu nombre como figura en tu cuenta.',
  'common.checkout.termsNotAccepted':
    'Acepta los términos, la política de cancelación y las zonas de circulación para reservar.',
  'common.checkout.quoteAlreadyUsed': 'Ya reservaste con este precio. Revisa tu reserva.',
  'common.checkout.holdNotFound': 'No encontramos esta reserva en tu cuenta.',
  'common.checkout.noticeTooShort':
    'El anfitrión necesita más anticipación. Elige una hora de inicio más tarde.',
  'common.checkout.oneWayNotAllowed': 'Devuelves el auto en el mismo lugar donde lo recoges.',
  'common.checkout.guestOverlap': 'Ya tienes un viaje en esas fechas. Elige otras.',
  'common.checkout.holdAlreadyLive':
    'Ya estás reservando este auto. Termina esa reserva o espera unos minutos.',
  'common.checkout.holdLimit':
    'Tienes demasiadas reservas en curso. Termina una antes de empezar otra.',
  'common.checkout.holdRateLimited':
    'Intentaste reservar este auto muchas veces. Espera un poco y vuelve a intentarlo.',
  'common.checkout.accountRestricted':
    'Tu cuenta no puede reservar por ahora. Escríbenos para saber más.',
  'common.checkout.listingUnavailable':
    'Este auto no se puede reservar en este momento. Elige otro.',
  // US-209 (209a, ADR-135) : âge minimum de la classe (16 BKG-012)
  'common.checkout.ageClassMismatch':
    'No tienes la edad mínima para conducir este auto el día en que empieza el viaje, o tu fecha de nacimiento no está verificada. Revisa tu perfil o elige otro auto.',
  'common.checkout.unavailable':
    'No podemos tomar tu reserva en este momento. Inténtalo más tarde.',
  // US-208 (208b, ADR-134) : total de la fiche S03, checkout S05, hold posé
  'web.listing.total.title': 'Precio final',
  'web.listing.total.hint':
    'Incluye impuestos y la tarifa del viaje. Lo confirmas en el paso siguiente.',
  'web.s05.title': 'Confirma tu reserva',
  'web.s05.intro':
    'Revisa el viaje, escribe tu nombre y acepta las condiciones. Todavía no pagas nada.',
  'web.s05.mitConsentNotice':
    'Al pagar, autorizo cargos posteriores al viaje en la tarjeta con la que pague, solo por gastos del viaje, mi franquicia o daños, siempre con aviso y prueba.',
  'web.s05.mitConsentRequiredHint': 'Obligatorio para reservar.',
  'web.s05.mitConsent':
    'Autorizo cargos posteriores al viaje en esta tarjeta solo por gastos del viaje, mi franquicia o daños, siempre con aviso y prueba.',
  'web.s05.loading': 'Cargando tu reserva…',
  'web.s05.error': 'No pudimos cargar tu reserva. Inténtalo de nuevo.',
  'web.s05.notFound': 'Presupuesto no disponible',
  'web.s05.priceChanged': 'El precio cambió',
  'web.s05.summary.title': 'Tu viaje',
  'web.s05.summary.host': 'Auto de {host_name}',
  'web.s05.intermediary':
    '{brand} es una plataforma entre particulares: intermedia y cobra el pago como comerciante de referencia, pero no es una empresa de alquiler ni la dueña del auto. El contrato de alquiler es entre {host_name} y tú.',
  'web.s05.intermediaryNoHost':
    '{brand} es una plataforma entre particulares: intermedia y cobra el pago como comerciante de referencia, pero no es una empresa de alquiler ni la dueña del auto. El contrato de alquiler es entre el anfitrión y tú.',
  'web.s05.summary.pickup': 'Recoges el auto',
  'web.s05.summary.return': 'Devuelves el auto',
  'web.s05.summary.place': 'Zona de entrega',
  'web.s05.price.title': 'Precio',
  'web.s05.line.tripPrice': {
    one: 'Alquiler · {count} día',
    other: 'Alquiler · {count} días',
  },
  'web.s05.line.taxes': 'Impuestos',
  'web.s05.validUntil': 'Precio garantizado hasta las {time}.',
  'web.s05.expired.title': 'Este precio ya no es válido',
  'web.s05.expired.body': 'Pide el precio actualizado para estas fechas antes de reservar.',
  'web.s05.expired.cta': 'Ver el precio actualizado',
  'web.s05.driver.title': 'Conductor',
  'web.s05.driver.hint':
    'Solo tú puedes manejar este auto. Escribe tu nombre tal como está en tu cuenta.',
  'web.s05.driver.first': 'Nombre',
  'web.s05.driver.last': 'Apellido',
  'web.s05.driver.firstRequired': 'Escribe tu nombre.',
  'web.s05.driver.lastRequired': 'Escribe tu apellido.',
  'web.s05.manual': 'Sé manejar caja manual',
  'web.s05.manual.hint': 'Este auto tiene caja manual.',
  'web.s05.terms.title': 'Documentos que aceptas',
  'web.s05.terms.accept': 'Acepto: {title}',
  'web.s05.terms.read': 'Leer «{title}», versión {version} (se abre en otra pestaña)',
  'web.s05.hold.notice': 'Todavía no se te cobra nada.',
  'web.s05.hold.cta': 'Reservar por {amount}',
  'web.s05.hold.missing': 'Escribe tu nombre y marca cada casilla para continuar.',
  'web.s05.hold.title': 'Te guardamos el auto',
  'web.s05.hold.until': 'Guardamos este auto para ti hasta las {time}',
  'web.s05.hold.notFound': 'Reserva no disponible',
  'web.s05.hold.total': 'Total: {amount}',
  'web.s05.hold.documents': 'Aceptaste',
  'web.s05.hold.accepted': '{document}, versión {version}',
  // US-223 partie 223b (ADR-142) : paiement du hold (S05) et attente de la preuve (S06) ; refus
  // du paiement rendus par l'API (common.payment.*) ; aucune durée écrite (heures lues dans l'API)
  'common.payment.unavailable':
    'El pago en línea no está disponible por ahora. No se te cobró nada.',
  // US-701 (ADR-169) : refus du paiement, caution impossible pour ces dates ou montant non fixé
  'common.payment.depositUnavailable':
    'Para estas fechas no podemos tomar el depósito en tu tarjeta. No se te cobró nada: cambia las fechas o elige otro auto.',
  // US-223c (ADR-146) : demandes de réservation de l'hôte (mode REQUEST, 17 §2.5 ; 16 HDB-002)
  'common.request.notFound': 'No encontramos esta solicitud.',
  'common.request.expired': 'Esta solicitud ya venció. No se le cobró nada al viajero.',
  'common.request.alreadyAnswered':
    'Esta solicitud ya no se puede responder: ya fue respondida o se está procesando.',
  'common.request.guestNotEligible':
    'El viajero ya no puede reservar. Rechaza la solicitud: no se le cobrará nada.',
  'common.request.startPassed':
    'El viaje ya empezó: esta solicitud no se puede aceptar. Recházala; no se cobrará nada al viajero.',
  'common.request.hostTermsRequired':
    'Para aceptar solicitudes, lee y acepta la versión vigente de las Condiciones del anfitrión.',
  'common.request.paymentUnavailable':
    'No podemos cobrar esta reserva por ahora. La solicitud sigue abierta: inténtalo más tarde.',
  'common.request.unavailable':
    'No pudimos procesar tu respuesta. Inténtalo de nuevo en unos minutos.',
  'common.request.amountMismatch':
    'No pudimos confirmar el monto de esta reserva. No se cobró nada. Rechaza la solicitud o escribe a soporte.',
  'common.payment.payoutRailUnavailable':
    'Todavía no podemos cobrar reservas de este auto. No se te cobró nada.',
  'common.payment.underReview':
    'Estamos revisando tu reserva antes de cualquier cobro. Vuelve a tu reserva para ver cuándo puedes pagar.',
  'common.payment.holdExpired':
    'Ya no guardamos este auto para ti. No se te cobró nada: vuelve a buscar.',
  'common.payment.holdNotPayable': 'Esta reserva ya no se puede pagar. Revisa su estado.',
  'common.payment.startPassed':
    'La hora de inicio ya pasó: no podemos cobrar esta reserva. No se te cobró nada.',
  'common.payment.attemptsExceeded':
    'Llegaste al máximo de intentos de pago para esta reserva. No se te cobró nada.',
  'common.payment.methodUnavailable': 'Este medio de pago no está disponible para esta reserva.',
  'common.payment.mitRailUnavailable':
    'Los cargos posteriores al viaje en tarjeta aún no están disponibles con nuestro proveedor de pagos.',
  'common.payment.mitConsentRequired':
    'Para reservar, acepta los cargos posteriores al viaje en tu tarjeta.',
  'web.s05.cta': 'Pagar {amount}',
  'web.s05.pay.title': 'Pago de tu reserva',
  'web.s06.pre.leaving':
    'Vas a pagar {amount} en una página segura de nuestro procesador de pagos.',
  'web.s06.status.title': 'Estado de tu pago',
  'web.s06.verifying.title': 'Pago en verificación',
  'web.s06.verifying.body': 'Esto suele tardar menos de un minuto. No pagues de nuevo.',
  'web.s06.verifying.slow': 'Seguimos esperando la confirmación de tu banco.',
  'web.s06.verifying.notify': 'Te avisaremos por correo en cuanto se confirme.',
  'web.s06.refresh': 'Actualizar el estado',
  'web.s06.reference': 'Número de reserva: {reference}',
  'web.s06.support': 'Hablar con soporte',
  'web.s06.supportBody':
    'Guarda tu número de reserva y escríbenos con él. Si se te cobró y la reserva no se confirma, te devolvemos todo el pago.',
  'web.s06.payAgain': 'Pagar de nuevo',
  'web.s06.interrupted.title': 'La página de pago no se abrió',
  'web.s06.interrupted.body':
    'Vuelve a intentarlo: revisamos primero tu pago anterior y nunca creamos un segundo cobro.',
  'web.s06.interrupted.retry': 'Reintentar el pago',
  'web.s06.confirmed.body':
    'Tu reserva está confirmada. En la ficha del auto ya ves el lugar exacto de entrega.',
  'web.s06.confirmed.cta': 'Ver el auto',
  'web.s06.declined.title': 'Pago no realizado',
  'web.error.paymentDeclined':
    'Tu banco rechazó el pago. No se hizo ningún cargo. Guardamos tu reserva hasta las {hold_end_time}: prueba otra tarjeta.',
  'web.s06.ended.title': 'Reserva expirada',
  'web.s06.ended.body': 'Ya no guardamos este auto para ti. No se te cobró nada.',
  'web.s06.unproven.title': 'No pudimos confirmar tu pago',
  'web.s06.unproven.body': 'Tu reserva no está confirmada. No pagues de nuevo.',
  'web.s06.refund.title': 'Te devolvemos tu pago',
  'web.error.paidAfterRelease':
    'Recibimos tu pago, pero el auto ya no estaba reservado para ti. Te reembolsamos {amount} completo; puedes buscar otro auto.',
  'web.s05.doc.TOS_GUEST': 'Términos y condiciones',
  'web.s05.doc.CANCELLATION_POLICY': 'Política de cancelación',
  'web.s05.doc.GEO_TERMS': 'Zonas de circulación',
  'web.s05.back': 'Volver a la ficha del auto',
  'web.legal.backCheckout': 'Volver a tu reserva',
  // US-226 partie 226b (ADR-137) : choix de la protection sur S05, mention « protection de base
  // incluse » des cartes et de la fiche, plan de gains de l'hôte (A11)
  'web.s05.protection.title': 'Elige tu protección',
  'web.s05.protection.intro':
    'Todo viaje incluye al menos la protección básica. Puedes elegir una más completa: el precio se actualiza antes de reservar.',
  'web.s05.protection.legend': 'Nivel de protección',
  'web.s05.protection.price': '{daily} por día · {total} en total',
  'web.s05.protection.minAge': 'Disponible desde los {age} años.',
  'web.s05.protection.ageNeeded': 'Indica tu edad para elegirla.',
  'web.s05.protection.apply': 'Actualizar el precio',
  'web.s05.protection.unchanged':
    'Elige otra protección o cambia tu edad para actualizar el precio.',
  'web.s05.protection.updated': 'Protección actualizada. Revisa el nuevo total antes de reservar.',
  'web.s05.age.label': 'Edad del conductor',
  'web.s05.age.hint':
    'Solo sirve para mostrarte las protecciones disponibles. Indica la edad real de quien conduce.',
  'web.s05.age.invalid': 'Escribe tu edad en años, entre {min} y {max}.',
  'common.price.protectionIncluded': 'Protección básica incluida',
  'web.a11.plan.open': 'Plan de ganancias',
  'web.a11.plan.title': 'Plan de ganancias',
  'web.a11.plan.intro':
    'Tu plan define qué parte del precio de cada viaje recibes. El viajero paga aparte la tarifa del viaje y su protección.',
  'web.a11.plan.current': 'Plan actual: {plan}',
  'web.a11.plan.option': '{plan} · recibes el {share} % del precio',
  'web.a11.plan.default': 'Asignado por defecto. Puedes cambiarlo cuando quieras.',
  'web.a11.plan.chosen': 'Elegido por ti. Puedes cambiarlo cuando quieras.',
  'web.a11.plan.newTripsOnly':
    'Un cambio se aplica a los viajes que se reserven desde ahora; los viajes ya reservados conservan su plan.',
  'web.a11.plan.only': 'Por ahora es el único plan disponible donde publicas tu auto.',
  'web.a11.plan.choose': 'Elige tu plan',
  'web.a11.plan.save': 'Guardar el plan',
  'web.a11.plan.name.ESTANDAR': 'Estándar',
  'web.a11.plan.name.other': 'Plan del {share} %',
  'web.a11.coverage.title': 'Qué cubre tu plan',
  'web.a11.coverage.period':
    'Cuando la protección de la aseguradora aliada esté activa donde publicas, tu auto estará cubierto durante el periodo de cada reserva.',
  'web.a11.coverage.contract':
    'Las exclusiones y tu franquicia vienen del contrato de la aseguradora aliada: te las mostraremos aquí, palabra por palabra, antes de que puedas recibir viajes.',
  // US-209 partie 209c (ADR-144) : S05 d'un hold en revue (délai lu dans l'API, aucune durée
  // écrite), lien vers la vérification d'identité, S06 d'une revue refusée, déclaration d'entrée
  'web.s05.review.title': 'Reserva en revisión: no se te cobró nada',
  'web.s05.review.until':
    'La revisamos antes de las {time}. Si no la aprobamos para entonces, liberamos el auto sin cobrarte nada.',
  'web.s05.review.comeBack':
    'Esta página se actualiza sola; también puedes volver más tarde para ver nuestra respuesta. Si la aprobamos, pagas aquí mismo.',
  'web.s05.review.entryHint':
    '¿Manejas con una licencia extranjera? Dinos tu fecha de entrada: nos ayuda a revisar tu reserva.',
  'web.s05.review.approvedTitle': 'Reserva aprobada',
  'web.s05.review.approvedBody': 'Ya puedes pagar. Guardamos el auto para ti hasta las {time}.',
  'web.s05.kyc.link': 'Ir a la verificación de identidad',
  'web.s06.reviewRejected.title': 'Reserva no aprobada',
  'web.s06.reviewRejected.body':
    'No pudimos aprobar tu reserva y liberamos el auto. No se te cobró nada: puedes buscar otro auto.',
  'web.s04.entry.open': 'Declarar mi fecha de entrada',
  'web.s04.entry.title': 'Tu fecha de entrada',
  'web.s04.entry.intro':
    'Si manejas con una licencia extranjera, dinos si eres turista o residente y, si eres turista, tu fecha de entrada. Nuestro equipo solo la revisa si tu reserva lo necesita.',
  'web.s04.entry.country': 'Dónde vas a manejar',
  'web.s04.entry.status': 'Tu situación migratoria',
  'web.s04.entry.TOURIST': 'Turista',
  'web.s04.entry.RESIDENT': 'Residente',
  'web.s04.entry.date': 'Fecha de entrada',
  'web.s04.entry.dateHint': 'Obligatoria si eres turista: la del sello de tu pasaporte.',
  'web.s04.entry.dateRequired': 'Escribe tu fecha de entrada: es obligatoria para un turista.',
  'web.s04.entry.statusRequired': 'Elige si eres turista o residente.',
  'web.s04.entry.submit': 'Guardar mi declaración',
  'web.s04.entry.savedTourist': 'Fecha de entrada declarada: {date}.',
  'web.s04.entry.savedResident': 'Declaraste que eres residente.',
  'web.s04.entry.back': 'Volver a la verificación de identidad',
  // US-223d (ADR-152) : écrans du mode sur demande (S05, S07 « demande envoyée », S06, A05)
  'web.s05.request.title': 'Envía tu solicitud',
  'web.s05.request.authorize':
    'Vas a autorizar {amount} en una página segura de nuestro procesador de pagos. Solo se te cobra si {host_name} acepta.',
  'web.s05.ctaRequest': 'Enviar solicitud',
  'web.s07.request.title': 'Solicitud enviada',
  'web.s07.request.pending':
    '{host_name} tiene hasta las {time} para responder. No se te cobra nada si no acepta.',
  'web.s07.request.authorized': 'Tu pago está autorizado, no cobrado.',
  'web.s07.request.hostFallback': 'El anfitrión',
  'web.s07.request.capturing.title': 'Solicitud aceptada',
  'web.s07.request.capturing.body':
    '{host_name} aceptó tu solicitud. Estamos confirmando el cobro con tu banco. No pagues de nuevo.',
  'web.s06.request.declined.title': 'Solicitud rechazada',
  'web.s06.request.expired.title': 'Solicitud vencida',
  'web.s06.request.captureFailed.title': 'No pudimos completar tu reserva',
  'web.s06.request.captureFailed.body':
    'El cobro no se pudo completar y la reserva no se hizo. Estamos anulando la autorización de tu tarjeta; si ves un cargo, te lo devolvemos completo.',
  'web.s06.request.searchCta': 'Ver autos disponibles',
  // US-223 (ouverture du mode sur demande, ADR-175) : S03 (délai de réponse de l’hôte, 10b), CTA
  // du devis S05 d’une annonce sur demande, libération de l’autorisation après un refus ou une
  // expiration (S06, BOARD N-288)
  'web.s03.request': {
    one: '{host_name} confirma en hasta {count} hora',
    other: '{host_name} confirma en hasta {count} horas',
  },
  'web.s05.request.continue': 'Continuar con la solicitud',
  'web.s06.request.authorizationRelease':
    'Estamos anulando la autorización de tu tarjeta. Si tu banco todavía la muestra, desaparecerá en unos días, sin ningún cobro.',
  'web.error.requestDeclined':
    '{host_name} no puede recibirte en estas fechas. No se te cobró nada. Mira estos autos disponibles en tus fechas.',
  'web.error.requestExpired':
    '{host_name} no respondió a tiempo. No se te cobró nada. Mira estos autos disponibles en tus fechas.',
  'web.a05.accept': 'Aceptar la solicitud',
  'web.a05.decline': 'Rechazar la solicitud',
  'web.a05.requests.title': 'Solicitudes por responder',
  'web.a05.requests.loadError': 'No pudimos cargar tus solicitudes.',
  'web.a05.request.pageTitle': 'Solicitud de reserva',
  'web.a05.request.heading': 'Solicitud n.º {ref}',
  'web.a05.request.awaiting': 'Por responder',
  'web.a05.request.capturing': 'Aceptada: cobro en curso',
  'web.a05.request.respondBy': 'Responde antes de: {date}',
  'web.a05.request.total': 'Total del viaje: {amount}',
  'web.a05.request.open': 'Ver la solicitud',
  'web.a05.request.confirmAccept.title': '¿Aceptar esta solicitud?',
  'web.a05.request.confirmAccept.body':
    'Cobraremos {amount} al viajero y la reserva quedará confirmada.',
  'web.a05.request.confirmDecline.title': '¿Rechazar esta solicitud?',
  'web.a05.request.confirmDecline.body':
    'No se le cobrará nada al viajero y tus fechas quedarán libres.',
  'web.a05.request.cancel': 'Volver sin responder',
  'web.a05.request.capturingBody':
    'Aceptaste esta solicitud. Estamos confirmando el pago del viajero; la reserva aparecerá en Próximas.',
  'web.a05.request.done.CAPTURING':
    'Aceptaste la solicitud. Estamos confirmando el pago del viajero.',
  'web.a05.request.done.ACCEPTED': 'Aceptaste la solicitud: la reserva está confirmada.',
  'web.a05.request.done.DECLINED': 'Rechazaste la solicitud. No se le cobró nada al viajero.',
  'common.contract.notFound': 'No encontramos este contrato.',
  'common.contract.notGenerated': 'El contrato se está preparando. Vuelve en unos minutos.',
  'common.contract.superseded': 'Hay una versión más reciente de este contrato: firma la vigente.',
  'common.contract.notSignable':
    'Este contrato ya no se puede firmar: el viaje fue cancelado o el auto ya se entregó.',
  'common.contract.hashMismatch':
    'El documento cambió desde que lo abriste. No se firmó nada: vuelve a cargarlo y revísalo.',
  'common.contract.textErased':
    'El texto de este contrato ya no se conserva; su huella sigue registrada.',
  'common.contract.unavailable':
    'El contrato no está disponible por ahora. Inténtalo de nuevo en unos minutos.',
  'common.constancia.notFound': 'No encontramos esta constancia.',
  'common.constancia.notAvailable': 'Este viaje se canceló: no tiene constancia de alquiler.',
  'common.constancia.notGenerated':
    'La constancia estará lista cuando se genere el contrato del viaje. Vuelve en unos minutos.',
  'common.constancia.erased': 'Los datos de esta constancia ya no se conservan.',
  'common.constancia.generationFailed':
    'No pudimos generar la constancia. Inténtalo de nuevo más tarde.',
  'common.constancia.unavailable':
    'La constancia no está disponible por ahora. Inténtalo de nuevo en unos minutos.',
  'web.contract.summary': 'Resumen',
  'web.contract.ref': 'Contrato {ref} · versión {version}',
  'web.contract.draft':
    'BORRADOR: este contrato está pendiente de validación jurídica y puede cambiar.',
  'web.contract.label.period': 'Período',
  'web.contract.label.vehicle': 'Auto',
  'web.contract.label.total': 'Total pagado, impuestos incluidos',
  'web.contract.label.protection': 'Protección',
  'web.contract.label.deposit': 'Depósito con tarjeta',
  'web.contract.label.mileage': 'Kilometraje',
  'web.contract.label.cancellation': 'Cancelación',
  'web.contract.label.lateReturn': 'Devolución con retraso',
  'web.contract.period': 'Del {start} al {end}, hora local de {country}',
  'web.contract.vehicle': '{make} {model} ({year})',
  'web.contract.protection': '{level} · franquicia de {amount}',
  'web.contract.depositNone': 'Según las condiciones de pago',
  'web.contract.mileageUnlimited': 'Ilimitado',
  'web.contract.mileageIncluded': '{km} km incluidos; cada km adicional: {price}',
  'web.contract.cancelFree': 'Gratis hasta el {date}; después se retiene {dur}: {amount}',
  'web.contract.oneDay': '1 día de alquiler',
  'web.contract.halfDay': 'medio día de alquiler',
  'web.contract.cancelPolicy': 'Según la política de cancelación aceptada en la reserva',
  'web.contract.late': 'Tolerancia de {minutes} min; después, según la política publicada',
  'web.contract.lateNone': 'Según la política publicada',
  'web.contract.text': 'Texto completo del contrato',
  'web.contract.authoritative': 'Versión en español: es la que hace fe.',
  'web.contract.courtesy': 'Traducción de cortesía',
  'web.contract.pdf': 'Descargar el PDF',
  'web.contract.hash': 'Huella SHA-256 del documento: {hash}',
  'web.contract.signedOn': 'Firmado por el viajero el {date}',
  'web.contract.seal': 'Sello: {seal}',
  'web.contract.older': 'Esta es la versión {version}. Hay una versión más reciente.',
  'web.contract.latest': 'Ver la versión vigente',
  'web.contract.loadError': 'No pudimos cargar el contrato.',
  'web.contract.retry': 'Reintentar',
  'web.contract.documents': 'Otros documentos del viaje',
  'web.contract.constancia': 'Ver la constancia de alquiler',
  'web.contract.constanciaSearch': 'Buscar la constancia de un viaje por placa y fecha',
  'web.contract.legalCenter': 'Centro legal: cómo funciona el alquiler entre particulares',
  'web.constancia.title': 'Constancia de alquiler',
  'web.constancia.lead':
    'Muéstrala en un control junto con tu licencia: acredita que el auto está alquilado entre particulares y a tu nombre.',
  'web.constancia.leadHost':
    'Sirve para acreditar a quién alquilaste el auto y cuándo, por ejemplo ante una multa recibida después del viaje.',
  'web.constancia.draft':
    'BORRADOR: el texto de la constancia está pendiente de validación jurídica y puede cambiar.',
  'web.constancia.ref': 'Viaje {ref} · contrato, versión {version}',
  'web.constancia.label.plate': 'Placa',
  'web.constancia.label.host': 'Anfitrión',
  'web.constancia.label.driver': 'Conductor',
  'web.constancia.label.place': 'Lugar de entrega',
  'web.constancia.label.contract': 'Contrato de alquiler',
  'web.constancia.signed': 'Firmado por el viajero el {date}',
  'web.constancia.unsigned': 'Aún sin firmar por el viajero',
  'web.constancia.pdf': 'Descargar la constancia (PDF)',
  'web.constancia.text': 'Texto de la constancia',
  'web.constancia.loadError': 'No pudimos cargar la constancia.',
  'web.constancia.back': 'Volver al contrato',
  'web.constancia.search.title': 'Buscar una constancia',
  'web.constancia.search.lead':
    '¿Te llegó una multa? Escribe la placa y la fecha de la infracción para encontrar el viaje y su constancia.',
  'web.constancia.search.plate': 'Placa del auto',
  'web.constancia.search.date': 'Fecha de la infracción (hora local)',
  'web.constancia.search.submit': 'Buscar el viaje',
  'web.constancia.search.none':
    'No encontramos ningún viaje de tu cuenta con esa placa en esa fecha.',
  'web.constancia.search.invalid': 'Revisa la placa y la fecha.',
  'web.constancia.search.result': 'Viaje {ref}: del {start} al {end}',
  'web.constancia.search.open': 'Ver la constancia',
  'web.legalCenter.title': 'Centro legal',
  'web.legalCenter.version': 'Versión {version} · {date}',
  'web.legalCenter.lead':
    'Cómo funciona el alquiler entre particulares, qué documentos lo rigen y qué hacer si hay un desacuerdo.',
  'web.legalCenter.role.title': 'Una plataforma entre particulares',
  'web.legalCenter.role.body1':
    'La plataforma pone en contacto a anfitriones particulares, que alquilan su propio auto, con viajeros. No es una empresa de alquiler ni propietaria de los autos.',
  'web.legalCenter.role.body2':
    'El contrato de alquiler se celebra entre el anfitrión y el viajero. La plataforma cobra el pago como comerciante de referencia y paga al anfitrión después del viaje.',
  'web.legalCenter.role.body3':
    'La protección del viaje la presta una aseguradora asociada; la plataforma la ofrece por cuenta de esa aseguradora.',
  'web.legalCenter.docs.title': 'Documentos publicados',
  'web.legalCenter.doc.TOS_GUEST': 'Términos para viajeros',
  'web.legalCenter.doc.TOS_HOST': 'Términos para anfitriones',
  'web.legalCenter.doc.PRIVACY': 'Aviso de privacidad',
  'web.legalCenter.doc.CANCELLATION_POLICY': 'Política de cancelación',
  'web.legalCenter.doc.GEO_TERMS': 'Zonas de circulación',
  'web.legalCenter.trip.title': 'Los documentos de cada viaje',
  'web.legalCenter.trip.body':
    'Cada viaje confirmado tiene su contrato de alquiler y su constancia, en español y en tu idioma. El viajero y el anfitrión los encuentran en el viaje.',
  'web.legalCenter.trip.hostSearch':
    'Anfitriones: buscar la constancia de un viaje por placa y fecha',
  'web.legalCenter.disputes.title': 'Desacuerdos y reclamos',
  'web.legalCenter.disputes.body1':
    'Si tienes un desacuerdo con la otra parte, escríbele primero por la mensajería del viaje.',
  'web.legalCenter.disputes.body2':
    'Si no se resuelve, escribe al soporte con el número del viaje: revisamos el caso con las dos partes y proponemos una solución (mediación).',
  'web.legalCenter.disputes.body3':
    'Siempre puedes acudir a la autoridad de protección al consumidor o a los tribunales del lugar del viaje. Ninguna decisión de la plataforma te lo impide.',
  'web.legalCenter.disputes.law':
    'Se aplica la ley del lugar donde se realiza el viaje. El texto en español hace fe.',
  'web.s09.contract.title': 'Tu contrato de alquiler',
  'web.s09.contract.lead':
    'El contrato es entre el anfitrión y tú. La plataforma solo intermedia: no es parte del contrato ni empresa de alquiler.',
  'web.s09.contract.toSign':
    'Fírmalo antes de la entrega: sin tu firma, el anfitrión no puede entregarte el auto.',
  'web.s09.contract.sign.title': 'Firmar el contrato',
  'web.s09.contract.sign.accept': 'Leí el contrato y lo acepto. Lo firmo electrónicamente.',
  'web.s09.contract.sign.hint':
    'Registramos la hora de nuestro servidor y la huella del documento exacto que ves.',
  'web.s09.contract.sign.cta': 'Firmar el contrato',
  'web.s09.contract.sign.required': 'Marca la casilla para firmar.',
  'web.s09.contract.signed': 'Firmaste el contrato. Puedes descargarlo con tu firma.',
  'web.a03.contract.title': 'Contrato del viaje',
  'web.a03.contract.lead':
    'El contrato es entre el viajero y tú. La plataforma solo intermedia: no es parte del contrato ni empresa de alquiler.',
  'web.a03.contract.unsigned': 'El viajero aún no firmó. Sin su firma no puedes entregar el auto.',
  'web.a03.contract.signed': 'El viajero firmó el contrato.',
  'web.a03.contract.back': 'Volver a la reserva',
  'web.a05.contract': 'Ver el contrato',
  'web.s06.confirmed.contract': 'Leer y firmar el contrato',
  // S06 confirmé, contenu de 10b S07 (US-213, ADR-157)
  'web.s07.title': '¡Reserva confirmada!',
  'web.s07.documents':
    'Lleva tu licencia de conducir física y tu documento de identidad: el anfitrión los revisará en la entrega.',
  'web.s07.safety':
    'Para tu seguridad: encuéntrense en un lugar público e iluminado, avisa a alguien de confianza dónde estarás y escribe solo por {brand}.',
  // US-215b (v69) : annulation d’un voyage par l’ops et état réel de la demande (console O01)
  'backoffice.cancel.heading': 'Cancelar un viaje',
  'backoffice.cancel.intro':
    'El viajero o el anfitrión pidió la cancelación al soporte, o la plataforma cancela el viaje. Nunca ingresas un monto: la plataforma calcula el reembolso y la penalidad.',
  'backoffice.cancel.who': '¿Quién pide la cancelación?',
  'backoffice.cancel.whoHint': 'Elige primero quién la pide: el formulario se adapta.',
  'backoffice.cancel.trip': 'Identificador del viaje',
  'backoffice.cancel.sub': 'Motivo del anfitrión',
  'backoffice.cancel.sub.none': 'El anfitrión cancela (sin culpa del viajero)',
  'backoffice.cancel.sub.INVALID_LICENSE': 'Por el viajero: licencia no válida',
  'backoffice.cancel.sub.IDENTITY_NOT_VERIFIED': 'Por el viajero: identidad no verificada',
  'backoffice.cancel.sub.OTHER_DRIVER_SENT': 'Por el viajero: llegó otro conductor',
  'backoffice.cancel.sub.LICENSE_NOT_UPLOADED':
    'Por el viajero: licencia no enviada en la hora previa al inicio',
  'backoffice.cancel.subHint':
    '“Por el viajero” necesita una prueba adjunta: sin prueba, la cancelación cuenta para el anfitrión, con penalidad.',
  'backoffice.cancel.platform': 'Motivo de la plataforma',
  'backoffice.cancel.platform.PLATFORM_TRUST_SAFETY': 'Confianza y seguridad',
  'backoffice.cancel.platform.PLATFORM_INCOMPLETE_STEPS': 'Pasos obligatorios sin completar',
  'backoffice.cancel.platform.GUEST_FRAUD_PROVEN': 'Fraude del viajero comprobado',
  'backoffice.cancel.platform.HOST_ACCOUNT_CLOSED': 'Cuenta del anfitrión cerrada',
  'backoffice.cancel.platform.PLATFORM_REVIEW_DELAY': 'Revisión no hecha a tiempo',
  'backoffice.cancel.platform.PSP_FAILURE': 'Falla del proveedor de pagos',
  'backoffice.cancel.review': 'Revisar antes de enviar',
  'backoffice.cancel.readHeading': 'Estado de una cancelación',
  'backoffice.cancel.read': 'Ver el estado',
  'backoffice.cancel.confirmHeading': 'Confirma la cancelación',
  'backoffice.cancel.confirmIntro':
    'Revisa antes de enviar. Una vez liquidada, la cancelación no se puede deshacer.',
  'backoffice.cancel.action': 'Acción',
  'backoffice.cancel.motive': 'Motivo elegido',
  'backoffice.cancel.guestMotive': 'Cancelación pedida por el viajero',
  'backoffice.cancel.evidenceCount': 'Pruebas adjuntas',
  'backoffice.cancel.evidenceNone': 'Ninguna',
  'backoffice.cancel.noEvidenceWarning':
    'Sin prueba adjunta, la cancelación “por el viajero” se recalifica como cancelación del anfitrión, con penalidad.',
  'backoffice.cancel.confirm': 'Confirmar la cancelación',
  'backoffice.cancel.edit': 'Corregir',
  'backoffice.cancel.sent':
    'Solicitud registrada. La liquidación está en curso: abajo ves su estado real.',
  'backoffice.cancel.stateHeading': 'Estado de la cancelación',
  'backoffice.cancel.readError': 'No se pudo leer el estado. Vuelve a intentarlo.',
  'backoffice.cancel.none': 'Este viaje no tiene ninguna solicitud de cancelación.',
  'backoffice.cancel.readLive': 'Ver la solicitud en curso',
  'backoffice.cancel.refresh': 'Actualizar',
  'backoffice.cancel.restart': 'Nueva cancelación',
  'backoffice.cancel.state.PENDING': 'Solicitud registrada, liquidación en curso',
  'backoffice.cancel.state.PENDINGBody':
    'La plataforma liquida la solicitud en unos segundos. Esta pantalla se actualiza sola.',
  'backoffice.cancel.state.SETTLED': 'Cancelación liquidada',
  'backoffice.cancel.state.SETTLEDBody':
    'El viaje está cancelado y el reembolso del viajero está planificado, monto por monto de cada parte.',
  'backoffice.cancel.state.FIN_REVIEW': 'Liquidación en revisión por FINANCE',
  'backoffice.cancel.state.FIN_REVIEWBody':
    'El viaje no está cancelado. La solicitud espera una decisión de FINANCE: avísale al equipo con el identificador de la solicitud. Mientras siga en revisión, se rechaza otra solicitud para este viaje.',
  'backoffice.cancel.state.FAILED': 'La liquidación falló: el viaje no está cancelado',
  'backoffice.cancel.state.FAILEDBody':
    'No se reembolsó nada. Puedes hacer la solicitud de nuevo; si vuelve a fallar, repórtalo con el identificador de la solicitud.',
  'backoffice.cancel.slow': 'La liquidación tarda más de lo previsto. Actualiza en un momento.',
  'backoffice.cancel.requestId': 'Identificador de la solicitud',
  'backoffice.cancel.requestedAt': 'Pedida el',
  'backoffice.cancel.why': 'Motivo del bloqueo',
  'backoffice.cancel.outcome': 'Resultado',
  'backoffice.cancel.bearer': 'Costo a cargo de',
  'backoffice.cancel.bearer.GUEST': 'el viajero',
  'backoffice.cancel.bearer.HOST': 'el anfitrión',
  'backoffice.cancel.bearer.PLATFORM': 'la plataforma',
  'backoffice.cancel.refundTotal': 'Reembolso del viajero',
  'backoffice.cancel.penalty': 'Penalidad del anfitrión (descontada de sus ganancias)',
  'backoffice.cancel.compensation': 'Compensación del anfitrión',
  'backoffice.cancel.legsCaption': 'Reembolso por parte',
  'backoffice.cancel.legColumn': 'Parte',
  'backoffice.cancel.amountColumn': 'Monto',
  'backoffice.cancel.refundsCaption': 'Órdenes de reembolso',
  'backoffice.cancel.refundStatusColumn': 'Estado',
  'backoffice.cancel.trip.CANCELLED_BY_GUEST': 'Cancelado por el viajero',
  'backoffice.cancel.trip.CANCELLED_BY_HOST': 'Cancelado por el anfitrión',
  'backoffice.cancel.trip.CANCELLED_BY_PLATFORM': 'Cancelado por la plataforma',
  'backoffice.cancel.trip.NO_SHOW_GUEST': 'El viajero no se presentó',
  'backoffice.cancel.leg.HOST': 'Anfitrión',
  'backoffice.cancel.leg.INSURER': 'Compañía de seguros',
  'backoffice.cancel.leg.TAX_THIRD_PARTY': 'Impuesto',
  'backoffice.cancel.leg.PLATFORM': 'Plataforma',
  'backoffice.cancel.refund.PENDING': 'Por enviar al proveedor de pagos',
  'backoffice.cancel.refund.SUBMITTED': 'Enviada al proveedor de pagos',
  'backoffice.cancel.refund.SUCCEEDED': 'Reembolsada',
  'backoffice.cancel.refund.FAILED': 'Fallida',
  'backoffice.cancel.refund.UNKNOWN': 'Estado desconocido, en verificación',
  'backoffice.cancel.error.trip': 'Ingresa el identificador completo del viaje.',
  'backoffice.cancel.error.reason': 'El motivo debe tener entre 10 y 1000 caracteres.',
  'backoffice.cancel.error.platformReason': 'Elige el motivo de la plataforma.',
  'backoffice.cancel.refused.CANCEL_REASON_REQUIRED':
    'Falta el motivo de la plataforma. No se registró nada.',
  'backoffice.cancel.refused.TRIP_TRANSITION_FORBIDDEN':
    'Este viaje ya no se puede cancelar aquí: empezó o terminó. No se registró nada.',
  'backoffice.cancel.refused.CANCELLATION_PENDING':
    'Ya existe una solicitud de cancelación para este viaje. No se registró nada.',
  'backoffice.cancel.refused.SELF_FORBIDDEN':
    'No puedes cancelar un viaje que te concierne. No se registró nada.',
  'backoffice.cancel.refused.NOT_FOUND': 'No encontramos este viaje. Revisa el identificador.',
  'backoffice.cancel.outcome.QUOTE_UNAVAILABLE':
    'El presupuesto fijado del viaje no está disponible.',
  'backoffice.cancel.outcome.PARAM_MISSING':
    'Falta un parámetro de cancelación en la configuración.',
  'backoffice.cancel.outcome.TRIP_NOT_CAPTURED': 'El pago del viaje no está cobrado por partes.',
  'backoffice.cancel.outcome.ROW_SHAPE': 'Datos del viaje inesperados.',
  'backoffice.cancel.outcome.UNEXPECTED_ERROR': 'Error inesperado de la plataforma.',
  'backoffice.cancel.outcome.RETRY_EXHAUSTED': 'Se agotaron los intentos de liquidación.',
  'backoffice.cancel.outcome.TRIP_TRANSITION_FORBIDDEN':
    'El estado del viaje cambió y ya no permite cancelarlo.',
  'backoffice.cancel.outcome.TRIP_CANCELLATION_SETTLEMENT_MISMATCH':
    'La liquidación calculada no coincide con los datos del viaje.',
  'backoffice.cancel.outcome.REFUND_OUT_OF_RANGE': 'Un reembolso supera lo cobrado en una parte.',
  'backoffice.cancel.outcome.OPERATION_SETTLEMENT_FIN_REVIEW':
    'Una orden de reembolso necesita una decisión de FINANCE.',
  'backoffice.cancel.outcome.REFUND_EXCEEDS_COLLECTED': 'El reembolso supera lo cobrado.',
  'backoffice.cancel.outcome.ADVANCE_DECISION_REQUIRED':
    'Hace falta una decisión de FINANCE sobre un anticipo de la plataforma.',
  'backoffice.cancel.outcome.SETTLEMENT_INPUT_INVALID':
    'Los datos de la liquidación no son válidos.',
  // US-224f (ADR-166) : remboursement réparti sur les moyens d’origine (codes garés)
  'backoffice.cancel.outcome.REFUND_RAIL_UNAVAILABLE':
    'Un reembolso iría a un medio de pago que todavía no se reembolsa automáticamente. No se registró nada; lo atiende FINANCE.',
  'backoffice.cancel.outcome.REFUND_RAIL_NOT_NATIVE':
    'Se pidió un reembolso a tarjeta sobre otro medio de pago. No se registró nada.',
  'backoffice.cancel.outcome.REFUND_EXCEEDS_TENDER':
    'Un reembolso supera lo que pagó un medio de pago.',
  // US-214 (ADR-160) : « Mis viajes » (S08) et détail du trip du voyageur (S09)
  'common.trips.notFound': 'No encontramos este viaje.',
  'common.trips.unavailable':
    'No podemos mostrar tus viajes en este momento. Vuelve a intentarlo en unos minutos.',
  'web.s08.heading': 'Mis viajes',
  'web.s08.section.REQUESTED': 'Solicitudes enviadas',
  'web.s08.section.UPCOMING': 'Próximos',
  'web.s08.section.IN_PROGRESS': 'En curso',
  'web.s08.section.DONE': 'Anteriores',
  'web.s08.section.CANCELLED': 'Cancelados',
  'web.s08.none': 'Aún no tienes viajes',
  'web.s08.emptyCta': 'Buscar un auto',
  'web.s08.loadError': 'No pudimos cargar tus viajes.',
  'web.s08.reference': 'Viaje {ref}',
  'web.s08.request': 'Solicitud de reserva',
  'web.s08.dates': 'Del {start} al {end}',
  'web.s08.host': 'Anfitrión: {name}',
  'web.s08.hostHidden': 'anfitrión particular',
  'web.s08.respondBy':
    'El anfitrión responde a más tardar el {date}. No se te cobra nada si no acepta.',
  'web.s08.openTrip': 'Ver el viaje',
  'web.s08.openRequest': 'Ver la solicitud',
  'web.s09.heading': 'Tu viaje',
  'web.s09.back': 'Volver a mis viajes',
  'web.s09.localTime': 'Horas en la zona horaria local del viaje.',
  'web.s09.host.lead':
    'Tu anfitrión es un particular que alquila su propio auto. La entrega y la devolución se hacen en persona.',
  'web.s09.place.title': 'Lugar de entrega',
  'web.s09.place.hidden': 'La dirección exacta solo se muestra para un viaje próximo o en curso.',
  'web.s09.payment.title': 'Pago',
  'web.s09.payment.total': 'Total pagado',
  'web.s09.payment.CONFIRMED': 'Pago confirmado',
  'web.s09.payment.REFUNDED_PARTIAL': 'Reembolsado en parte',
  'web.s09.payment.REFUNDED': 'Reembolsado',
  'web.s09.refund.link': 'Ver tu reembolso',
  'web.s09.documents.title': 'Documentos',
  'web.s09.documents.contract': 'Contrato de alquiler',
  'web.s09.documents.contract.NONE': 'En preparación',
  'web.s09.documents.contract.TO_SIGN': 'Por firmar',
  'web.s09.documents.contract.SIGNED': 'Firmado',
  'web.s09.documents.open': 'Abrir el contrato',
  'web.s09.documents.constancia': 'Constancia de alquiler',
  'web.s09.documents.receipt': 'Recibo del pago',
  'web.s09.documents.soon': 'Disponible pronto',
  'web.s09.loadError': 'No pudimos cargar este viaje.',
  'web.s09.changes':
    '¿Necesitas cambiar o cancelar un viaje? Por ahora, cualquier cambio pasa por nuestro soporte.',
  'web.s08.requestAccepted': 'El anfitrión aceptó tu solicitud. Estamos confirmando tu pago.',
  'web.s09.documents.contract.UNSIGNED': 'Sin firmar',
  'web.s06.confirmed.trips': 'Ver mis viajes',
  // US-224 partie 224d (ADR-154) : remboursement lu par le voyageur (S10), l’hôte (A05) et la console
  'common.receipt.notFound': 'No encontramos este recibo.',
  'common.receipt.notReady':
    'Este recibo aún no está disponible: el pago del viaje todavía no se registró.',
  'common.receipt.unavailable':
    'No podemos mostrar tu recibo en este momento. Vuelve a intentarlo en unos minutos.',
  'common.earnings.notFound': 'No encontramos estas ganancias.',
  'common.earnings.unavailable':
    'No podemos mostrar tus ganancias en este momento. Vuelve a intentarlo en unos minutos.',
  'common.refund.notFound': 'No encontramos este reembolso.',
  'common.refund.unavailable':
    'No podemos mostrar tu reembolso en este momento. Vuelve a intentarlo en unos minutos.',
  'web.s10.refund.title': 'Tu reembolso',
  'web.s10.refund.lead':
    'Nosotros te devolvemos el monto calculado al cancelar, en el medio de pago que usaste. El reembolso no depende del anfitrión.',
  'web.s10.refund.amount': 'Monto reembolsado',
  'web.s10.refund.none': 'Este viaje no tiene reembolsos.',
  'web.s10.refund.noneHint':
    'Si tu viaje se cancela, aquí verás el monto reembolsado y su fecha de emisión.',
  'web.s10.refund.loadError': 'No pudimos cargar tu reembolso.',
  'web.s10.refund.rail.NATIVE_PARTIAL': 'En tu medio de pago original.',
  'web.s10.refund.rail.ROLLBACK_AND_RECHARGE':
    'En tu medio de pago original: anulamos el pago inicial y volvemos a cobrar solo lo que corresponde. Verás dos movimientos en tu estado de cuenta.',
  'web.s10.refund.rail.BANK_TRANSFER': 'Por transferencia a una cuenta bancaria a tu nombre.',
  'web.s10.refund.rail.CREDIT_CASH': 'Como saldo a tu favor, con tu acuerdo.',
  'web.refund.status.PREPARING': 'En preparación',
  'web.refund.status.ISSUED': 'Emitido',
  'web.refund.status.CONFIRMED': 'Confirmado por el proveedor de pagos',
  'web.refund.status.ATTENTION': 'En revisión',
  'web.refund.issuedOn': 'Emitido el {date}',
  'web.refund.bankDelay':
    'Tu banco puede tardar algunos días hábiles en mostrarlo en tu estado de cuenta.',
  'web.refund.preparing': 'Estamos preparando la emisión. La fecha de emisión aparecerá aquí.',
  'web.refund.attention':
    'La emisión tuvo un problema. Nuestro equipo se encarga; no tienes que hacer nada.',
  'web.a05.refund.title': 'Reembolso al viajero',
  'web.a05.refund.lead':
    'Nosotros reembolsamos al viajero. Aquí ves solo la parte que se descuenta de tus ganancias por este viaje.',
  'web.a05.refund.hostLeg': 'Se descuenta de tus ganancias: {amount}',
  'web.a05.refund.noImpact': 'Sin efecto en tus ganancias.',
  'backoffice.refunds.heading': 'Reembolsos de un viaje',
  'backoffice.refunds.lead':
    'Solo lectura: estado de cada reembolso, partes pedidas por la liquidación, orden enviada al proveedor de pagos y motivo de bloqueo. Nada se ejecuta desde aquí.',
  'backoffice.refunds.trip': 'Identificador del viaje',
  'backoffice.refunds.tripInvalid': 'El identificador del viaje no es válido.',
  'backoffice.refunds.read': 'Ver los reembolsos',
  'backoffice.refunds.none': 'Ningún reembolso para este viaje.',
  'backoffice.refunds.caption': 'Reembolsos del viaje',
  'backoffice.refunds.statusColumn': 'Estado del reembolso',
  'backoffice.refunds.amountColumn': 'Monto reembolsado al viajero',
  'backoffice.refunds.issuedColumn': 'Fecha de emisión',
  'backoffice.refunds.detailColumn': 'Detalle del reembolso',
  'backoffice.refunds.notIssued': 'Todavía no emitido',
  'backoffice.refunds.attempt': 'intento {n}, versión {v} de la liquidación',
  'backoffice.refunds.requested': 'Partes pedidas por la liquidación: {legs}',
  'backoffice.refunds.order': 'Orden enviada al proveedor de pagos: {legs}',
  'backoffice.refunds.advance': 'Adelanto de la plataforma: {amount}',
  'backoffice.refunds.status.PLANNED': 'Planificado',
  'backoffice.refunds.status.BLOCKED_CHARGEBACK': 'Bloqueado por un contracargo',
  'backoffice.refunds.status.PENDING_CUSTOMER_CHOICE': 'Espera la elección del viajero',
  'backoffice.refunds.status.PENDING_BANK_DETAILS': 'Espera los datos bancarios del viajero',
  'backoffice.refunds.status.SUBMITTED': 'Emisión autorizada',
  'backoffice.refunds.status.SENT': 'Enviado al proveedor de pagos',
  'backoffice.refunds.status.CONFIRMED': 'Confirmado por el proveedor de pagos',
  'backoffice.refunds.status.FAILED': 'Rechazado por el proveedor de pagos',
  'backoffice.refunds.status.CREDITED': 'Acreditado como saldo',
  'backoffice.refunds.status.CANCELLED': 'Anulado',
  'backoffice.refunds.status.SUPERSEDED': 'Reemplazado por una versión nueva',
  'backoffice.refunds.rail.NATIVE_PARTIAL': 'Reembolso parcial en el medio original',
  'backoffice.refunds.rail.ROLLBACK_AND_RECHARGE': 'Anulación del pago y nuevo cobro',
  'backoffice.refunds.rail.BANK_TRANSFER': 'Transferencia bancaria',
  'backoffice.refunds.rail.CREDIT_CASH': 'Saldo a favor del viajero',
  'backoffice.refunds.reason.ADVANCE_CAP_UNSET':
    'Bloqueado: el tope de adelanto por anfitrión no está definido. Hace falta una decisión de FINANCE a dos personas.',
  'backoffice.refunds.reason.HOST_ADVANCE_CAP':
    'Bloqueado: el adelanto superaría el tope del anfitrión. Hace falta una decisión de FINANCE a dos personas.',
  'backoffice.refunds.reason.PLATFORM_BALANCE_UNKNOWN':
    'Bloqueado: el saldo de la plataforma no se conoce. Hace falta una decisión de FINANCE a dos personas.',
  'backoffice.refunds.reason.SUPERSEDED_UNSENT':
    'Orden nunca enviada de una liquidación reemplazada: no se enviará. Revisión de FINANCE.',
  'backoffice.refunds.reason.NO_TARGET':
    'No se conoce el pago original que hay que reembolsar. Revisión de FINANCE.',
  'backoffice.refunds.reason.MISMATCH':
    'El proveedor de pagos devolvió un monto o una moneda distintos de la orden. Revisión de FINANCE.',
  'backoffice.refunds.reason.REFUND_FAILED':
    'El proveedor de pagos rechazó el reembolso. Revisión de FINANCE.',
  'backoffice.refunds.reason.REFUND_EXCEEDS_COLLECTED':
    'El reembolso superaría lo cobrado en una parte. Nada se envió.',
  'backoffice.refunds.reason.SETTLEMENT_SUPERSEDED':
    'La liquidación fue reemplazada por una versión nueva. Nada se envió con la anterior.',
  'backoffice.refunds.reason.FIN_REVIEW_REQUIRED':
    'La liquidación necesita una decisión de FINANCE antes de cualquier envío.',
  'backoffice.refunds.reason.other': 'Código técnico {code}. Revisión de FINANCE.',
  // US-217 partie 217b (ADR-167) : reçu du voyageur (S09 · reçu) et gains de l’hôte (A08)
  'web.s09.documents.receiptOpen': 'Ver el recibo',
  'web.s09.receipt.title': 'Recibo del pago',
  'web.s09.receipt.back': 'Volver a tu viaje',
  'web.s09.receipt.intermediary':
    '{brand} es una plataforma intermediaria entre particulares: no es arrendadora ni propietaria del auto. Alquilas el auto directamente a {host}, su anfitrión.',
  'web.s09.receipt.intermediaryNoHost':
    '{brand} es una plataforma intermediaria entre particulares: no es arrendadora ni propietaria del auto. Alquilas el auto directamente a su anfitrión.',
  'web.s09.receipt.payment': 'Lo que pagaste',
  'web.s09.receipt.totalPaid': 'Total pagado a {brand}',
  'web.s09.receipt.fee.title': 'Tarifa del viaje',
  'web.s09.receipt.fee.charged': 'Tarifa del viaje facturada',
  'web.s09.receipt.fee.tax': 'Impuesto facturado sobre la tarifa ({rate} %)',
  'web.s09.receipt.fee.refunded': 'Parte de la tarifa que se te devuelve',
  'web.s09.receipt.fee.retained': 'Parte de la tarifa que conserva {brand}',
  'web.s09.receipt.fee.taxElsewhere':
    'El impuesto de la parte conservada no se muestra aquí: figura en la factura que se emite por separado.',
  'web.s09.receipt.refund.title': 'Reembolso',
  'web.s09.receipt.refund.due': 'Reembolso que te corresponde',
  'web.s09.receipt.refund.hint':
    '{brand} te lo devuelve en tu medio de pago original. Es el importe que corresponde según la cancelación; la fecha en que lo emitimos se muestra aparte.',
  'web.s09.receipt.refund.link': 'Ver el estado de tu reembolso',
  'web.s09.receipt.fiscal':
    'Este recibo no es una factura y no tiene valor fiscal. La factura electrónica se envía por separado.',
  'web.host.earningsLink': 'Mis ganancias',
  'web.a08.title': 'Ganancias',
  'web.a08.intro': 'Lo que ganas con cada viaje según tu plan, mes a mes.',
  'web.a08.back': 'Volver a mi espacio de anfitrión',
  'web.a08.intermediary':
    '{brand} es una plataforma intermediaria entre particulares: alquilas tu auto directamente al viajero.',
  'web.a08.monthNav': 'Mes del resumen',
  'web.a08.prev': 'Mes anterior',
  'web.a08.next': 'Mes siguiente',
  'web.a08.summary': 'Resumen de {month}',
  'web.a08.earned': 'Ganado',
  'web.a08.earnedHint': 'Tu parte de los viajes liquidados, menos las penalidades.',
  'web.a08.pending': 'Por liquidar',
  'web.a08.pendingHint':
    'Viajes próximos o en curso: tu parte se confirma cuando se liquida el viaje.',
  'web.a08.tripsCount': 'Viajes del mes: {count}',
  'web.a08.lines': 'Detalle por viaje',
  'web.a08.line.EARNING': 'Viaje',
  'web.a08.line.CXL_EARNING': 'Viaje cancelado',
  'web.a08.line.HOST_CANCELLATION_PENALTY': 'Penalidad por cancelar un viaje',
  'web.a08.line.penaltyHint': 'Se descuenta de tus próximas ganancias.',
  'web.a08.line.settled': 'Liquidado',
  'web.a08.line.pending': 'Por liquidar',
  'web.a08.line.base': 'Precio sobre el que se calcula tu parte',
  'web.a08.line.fee': 'Comisión de {brand}',
  'web.a08.line.share': 'Tu parte · {plan} ({share} %)',
  'web.a08.line.shareNoPlan': 'Tu parte',
  'web.a08.line.trip': 'Ver el viaje',
  'web.a08.loadError': 'No pudimos cargar tus ganancias.',
  'web.a08.retry': 'Reintentar',
  'web.a08.empty': 'Aún no tienes ganancias',
  'web.a08.payoutsOff':
    'Tus ganancias quedan registradas. Los pagos a anfitriones en {country} aún no están abiertos; te avisaremos.',
  // US-314 : versements de l’hôte (A08), motifs de retenue, lignes du host_ledger (ADR-192)
  'common.payouts.readForbidden': 'No puedes ver los pagos de esta cuenta.',
  'common.payouts.unavailable': 'No pudimos cargar tus pagos. Inténtalo más tarde.',
  'web.a08.line.RELEASED_LEG_ADVANCE': 'Reembolso al viajero adelantado por la plataforma',
  'web.a08.line.CHARGEBACK_CLAWBACK': 'Contracargo del viajero',
  'web.a08.line.RECEIVABLE_WRITE_OFF': 'Deuda anulada',
  'web.a08.line.PAYOUT_NETTING': 'Descontado de un pago',
  'web.a08.line.creditHint': 'Este monto reduce lo que debes.',
  'web.a08.payouts.title': 'Pagos',
  'web.a08.payouts.schedule':
    'Te pagamos {n} días hábiles después del fin del viaje, hacia las {time} (hora local). El primer pago a una cuenta nueva sale {first} días hábiles después del viaje, mientras verificamos la cuenta.',
  'web.a08.payouts.scheduleClosed':
    'Cuando los pagos a anfitriones abran en {country}, te pagaremos {n} días hábiles después del fin del viaje, hacia las {time} (hora local); el primer pago a una cuenta nueva, {first} días hábiles después del viaje.',
  'web.a08.payouts.toPay': 'Monto a pagar',
  'web.a08.payouts.scheduleUnknown': 'El calendario de pagos de {country} aún no está publicado.',
  'web.a08.payouts.empty': 'Aún no tienes pagos. Preparamos uno después de cada viaje terminado.',
  'web.a08.payouts.scheduledFor': 'Previsto el {date}',
  'web.a08.payouts.sentOn': 'Enviado el {date}',
  'web.a08.payouts.paidOn': 'Pagado el {date}',
  'web.a08.payouts.first': 'Primer pago',
  'web.a08.payouts.gross': 'Ganancias del pago',
  'web.a08.payouts.netted': 'Descontado por montos que debes',
  'web.a08.payouts.net': 'Monto del pago',
  'web.a08.payouts.heldTitle': 'Pago retenido',
  'web.a08.payouts.loadError': 'No pudimos cargar tus pagos.',
  'web.a08.payouts.trips': { one: '{count} viaje', other: '{count} viajes' },
  'web.a08.payouts.status.SCHEDULED': 'Programado',
  'web.a08.payouts.status.ON_HOLD': 'Retenido',
  'web.a08.payouts.status.NETTING': 'En preparación',
  'web.a08.payouts.status.READY': 'Listo para enviar',
  'web.a08.payouts.status.ZERO_NET': 'Sin monto a pagar',
  'web.a08.payouts.status.INITIATED': 'Enviado',
  'web.a08.payouts.status.IN_TRANSIT': 'En camino',
  'web.a08.payouts.status.PAID': 'Pagado',
  'web.a08.payouts.status.FAILED': 'Rechazado por el banco',
  'web.a08.payouts.hold.PAYOUTS_DISABLED':
    'Los pagos a anfitriones en {country} aún no están abiertos.',
  'web.a08.payouts.hold.FUNDS_HOLDING_DISABLED':
    'Este medio de pago aún no está disponible en {country}.',
  'web.a08.payouts.hold.VARIANT_B_UNAVAILABLE': 'Este medio de pago aún no está disponible.',
  'web.a08.payouts.hold.HOST_PAYOUT_RAIL_UNAVAILABLE':
    'Nuestro proveedor de pagos aún no puede pagar a particulares en {country}.',
  'web.a08.payouts.hold.SUBMERCHANT_INACTIVE':
    'Nuestro proveedor de pagos aún está verificando tu cuenta.',
  'web.a08.payouts.hold.PAYOUT_ACCOUNT_MISSING':
    'Agrega una cuenta de cobro para recibir tus pagos.',
  'web.a08.payouts.hold.PAYOUT_ACCOUNT_UNVERIFIED': 'Tu cuenta de cobro aún se está verificando.',
  'web.a08.payouts.hold.PAYOUT_ACCOUNT_CHANGE_HOLD':
    'Cambiaste tu cuenta de cobro hace poco: por seguridad, el pago espera un tiempo.',
  'web.a08.payouts.hold.CHARGEBACK':
    'El viajero disputó el cobro con su banco; el pago espera la decisión.',
  'web.a08.payouts.hold.DISPUTE':
    'Hay un desacuerdo abierto sobre este viaje; el pago espera la decisión.',
  'web.a08.payouts.hold.CLAIM':
    'Hay un reclamo abierto sobre este viaje; el pago espera la decisión de nuestro equipo de soporte.',
  'web.a08.payouts.hold.TRIP_NOT_COMPLETED': 'El viaje aún no está cerrado.',
  'web.a08.payouts.hold.OTHER': 'El pago está retenido; nuestro equipo lo revisa.',
  // US-303 : photos guidées de l’état du véhicule (ADR-179)
  'common.inspection.notFound': 'No encontramos las fotos de este viaje.',
  'common.inspection.notOpen': 'Las fotos de este viaje no están abiertas en este momento.',
  'common.inspection.submitted': 'Ya validaste tus fotos: no se pueden cambiar.',
  'common.inspection.limitReached': 'Llegaste al máximo de fotos de esta serie.',
  'common.inspection.templateIncomplete':
    'Faltan fotos obligatorias. Toma todos los ángulos antes de validar.',
  'common.inspection.galleryForbidden':
    'Toma la foto con la cámara de la aplicación: no se aceptan fotos de la galería.',
  'common.inspection.photoInvalid': 'No pudimos aceptar esta foto. Tómala de nuevo.',
  'common.inspection.uploadUnavailable':
    'El envío de fotos no está disponible por ahora. Inténtalo más tarde.',
  'common.inspection.unavailable': 'Las fotos no están disponibles por ahora. Inténtalo más tarde.',
  'web.inspection.title.checkin': 'Fotos de salida',
  'web.inspection.title.checkout': 'Fotos de devolución',
  'web.inspection.lead':
    'Toma cada ángulo con la cámara de la aplicación. {brand} registra la hora de su servidor y la huella de cada foto: así sirven de prueba entre ustedes.',
  'web.inspection.progress': '{count} de {total} fotos obligatorias',
  'web.inspection.other.HOST': 'Fotos del anfitrión: {count} de {total}',
  'web.inspection.other.GUEST': 'Fotos del viajero: {count} de {total}',
  'web.inspection.otherDone': 'Ya validó sus fotos.',
  'web.inspection.group.EXTERIOR': 'Exterior',
  'web.inspection.group.INTERIOR': 'Interior',
  'web.inspection.group.GAUGES': 'Combustible y kilometraje',
  'web.inspection.group.OPTIONAL': 'Opcional: llaves y daños que ya existían',
  'web.inspection.slot.EXT_01': 'Frente',
  'web.inspection.slot.EXT_02': 'Esquina delantera izquierda',
  'web.inspection.slot.EXT_03': 'Lado izquierdo, adelante',
  'web.inspection.slot.EXT_04': 'Lado izquierdo, atrás',
  'web.inspection.slot.EXT_05': 'Esquina trasera izquierda',
  'web.inspection.slot.EXT_06': 'Parte trasera',
  'web.inspection.slot.EXT_07': 'Esquina trasera derecha',
  'web.inspection.slot.EXT_08': 'Lado derecho, atrás',
  'web.inspection.slot.EXT_09': 'Lado derecho, adelante',
  'web.inspection.slot.EXT_10': 'Esquina delantera derecha',
  'web.inspection.slot.EXT_11': 'Techo y parabrisas',
  'web.inspection.slot.EXT_12': 'Rueda delantera izquierda',
  'web.inspection.slot.EXT_13': 'Rueda trasera izquierda',
  'web.inspection.slot.EXT_14': 'Rueda trasera derecha',
  'web.inspection.slot.EXT_15': 'Rueda delantera derecha',
  'web.inspection.slot.INT_01': 'Tablero',
  'web.inspection.slot.INT_02': 'Asiento del conductor',
  'web.inspection.slot.INT_03': 'Asiento del acompañante',
  'web.inspection.slot.INT_04': 'Asientos traseros',
  'web.inspection.slot.INT_05': 'Maletero',
  'web.inspection.slot.INT_06': 'Puertas delanteras por dentro',
  'web.inspection.slot.INT_07': 'Puertas traseras por dentro',
  'web.inspection.slot.INT_08': 'Piso y alfombras',
  'web.inspection.slot.FUEL': 'Indicador de combustible',
  'web.inspection.slot.ODOMETER': 'Kilometraje del tablero',
  'web.inspection.slot.KEY': 'Llaves',
  'web.inspection.slot.DAMAGE': 'Daño que ya existía {n}',
  'web.inspection.optional': 'Opcional',
  'web.inspection.taken': 'Recibida a las {time}',
  'web.inspection.missingSlot': 'Falta',
  'web.inspection.shoot': 'Tomar la foto',
  'web.inspection.retake': 'Tomar de nuevo',
  'web.inspection.camera.open': 'Abrir la cámara',
  'web.inspection.camera.close': 'Cerrar la cámara',
  'web.inspection.camera.for': 'Ángulo: {slot}',
  'web.inspection.camera.unavailable':
    'La cámara no está disponible en este teléfono o navegador. Autoriza el acceso a la cámara e inténtalo de nuevo.',
  'web.inspection.sending': 'Enviando la foto…',
  'web.inspection.sent': 'Foto guardada: {slot}',
  'web.inspection.submit': 'Validar mis fotos',
  'web.inspection.submitHint': 'Después de validar, tus fotos ya no se pueden cambiar.',
  'web.inspection.missing': 'Faltan {count} fotos obligatorias.',
  'web.s09c.done': 'Tus fotos quedaron guardadas',
  'web.inspection.doneAt': 'Validadas el {date}',
  'web.inspection.closed':
    'Las fotos se toman al momento de la entrega y de la devolución del auto.',
  'web.inspection.uploadsClosed': 'El envío de fotos aún no está abierto. Vuelve más tarde.',
  'web.inspection.back': 'Volver al viaje',
  'web.inspection.loadError': 'No pudimos cargar las fotos.',
  'web.inspection.retry': 'Reintentar',
  'web.inspection.link.checkin': 'Fotos de salida del auto',
  'web.inspection.link.checkout': 'Fotos de devolución del auto',
  'common.handover.notFound': 'No encontramos la entrega de este viaje.',
  'common.handover.hostOnly': 'Solo el anfitrión puede hacer este paso.',
  'common.handover.checkinNotOpen': 'La entrega todavía no está abierta para este viaje.',
  'common.handover.checkoutNotOpen': 'La devolución se abre cuando el viaje está en curso.',
  'common.handover.paymentNotConfirmed':
    'El pago todavía no está confirmado: no se puede entregar el auto.',
  'common.handover.contractNotSigned':
    'El viajero todavía no firmó el contrato: no se puede entregar el auto.',
  'common.handover.depositNotReady':
    'El depósito de garantía todavía no está listo: no se puede entregar el auto.',
  'common.handover.insurerInactive':
    'La protección de la aseguradora no está activa por ahora: no se puede entregar el auto.',
  'common.handover.blocked': 'La entrega está bloqueada. Escribe a soporte.',
  'common.handover.licenseCheckIncomplete':
    'Revisa los 6 puntos de la licencia, o elige un motivo para no entregar el auto.',
  'common.handover.identityFailed': 'La licencia no se verificó: la entrega está detenida.',
  'common.handover.checkinStepIncomplete':
    'Falta un paso de la entrega: primero valida tus fotos y la licencia.',
  'common.handover.checkoutStepIncomplete':
    'Falta un paso de la devolución: primero valida tus fotos.',
  'common.handover.readingInvalid': 'Revisa el kilometraje y el combustible.',
  'common.handover.contactlessUnavailable':
    'La entrega sin encuentro no está disponible: se hace en persona.',
  'common.handover.unavailable':
    'No pudimos guardar este paso. Revisa tu conexión y vuelve a intentarlo.',
  'web.a03.arrived': 'Ya llegué',
  'web.a03.refuse': 'No entregar el auto',
  'web.a03.handover': 'Entregar las llaves',
  'web.a03.check.face': 'La persona se parece a la foto de la licencia',
  'web.a03.check.name': 'El nombre y la inicial del apellido coinciden con la licencia',
  'web.a03.check.birthYear': 'El año de nacimiento coincide',
  'web.a03.check.valid': 'La licencia está vigente',
  'web.a03.check.provisional': 'No es una licencia provisional',
  'web.a03.check.restrictions': 'Sus restricciones permiten manejar este auto',
  'web.handover.back': 'Volver al viaje',
  'web.handover.title.checkin': 'Entrega del auto',
  'web.handover.title.checkout': 'Devolución del auto',
  'web.handover.link.checkin': 'Hacer la entrega del auto',
  'web.handover.link.checkout': 'Hacer la devolución del auto',
  'web.handover.loadError': 'No pudimos cargar la entrega.',
  'web.handover.retry': 'Volver a cargar',
  'web.handover.lead.checkin':
    'Hagan la entrega juntos, en persona, en el lugar acordado. Cada paso dice qué falta.',
  'web.handover.lead.checkout': 'Hagan la devolución juntos, en persona. Cada paso dice qué falta.',
  'web.handover.online': 'Necesitas conexión a internet: sin red, nada se guarda.',
  'web.handover.step.arrival': 'Llegada al lugar de entrega',
  'web.handover.step.license': 'Licencia de conducir',
  'web.handover.step.photos': 'Fotos del auto',
  'web.handover.step.keys': 'Kilometraje, combustible y llaves',
  'web.handover.step.close': 'Kilometraje, combustible y cierre',
  'web.handover.opensAt': 'La entrega se abre el {date}.',
  'web.handover.opened': 'La entrega está abierta.',
  'web.handover.closed': 'Este paso no está abierto en este momento.',
  'web.handover.checkoutClosed': 'La devolución se abre cuando el viaje esté en curso.',
  'web.handover.blockersTitle': 'Antes de entregar el auto, falta:',
  'web.handover.blocker.CHECKIN_PAYMENT_NOT_CONFIRMED': 'la confirmación del pago',
  'web.handover.blocker.CONTRACT_NOT_SIGNED': 'la firma del contrato por el viajero',
  'web.handover.blocker.DEPOSIT_NOT_READY': 'el depósito de garantía',
  'web.handover.blocker.INSURER_CONTRACT_INACTIVE': 'la protección activa de la aseguradora',
  'web.handover.blocker.HANDOVER_BLOCKED': 'una revisión de soporte; escribe a soporte desde Ayuda',
  'web.handover.license.lead':
    'Compara la licencia física del viajero con estos datos. No le tomes foto ni anotes su número.',
  'web.handover.license.name': 'Nombre en la cuenta',
  'web.handover.license.birthYear': 'Año de nacimiento en la cuenta',
  'web.handover.license.unknown': 'Dato no disponible',
  'web.handover.license.points': 'Los 6 puntos de la licencia',
  'web.handover.license.confirm': 'Confirmar la licencia',
  'web.handover.license.ok': 'Licencia verificada',
  'web.handover.license.failed':
    'Entrega detenida: la licencia no se verificó. El viaje no puede empezar.',
  'web.handover.license.guest': 'El anfitrión revisará tu licencia física al encontrarse.',
  'web.handover.refuse.reason': 'Motivo si no entregas el auto',
  'web.handover.refuse.INVALID_LICENSE': 'La licencia no es válida',
  'web.handover.refuse.IDENTITY_NOT_VERIFIED': 'La persona no coincide con la cuenta',
  'web.handover.refuse.OTHER_DRIVER_SENT': 'Vino otro conductor',
  'web.handover.refuse.choose': '— Elige un motivo —',
  'web.handover.refuse.confirm':
    'Entiendo que no entregar el auto es una decisión definitiva: la entrega se detiene y no se puede deshacer.',
  'web.handover.refuse.reasonRequired': 'Elige el motivo antes de no entregar el auto.',
  'web.handover.refuse.confirmRequired': 'Confirma que entiendes que la decisión es definitiva.',
  'web.handover.refuse.hint':
    'Si un punto no se cumple, no entregues el auto: elige el motivo y confirma. Es definitivo: la entrega se detiene y el viaje no podrá empezar.',
  'web.handover.photos.mine.NONE': 'Tus fotos: sin empezar',
  'web.handover.photos.mine.DRAFT': 'Tus fotos: en curso',
  'web.handover.photos.mine.SUBMITTED': 'Tus fotos: validadas',
  'web.handover.photos.other.HOST.NONE': 'Fotos del anfitrión: sin empezar',
  'web.handover.photos.other.HOST.DRAFT': 'Fotos del anfitrión: en curso',
  'web.handover.photos.other.HOST.SUBMITTED': 'Fotos del anfitrión: validadas',
  'web.handover.photos.other.GUEST.NONE': 'Fotos del viajero: sin empezar',
  'web.handover.photos.other.GUEST.DRAFT': 'Fotos del viajero: en curso',
  'web.handover.photos.other.GUEST.SUBMITTED': 'Fotos del viajero: validadas',
  'web.handover.photos.take': 'Tomar mis fotos',
  'web.handover.photos.view': 'Ver mis fotos',
  'web.handover.odometer': 'Kilometraje del tablero (km)',
  'web.handover.fuel': 'Nivel de combustible (octavos)',
  'web.handover.reading': 'Confirmaste: {km} km, combustible {fuel}/8.',
  'web.handover.validate.HOST.checkout': 'Recibir el auto',
  'web.handover.validate.GUEST.checkin': 'Recibí el auto',
  'web.handover.validate.GUEST.checkout': 'Devolver el auto',
  'web.handover.mitReminder':
    'Recuerda: aceptaste que se cobren en tu tarjeta los gastos posteriores al viaje (combustible, peajes, retraso, limpieza) y tu parte de un daño, siempre con aviso y prueba. Al validar, lo confirmas.',
  'web.handover.validate.hint': 'La hora que cuenta es la del servidor cuando ambos confirman.',
  'web.handover.waiting.HOST': 'Esperando la confirmación del viajero.',
  'web.handover.waiting.GUEST': 'Esperando la confirmación del anfitrión.',
  'web.handover.otherDone': 'La otra persona ya confirmó: falta tu confirmación.',
  'web.handover.photosFirst': 'Primero valida tus fotos del auto.',
  'web.handover.licenseFirst': 'Primero verifica la licencia del viajero.',
  'web.handover.done.checkin': 'Viaje en curso desde el {date}.',
  'web.handover.done.checkout': 'Auto devuelto el {date}.',
  // US-525 (ADR-181) : messagerie par trip (S16) et rappels du signal hors plateforme
  'common.messages.thread': 'Mensajes del viaje.',
  'common.messages.sent': 'Mensaje enviado.',
  'common.messages.threadClosed':
    'Esta conversación ya está cerrada: puedes leerla, pero no enviar mensajes.',
  'common.messages.invalid': 'Escribe un mensaje de 1 a 2000 caracteres.',
  'common.messages.unavailable':
    'No pudimos cargar ni enviar mensajes en este momento. Tu texto sigue aquí: vuelve a intentarlo en unos minutos.',
  'web.s16.heading': 'Mensajes',
  'web.s16.back': 'Volver al viaje',
  'web.s16.with': 'Conversación con {name}',
  'web.s16.withUnknown': 'Conversación del viaje',
  'web.s16.payOnPlatform': 'Todos los pagos se hacen en {brand}: nunca por fuera.',
  'web.s16.privacy':
    'Solo ves el nombre de pila. Ocultamos teléfonos, correos y enlaces para cuidarlos a los dos.',
  'web.s16.empty':
    'Aún no hay mensajes. Escríbele a {host_name} si tienes una pregunta sobre la entrega.',
  'web.s16.emptyHost': 'Aún no hay mensajes. Escríbele a {name} para coordinar la entrega.',
  'web.s16.you': 'Tú',
  'web.s16.role.GUEST': 'Viajero',
  'web.s16.role.HOST': 'Anfitrión',
  'web.s16.role.CO_HOST': 'Coanfitrión',
  'web.s16.sentAt': 'Enviado el {date}',
  'web.s16.masked': 'Ocultamos datos de contacto en este mensaje.',
  'web.s16.hidden': 'El equipo de soporte ocultó este mensaje.',
  'web.s16.closesAt': 'Puedes escribir hasta el {date}.',
  'web.s16.closed': 'Esta conversación ya está cerrada: puedes leerla, pero no enviar mensajes.',
  'web.s16.loadError': 'No pudimos cargar los mensajes.',
  'web.s16.retry': 'Volver a intentar',
  'web.s16.form.label': 'Tu mensaje',
  'web.s16.form.hint':
    'Coordina aquí la hora y el lugar de la entrega. Nunca compartas datos de pago.',
  'web.s16.form.send': 'Enviar',
  'web.s16.form.required': 'Escribe un mensaje.',
  'web.s16.notice.contactMasked':
    'Ocultamos los datos de contacto de tu mensaje: la conversación se queda en {brand}, donde estás protegido.',
  'web.s16.notice.offPlatform':
    'Recuerda: todo pago pasa por {brand}. Un pago por fuera no tiene protección ni reembolso, y nuestro equipo revisa estos mensajes.',
  'web.s16.sent': 'Mensaje enviado.',
  // aide et urgence pendant le trip (US-310, ADR-182, catalogue v97)
  'web.shell.help': 'Ayuda',
  'web.help.title': 'Ayuda y emergencias',
  'web.help.lead': 'Los números de emergencia y de asistencia están siempre en esta página.',
  'web.help.emergency.title': 'En una emergencia',
  'web.help.emergency.call': 'Emergencias: {number}',
  'web.help.emergency.accident':
    'Después de un accidente de tránsito, avisa también a {authority}.',
  'web.help.emergency.safety':
    'Si tú u otra persona están en peligro, ponte a salvo y llama primero a emergencias.',
  'web.help.roadside.title': 'Avería o accidente',
  'web.help.roadside.number': 'Asistencia de la aseguradora asociada: {number}',
  'web.help.roadside.inApp':
    'El número de la asistencia de la aseguradora asociada aparecerá aquí. Mientras tanto, pide ayuda desde tu viaje.',
  'web.help.support.title': 'Soporte de {brand}',
  'web.help.support.number': 'Teléfono del soporte: {number}',
  'web.help.support.inApp':
    'Pide ayuda desde el detalle de tu viaje: tu solicitud llega a nuestro equipo.',
  'web.help.support.hours':
    'Atención de personas, en español y en inglés, todos los días de {from} a {to} (hora local).',
  'web.help.support.noHours':
    'Si nuestro equipo no está disponible, recibes enseguida los números de asistencia y te respondemos lo antes posible.',
  'web.help.trips.lead': '¿Tienes un viaje? Ve a tus viajes para pedir ayuda sobre uno de ellos.',
  'web.help.trips.link': 'Mis viajes',
  'web.help.unavailable':
    'No pudimos cargar los números. En una emergencia, llama a los servicios de emergencia locales.',
  'web.help.faq.title': 'Preguntas frecuentes',
  'web.help.faq.accident.q': '¿Qué hago después de un accidente?',
  'web.help.faq.accident.a':
    'Ponte a salvo y llama a emergencias si hay heridos. Avisa a la autoridad de tránsito y a la asistencia de la aseguradora, toma fotos y pide ayuda desde tu viaje.',
  'web.help.faq.privacy.q': '¿El soporte comparte mi teléfono?',
  'web.help.faq.privacy.a':
    'No. Nunca damos tu teléfono a la otra persona del viaje: escríbanse solo por {brand}.',
  'web.help.trip.title': 'Ayuda con este viaje',
  'web.help.trip.back': 'Volver al viaje',
  'web.help.trip.section': 'Ayuda y emergencias',
  'web.help.trip.open': 'Pedir ayuda o ver los números de emergencia',
  'web.help.request.title': 'Pedir ayuda a {brand}',
  'web.help.request.topic': '¿Qué pasa?',
  'web.help.topic.ACCIDENT': 'Tuve un accidente',
  'web.help.topic.BREAKDOWN': 'El auto tiene una avería',
  'web.help.topic.HANDOVER': 'Problema con la entrega o la devolución',
  'web.help.topic.SAFETY': 'Tengo un problema de seguridad',
  'web.help.topic.OTHER': 'Otra consulta sobre este viaje',
  'web.help.request.safetyHint': 'Si hay peligro inmediato, llama primero a emergencias.',
  'web.help.request.privacy':
    'Tu solicitud solo indica el tema y el viaje. Nunca compartimos tu teléfono con la otra persona.',
  'web.help.request.submit': 'Enviar solicitud',
  'web.help.request.topicRequired': 'Elige un tema.',
  'web.help.request.sent': 'Recibimos tu solicitud.',
  'web.help.request.offHours':
    'Nuestro equipo no está disponible en este momento: te enviamos los números de asistencia y te responderemos lo antes posible.',
  'web.help.request.inHours': 'Nuestro equipo la revisará y te contactará.',
  'web.help.request.exists':
    'Ya tienes una solicitud abierta sobre este tema: nuestro equipo la está siguiendo.',
  'web.help.request.error': 'No pudimos enviar tu solicitud. Usa los números de esta página.',
  'common.help.unavailable':
    'La ayuda en la app no está disponible ahora. En una emergencia, llama a los servicios de emergencia.',
  'common.help.authority.attt': 'Tránsito (ATTT)',
  'common.help.authority.caminera': 'la Policía Caminera o la Policía Municipal de Tránsito (PMT)',
  'ntf.helpOffHours.email.subject': 'Recibimos tu solicitud de ayuda ({booking_ref})',
  'ntf.helpOffHours.email.body':
    'Hola, {first_name}. Recibimos tu solicitud de ayuda sobre la reserva {booking_ref}. Nuestro equipo no está disponible en este momento y te responderá lo antes posible. Si hay peligro o heridos, llama a emergencias. {assistance}',
  'ntf.helpOffHours.sms.body':
    '{brand}: recibimos tu solicitud ({booking_ref}). Te responderemos lo antes posible. Si hay peligro, llama a emergencias. {assistance}',
  'ntf.helpOffHoursHost.email.subject': 'Recibimos tu solicitud de ayuda ({booking_ref})',
  'ntf.helpOffHoursHost.email.body':
    'Hola, {first_name}. Recibimos tu solicitud de ayuda sobre la reserva {booking_ref}. Nuestro equipo no está disponible en este momento y te responderá lo antes posible. Si hay peligro o heridos, llama a emergencias. {assistance}',
  'ntf.helpOffHoursHost.sms.body':
    '{brand}: recibimos tu solicitud ({booking_ref}). Te responderemos lo antes posible. Si hay peligro, llama a emergencias. {assistance}',
  // confidentialité, rendez-vous et rétention de la messagerie (US-316, ADR-186, catalogue v101)
  'common.meetings.list': 'Encuentros del viaje.',
  'common.meetings.proposed': 'Propuesta enviada.',
  'common.meetings.answered': 'Respuesta registrada.',
  'common.meetings.notAllowed':
    'Solo quien ofrece el auto propone el encuentro y solo quien viaja lo confirma, mientras el viaje no haya terminado.',
  'common.meetings.notFound': 'No encontramos esta propuesta de encuentro.',
  'common.meetings.notPending': 'Esta propuesta ya fue respondida o reemplazada por otra.',
  'common.meetings.expired': 'La hora propuesta ya pasó. Pide otra propuesta en los mensajes.',
  'common.meetings.invalid':
    'Indica un lugar de 3 a 160 caracteres y una hora futura cercana a las fechas del viaje.',
  'common.meetings.placeContact':
    'El lugar no puede llevar teléfono, correo, usuario ni enlace. Describe un sitio fácil de ubicar.',
  'web.s16.purged': 'Este mensaje se borró al terminar el plazo de conservación.',
  'web.s16.meeting.heading': 'Encuentro',
  'web.s16.meeting.leadGuest':
    'Tu anfitrión propone el lugar y la hora de la entrega y de la devolución; confírmalos aquí.',
  'web.s16.meeting.leadHost':
    'Propón el lugar y la hora de la entrega y de la devolución; el viajero los confirma.',
  'web.s16.meeting.privacy': 'El lugar solo lo ven ustedes dos; los avisos indican solo la hora.',
  'web.s16.meeting.none': 'Aún no hay encuentro propuesto.',
  'web.s16.meeting.kind.PICKUP': 'Entrega',
  'web.s16.meeting.kind.RETURN': 'Devolución',
  'web.s16.meeting.status.PROPOSED': 'Por confirmar',
  'web.s16.meeting.status.ACCEPTED': 'Confirmado',
  'web.s16.meeting.status.DECLINED': 'Rechazado',
  'web.s16.meeting.place': 'Lugar: {place}',
  'web.s16.meeting.accept': 'Confirmar',
  'web.s16.meeting.decline': 'Rechazar',
  'web.s16.meeting.done.ACCEPTED': 'Encuentro confirmado. Les avisamos a los dos con la hora.',
  'web.s16.meeting.done.DECLINED':
    'Propuesta rechazada. Escríbele a tu anfitrión para acordar otra.',
  'web.s16.meeting.done.PROPOSED': 'Propuesta enviada. El viajero la confirmará aquí.',
  'web.s16.meeting.form.title': 'Proponer un encuentro',
  'web.s16.meeting.form.kind': 'Etapa',
  'web.s16.meeting.form.place': 'Lugar del encuentro',
  'web.s16.meeting.form.placeHint':
    'Un lugar público y fácil de ubicar. Sin teléfono, correo ni enlace.',
  'web.s16.meeting.form.when': 'Fecha y hora',
  'web.s16.meeting.form.whenHint': 'Hora local del viaje.',
  'web.s16.meeting.form.submit': 'Proponer',
  'web.s16.meeting.form.required': 'Indica el lugar, la fecha y la hora.',
  'ntf.meetingPickupConfirmed.email.subject':
    'Reserva {booking_ref}: encuentro de la entrega confirmado',
  'ntf.meetingPickupConfirmed.email.body':
    'Hola, {first_name}. El encuentro para la entrega de la reserva {booking_ref} quedó confirmado para el {meet_at}. El lugar acordado está en los mensajes de la reserva en {brand}.',
  'ntf.meetingPickupConfirmed.sms.body':
    '{brand}: encuentro de la entrega confirmado ({booking_ref}) para el {meet_at}. Lugar en los mensajes de la app.',
  'ntf.meetingReturnConfirmed.email.subject':
    'Reserva {booking_ref}: encuentro de la devolución confirmado',
  'ntf.meetingReturnConfirmed.email.body':
    'Hola, {first_name}. El encuentro para la devolución de la reserva {booking_ref} quedó confirmado para el {meet_at}. El lugar acordado está en los mensajes de la reserva en {brand}.',
  'ntf.meetingReturnConfirmed.sms.body':
    '{brand}: encuentro de la devolución confirmado ({booking_ref}) para el {meet_at}. Lugar en los mensajes de la app.',
  // US-307 (ADR-191) : no-show et refus du véhicule — routes, écrans de l’hôte et du voyageur, console
  'common.noShow.notFound': 'No encontramos este viaje.',
  'common.noShow.checkinNotOpen': 'Primero abre la entrega del auto («Ya llegué»).',
  'common.noShow.notAllowed': 'Este viaje ya no admite esta declaración.',
  'common.noShow.tooEarly': 'Aún es pronto: espera la hora indicada para declararlo.',
  'common.noShow.windowClosed': 'El plazo para declararlo terminó (72 horas después del inicio).',
  'common.noShow.partyPresent': 'La otra persona sí se presentó a la entrega.',
  'common.noShow.evidenceRequired':
    'Escríbele en los mensajes del viaje y espera 15 minutos sin respuesta: es la prueba de tu espera.',
  'common.noShow.pending': 'Ya hay una solicitud en curso para este viaje.',
  'common.noShow.unavailable': 'No pudimos registrarlo. Revisa tu conexión y vuelve a intentarlo.',
  'web.noShow.title.HOST': 'El viajero no llegó',
  'web.noShow.title.GUEST': 'El anfitrión no llegó',
  'web.noShow.back': 'Volver al viaje',
  'web.noShow.link.HOST': 'El viajero no llegó',
  'web.noShow.link.GUEST': 'El anfitrión no llegó',
  'web.noShow.lead.HOST':
    'Si el viajero no se presenta, puedes declararlo desde el {d1} hasta el {d2}.',
  'web.noShow.lead.GUEST':
    'Si el anfitrión no se presenta, puedes avisarnos desde el {d1} hasta el {d2}.',
  'web.noShow.rule.HOST':
    'Antes, escríbele en los mensajes del viaje y espera 15 minutos. Sin ese mensaje, el viajero recibe el mismo reembolso, pero tú no recibes ganancias por este viaje.',
  'web.noShow.rule.GUEST':
    'Escríbele en los mensajes del viaje y espera 15 minutos. Kmino verifica tu aviso y, si se confirma, te devuelve todo lo que pagaste.',
  'web.noShow.traced.yes': 'Tu mensaje y la espera de 15 minutos quedaron registrados.',
  'web.noShow.traced.no': 'Todavía no hay un mensaje tuyo con 15 minutos de espera.',
  'web.noShow.messagesLink': 'Ir a los mensajes del viaje',
  'web.noShow.declare.HOST': 'Declarar que el viajero no llegó',
  'web.noShow.declare.GUEST': 'Avisar que el anfitrión no llegó',
  'web.noShow.confirmRequired': 'Marca la casilla para confirmar que es una decisión definitiva.',
  'web.noShow.status.AWAITING_REVIEW':
    'Aviso registrado el {date}. Kmino lo verifica antes de cualquier reembolso; el resultado aparecerá en esta página.',
  'web.noShow.title.against': 'Aviso de no presentación',
  'web.noShow.against.HOST': 'El viajero indicó el {date} que no te presentaste a la entrega.',
  'web.noShow.against.GUEST': 'El anfitrión declaró el {date} que no te presentaste a la entrega.',
  'web.noShow.againstStatus.AWAITING_REVIEW':
    'Kmino lo está verificando. Si estuviste ahí, escríbenos desde la ayuda del viaje.',
  'web.noShow.againstStatus.PENDING': 'Kmino está calculando el resultado del viaje.',
  'web.noShow.againstStatus.SETTLED': 'Resuelto: el viaje está cancelado.',
  'web.noShow.againstStatus.FIN_REVIEW':
    'Kmino está revisando el resultado. Aparecerá en esta página.',
  'web.noShow.againstStatus.FAILED': 'El aviso no se mantuvo: el viaje sigue según lo previsto.',
  'backoffice.noShow.choice.NO_SHOW_REJECT_REPORT':
    'Rechazar el aviso del viajero: el anfitrión sí estuvo',
  'backoffice.noShow.refused.NO_SHOW_REPORT_INVALIDATED':
    'El aviso del viajero ya no se sostiene (el anfitrión estuvo presente o el viaje cambió de estado). Recházalo.',
  'backoffice.noShow.refused.NO_REPORT_PENDING':
    'No hay ningún aviso del viajero por revisar en este viaje.',
  'backoffice.noShow.tripInvalid': 'Escribe el identificador completo del viaje.',
  'backoffice.noShow.confirm.title': 'Confirma antes de registrar',
  'backoffice.noShow.confirm.trip': 'Viaje: {d1}',
  'backoffice.noShow.confirm.irreversible':
    'Es definitivo: el viaje puede cancelarse, con reembolso y, según el caso, una penalización. No se puede deshacer.',
  'backoffice.noShow.confirm.send': 'Confirmar y registrar',
  'backoffice.noShow.confirm.back': 'Corregir',
  'backoffice.noShow.next': 'Revisar',
  'web.noShow.final':
    'Es una decisión definitiva: el viaje se cancela y Kmino calcula el reembolso.',
  'web.noShow.status.PENDING':
    'Declaración registrada el {date}. Kmino está calculando el reembolso.',
  'web.noShow.status.SETTLED': 'Resuelto: el viaje está cancelado y el reembolso está en curso.',
  'web.noShow.status.FIN_REVIEW':
    'Kmino está revisando el reembolso. El resultado aparecerá en esta página.',
  'web.noShow.status.FAILED':
    'No se pudo resolver así. Si necesitas ayuda, escríbenos desde la ayuda del viaje.',
  'web.noShow.reason.GUEST_NO_SHOW': 'Motivo: el viajero no llegó.',
  'web.noShow.reason.HOST_NO_SHOW': 'Motivo: el anfitrión no llegó.',
  'web.noShow.reason.other': 'Motivo: otra cancelación del viaje.',
  'web.noShow.loadError': 'No pudimos cargar esta página.',
  'web.noShow.retry': 'Volver a intentarlo',
  'backoffice.noShow.heading': 'No presentación y rechazo del auto',
  'backoffice.noShow.hint':
    'Declara una no presentación o valida un rechazo del auto en la entrega. Kmino calcula el reembolso; nunca escribas un monto.',
  'backoffice.noShow.subject': 'Viaje',
  'backoffice.noShow.choice.NO_SHOW_GUEST': 'El viajero no llegó',
  'backoffice.noShow.choice.NO_SHOW_HOST':
    'El anfitrión no llegó: validar el aviso del viajero o declararlo (adjunta la prueba)',
  'backoffice.noShow.choice.REFUSE_CLEANLINESS': 'Auto sucio: el viajero lo rechaza',
  'backoffice.noShow.choice.REFUSE_SAFETY': 'Auto peligroso: el viajero lo rechaza',
  'backoffice.noShow.choice.REFUSE_INVALID_LICENSE':
    'Licencia no válida: el anfitrión no entrega el auto',
  'backoffice.noShow.choice.REFUSE_IDENTITY_NOT_VERIFIED':
    'Identidad no verificada: el anfitrión no entrega el auto',
  'backoffice.noShow.choice.REFUSE_OTHER_DRIVER_SENT':
    'Llegó otra persona: el anfitrión no entrega el auto',
  'backoffice.noShow.evidenceHint':
    'Identificadores de las pruebas, separados por espacios. Sin prueba, un rechazo por licencia se trata como cancelación del anfitrión.',
  'backoffice.noShow.settleNote':
    'El reembolso y la penalización del anfitrión se calculan después. Revisa su estado en «Cancelaciones».',
  'backoffice.noShow.record': 'Registrar',
  'backoffice.noShow.recorded': 'Solicitud registrada. El reembolso se está calculando.',
  'backoffice.noShow.refused.NO_SHOW_TOO_EARLY':
    'Aún es pronto: el tiempo de espera todavía no ha terminado.',
  'backoffice.noShow.refused.NO_SHOW_WINDOW_CLOSED':
    'Plazo vencido: pasaron más de 72 horas desde el inicio.',
  'backoffice.noShow.refused.NO_SHOW_PARTY_PRESENT': 'La persona sí se presentó a la entrega.',
  'backoffice.noShow.refused.NO_SHOW_PARTY_REQUIRED': 'Elige quién no llegó.',
  'backoffice.noShow.refused.REFUSAL_REASON_REQUIRED': 'Elige el motivo del rechazo.',
  'backoffice.noShow.refused.REFUSAL_AFTER_CHECKIN':
    'El viajero ya validó la entrega: usa un incidente.',
  'backoffice.noShow.refused.CHECKIN_NOT_OPEN': 'La entrega aún no está abierta.',
  'backoffice.noShow.refused.TRIP_TRANSITION_FORBIDDEN': 'El estado del viaje ya no lo permite.',
  'backoffice.noShow.refused.CANCELLATION_PENDING':
    'Ya hay una solicitud en curso para este viaje.',
  'backoffice.noShow.refused.SELF_FORBIDDEN': 'No puedes actuar sobre un viaje tuyo.',
  'backoffice.noShow.refused.NOT_FOUND': 'No encontramos este viaje.',
  'ntf.tripAtRiskHost.email.subject': 'Reserva {booking_ref}: el auto aún no volvió',
  'ntf.tripAtRiskHost.email.body':
    'Hola, {first_name}. Tu reserva {booking_ref} empieza el {start_at}, pero el viaje anterior con este auto aún no terminó: la devolución está atrasada. Nuestro equipo te contactará para ver las opciones con el viajero. Puedes escribirnos desde la reserva en la app.',
  'ntf.tripAtRiskHost.sms.body':
    '{brand}: el auto de la reserva {booking_ref} ({start_at}) aún no fue devuelto por el viaje anterior. Te contactaremos.',
  'common.reviews.trip': 'Opiniones del viaje.',
  'common.reviews.submitted': 'Opinión enviada.',
  'common.reviews.received': 'Opiniones recibidas.',
  'common.reviews.hostProfile': 'Perfil del anfitrión.',
  'common.reviews.alreadySubmitted':
    'Ya opinaste sobre este viaje. Una opinión no se puede cambiar.',
  'common.reviews.notOpen': 'Podrás opinar cuando se registre la devolución del auto.',
  'common.reviews.windowClosed': 'El plazo para opinar sobre este viaje terminó.',
  'common.reviews.textRequired':
    'Con 3 estrellas o menos, cuenta qué pasó en al menos 25 caracteres.',
  'common.reviews.invalid': 'Revisa la calificación y el texto (1000 caracteres como máximo).',
  'common.reviews.unavailable':
    'Las opiniones no están disponibles por ahora. Vuelve a intentarlo en unos minutos.',
  'web.review.until': 'Puedes opinar hasta el {date}',
  'web.review.blind': {
    one: '{name} no verá tu opinión hasta que ambos opinen o hasta {count} día después del fin del viaje',
    other:
      '{name} no verá tu opinión hasta que ambos opinen o hasta {count} días después del fin del viaje',
  },
  'web.review.closed': 'El plazo para opinar terminó el {date}.',
  'web.review.back': 'Volver al viaje',
  'web.review.heading.guest': 'Opina sobre tu viaje',
  'web.review.heading.host': 'Opina sobre el viajero',
  'web.review.with': 'Viaje con {name}',
  'web.review.withUnknown': 'Viaje',
  'web.review.overall': 'Calificación general',
  'web.review.stars': { one: '{count} estrella', other: '{count} estrellas' },
  'web.review.subScores': 'Detalle (opcional)',
  'web.review.sub.cleanliness': 'Limpieza',
  'web.review.sub.communication': 'Comunicación',
  'web.review.sub.convenience': 'Facilidad de la entrega',
  'web.review.sub.accuracy': 'Exactitud del anuncio',
  'web.review.sub.maintenance': 'Mantenimiento',
  'web.review.sub.punctuality': 'Puntualidad',
  'web.review.sub.returnCondition': 'Estado al devolver el auto',
  'web.review.sub.rulesRespect': 'Respeto de las reglas',
  'web.review.noScore': 'Sin nota',
  'web.review.text': 'Tu opinión',
  'web.review.textHint':
    'Obligatoria con 3 estrellas o menos (25 caracteres como mínimo). Se publica con tu nombre de pila; no incluyas teléfonos ni correos.',
  'web.review.final': 'Una vez enviada, tu opinión no se puede cambiar.',
  'web.review.public.guest': 'Tu opinión será pública en el perfil del viajero, que podrá leerla.',
  'web.review.public.host': 'Tu opinión será pública en el anuncio y en el perfil del anfitrión.',
  'web.review.submit': 'Enviar opinión',
  'web.review.mine': 'Tu opinión',
  'web.review.status.SUBMITTED': 'Guardada: se publicará cuando ambos opinen o termine el plazo.',
  'web.review.status.PUBLISHED': 'Publicada',
  'web.review.done.SUBMITTED': 'Listo. Tu opinión quedó guardada.',
  'web.review.done.PUBLISHED': 'Listo. Ambas opiniones ya están publicadas.',
  'web.review.masked': 'Ocultamos datos de contacto que había en tu texto.',
  'web.review.published': 'Opiniones publicadas',
  'web.review.publishedEmpty': 'Aún no hay opiniones publicadas sobre este viaje.',
  'web.review.author.GUEST': 'Viajero',
  'web.review.author.HOST': 'Anfitrión',
  'web.review.guestProfile': 'Opiniones de anfitriones sobre {name}',
  'web.review.guestProfileEmpty': 'Todavía no tiene opiniones de anfitriones.',
  'web.review.loadError': 'No pudimos cargar las opiniones.',
  'web.review.retry': 'Reintentar',
  'web.review.link': 'Opinar sobre el viaje',
  'web.reviews.received.title': 'Opiniones sobre ti',
  'web.reviews.received.intro':
    'Aquí ves todas las opiniones publicadas sobre ti, con el nombre de pila de quien las escribió.',
  'web.reviews.received.asGuest': 'Como viajero',
  'web.reviews.received.asHost': 'Como anfitrión',
  'web.reviews.received.empty': 'Todavía no hay opiniones publicadas sobre ti.',
  'web.reviews.count': { one: '{count} opinión', other: '{count} opiniones' },
  'web.reviews.link': 'Opiniones sobre ti',
  'web.a13.title': 'Tu perfil público',
  'web.a13.preview': 'Así te ven los viajeros en tus anuncios.',
  'web.a13.reviews': 'Opiniones recibidas',
  'web.a13.link': 'Tu perfil público',
  'web.listing.hostReviews': 'Opiniones sobre {name}',
  'backoffice.overdue.heading': 'Retrasos y autos no devueltos',
  'backoffice.overdue.lead':
    'Viajes con retraso en tu cobertura, leídos en directo (la detección corre cada minuto). La escalada avanza una etapa a la vez, a la hora fijada en la configuración: contacto, intimación y luego denuncia prellenada. Los contactos del viajero y del anfitrión están en la ficha 360°.',
  'backoffice.overdue.truncated':
    'Más de 500 viajes con retraso: solo se muestran los 500 más antiguos. Atiéndelos primero y luego actualiza.',
  'backoffice.overdue.refresh': 'Actualizar',
  'backoffice.overdue.readAt': 'Leído a las {at} · cobertura: {countries}',
  'backoffice.overdue.none': 'Ningún viaje con retraso en tu cobertura.',
  'backoffice.overdue.caption': 'Viajes con retraso',
  'backoffice.overdue.tripColumn': 'Viaje',
  'backoffice.overdue.stageColumn': 'Etapa',
  'backoffice.overdue.nextColumn': 'Etapa siguiente',
  'backoffice.overdue.lateMinutes': '{m} min de retraso',
  'backoffice.overdue.lateHours': '{h} h {m} min de retraso',
  'backoffice.overdue.end': 'Fin prevista: {at}',
  'backoffice.overdue.nextTripAtRisk': 'El viaje siguiente de este auto está en riesgo.',
  'backoffice.overdue.stage.T30M': 'Retraso detectado',
  'backoffice.overdue.stage.T2H': 'Contacto hecho',
  'backoffice.overdue.stage.T6H': 'Intimación entregada',
  'backoffice.overdue.stage.T24H': 'No devuelto: denuncia entregada',
  'backoffice.overdue.stage.RESOLVED': 'Expediente cerrado',
  'backoffice.overdue.stage.none': 'Expediente en apertura',
  'backoffice.overdue.escalated': '{stage} el {at}: {documents}',
  'backoffice.overdue.document.CONTACT_SCRIPT': 'mensaje modelo para el viajero',
  'backoffice.overdue.document.DEMAND_LETTER': 'modelo de carta de intimación',
  'backoffice.overdue.document.GPS_REQUEST': 'ubicación GPS pedida al anfitrión',
  'backoffice.overdue.document.POLICE_REPORT_DRAFT':
    'denuncia prellenada que presenta el anfitrión',
  'backoffice.overdue.step.CONTACT': 'Contacto con el viajero y el anfitrión',
  'backoffice.overdue.step.FORMAL_NOTICE': 'Intimación',
  'backoffice.overdue.step.POLICE_REPORT': 'Denuncia prellenada',
  'backoffice.overdue.from': 'Posible desde {at}',
  'backoffice.overdue.prepare': 'Preparar etapa',
  'backoffice.overdue.prepareFor': 'Preparar etapa «{step}» del viaje {tripId}',
  'backoffice.overdue.paramMissing':
    'Faltan las horas de escalada configuradas: ninguna etapa es posible. Avisa a la administración.',
  'backoffice.overdue.allDone': 'Todas las etapas están hechas: seguimiento con el anfitrión.',
  'backoffice.overdue.confirmHeading': '{step} · viaje {tripId}',
  'backoffice.overdue.effect.CONTACT':
    'Llama al viajero y escríbele por WhatsApp; luego avisa al anfitrión. Al confirmar, la etapa queda en el expediente y el anfitrión recibe por correo un mensaje modelo para enviar al viajero.',
  'backoffice.overdue.effect.FORMAL_NOTICE':
    'Al confirmar, la etapa queda en el expediente y el anfitrión recibe por correo un modelo de carta de intimación para enviar a su nombre, y el pedido de anotar la ubicación GPS si su auto tiene uno.',
  'backoffice.overdue.effect.POLICE_REPORT':
    'Al confirmar, la etapa queda en el expediente y el anfitrión recibe por correo una denuncia prellenada, que él mismo presenta ante la policía.',
  'backoffice.overdue.never':
    'La plataforma no presenta ninguna denuncia, no recupera ningún auto y nunca actúa sobre él a distancia.',
  'backoffice.overdue.reasonHint':
    'Lo que se hizo: llamadas, mensajes, respuestas. Entre 10 y 1000 caracteres, queda en el registro.',
  'backoffice.overdue.reasonTooShort': 'Escribe un motivo de al menos 10 caracteres.',
  'backoffice.overdue.confirm': 'Confirmar: {step}',
  'backoffice.overdue.cancel': 'Ahora no',
  'backoffice.overdue.done':
    'Etapa registrada en el expediente. El anfitrión recibe el aviso por correo.',
  'backoffice.overdue.refused.OVERDUE_STEP_TOO_EARLY':
    'Demasiado pronto: esta etapa solo es posible desde la hora indicada.',
  'backoffice.overdue.refused.OVERDUE_STEP_OUT_OF_ORDER':
    'Esta etapa ya está hecha o no es la siguiente. La lista se actualizó.',
  'backoffice.overdue.refused.TRIP_NOT_OVERDUE':
    'Este viaje ya no tiene retraso: el auto fue devuelto o el viaje está cerrado.',
  'backoffice.overdue.refused.OVERDUE_CASE_MISSING':
    'El expediente de retraso todavía no está abierto. Vuelve a intentarlo en un minuto.',
  'backoffice.overdue.refused.PARAM_MISSING':
    'Faltan las horas de escalada configuradas: ninguna etapa es posible.',
  'backoffice.overdue.refused.SELF_FORBIDDEN':
    'Este viaje te concierne: otro agente debe ocuparse.',
  'ntf.unreturnedContact.email.subject': 'Reserva {booking_ref}: el auto no fue devuelto',
  'ntf.unreturnedContact.email.body':
    'Hola, {first_name}. El auto de la reserva {booking_ref} debía devolverse el {end_at} y todavía no fue devuelto. Nuestro equipo intenta comunicarse con el viajero por llamada y por WhatsApp. Tú también puedes escribirle desde la reserva en la app, por ejemplo: «Hola, el auto de la reserva {booking_ref} debía devolverse el {end_at}. Por favor, dime cuándo y dónde lo devuelves.» {brand} no recupera el auto y no actúa sobre él a distancia.',
  'ntf.unreturnedContact.sms.body':
    '{brand}: el auto de la reserva {booking_ref} no fue devuelto. Contactamos al viajero; detalles por correo.',
  'ntf.unreturnedFormalNotice.email.subject':
    'Reserva {booking_ref}: modelo de carta de intimación',
  'ntf.unreturnedFormalNotice.email.body':
    'Hola, {first_name}. El auto de la reserva {booking_ref} todavía no fue devuelto. Este es un modelo de carta de intimación para enviar a tu nombre al viajero, por la mensajería de la reserva o por escrito: «Yo, anfitrión que puso en alquiler el vehículo de la reserva {booking_ref} (marca, modelo y placa indicados en el contrato de alquiler), dejo constancia de que este vehículo debía serme devuelto el {end_at} y no lo fue. Le intimo a devolverlo en el lugar acordado a la brevedad. De lo contrario, me reservo el derecho de presentar una denuncia ante las autoridades competentes. Fecha y firma.» Si tu auto tiene GPS, anota su última ubicación y la hora, sin ir a buscarlo solo. {brand} no envía esta carta en tu lugar, no recupera el auto y no actúa sobre él a distancia.',
  'ntf.unreturnedFormalNotice.sms.body':
    '{brand}: modelo de carta de intimación de la reserva {booking_ref} enviado por correo. Anota la ubicación GPS si tu auto tiene uno.',
  'ntf.unreturnedPoliceReport.email.subject': 'Reserva {booking_ref}: denuncia prellenada',
  'ntf.unreturnedPoliceReport.email.body':
    'Hola, {first_name}. El auto de la reserva {booking_ref} lleva más de un día sin ser devuelto. Esta es una denuncia prellenada que puedes presentar tú mismo ante la policía o el Ministerio Público, con tu contrato de alquiler y tu documento de identidad: «Yo, anfitrión que puso en alquiler el vehículo indicado en el contrato de alquiler adjunto (marca, modelo y placa), declaro que este vehículo, alquilado con la reserva {booking_ref} en {brand}, debía serme devuelto el {end_at} y no lo fue pese a mis reclamos. La identidad del arrendatario figura en el contrato adjunto. Presento denuncia por no devolución del vehículo.» Guarda el número de la denuncia. {brand} no presenta la denuncia en tu lugar, no recupera el auto y no actúa sobre él a distancia; tu pago no queda bloqueado por este procedimiento.',
  'ntf.unreturnedPoliceReport.sms.body':
    '{brand}: denuncia prellenada de la reserva {booking_ref} enviada por correo. Tú la presentas ante la policía.',
  // US-706 (ADR-197) : frais annexes demandés par l’hôte, payés ou contestés par le voyageur
  'common.incidental.notFound': 'No encontramos este cargo.',
  'common.incidental.typeNotAllowed': 'Este tipo de gasto no se puede cobrar al viajero.',
  'common.incidental.typeNotSupported':
    'Este gasto se cobra por otra vía (atraso, peajes y multas, kilometraje). No se registró nada.',
  'common.incidental.tripNotEnded': 'Podrás pedir un gasto después de la devolución del auto.',
  'common.incidental.windowClosed': 'El plazo para pedir gastos de este viaje terminó.',
  'common.incidental.evidenceMissing':
    'Agrega una prueba: al menos una foto de la entrega o de la devolución de este viaje (combustible: el indicador a la salida y a la vuelta).',
  'common.incidental.notBillable':
    'Este gasto no se puede cobrar: mismo nivel de combustible, viaje terminado antes de tiempo o auto solo sin lavar (no hace falta lavarlo).',
  'common.incidental.fuelPrepaid':
    'El viajero compró un extra en este viaje: no se cobra combustible.',
  'common.incidental.amountAboveCap': 'El monto supera el máximo permitido para este gasto.',
  'common.incidental.duplicate': 'Ya hay una solicitud de este tipo en curso para este viaje.',
  'common.incidental.notCancellable': 'Esta solicitud ya no se puede cancelar.',
  'common.incidental.notOpen': 'Este cargo ya no espera tu respuesta.',
  'common.incidental.responseWindowClosed': 'El plazo para pagar o impugnar este cargo terminó.',
  'common.incidental.disputeReasonRequired':
    'Explica por qué no estás de acuerdo (20 caracteres como mínimo).',
  'common.incidental.unavailable':
    'Los gastos adicionales no están disponibles por ahora. No se registró nada.',
  'common.claim.incidentalNotDisputed': 'Solo se decide un cargo impugnado por el viajero.',
  'web.a04.addFee': 'Agregar un gasto con prueba',
  'web.s12.accept': 'Aceptar y pagar {amount}',
  'web.s12.contest': 'No estoy de acuerdo',
  'web.incidental.title.HOST': 'Gastos del viaje',
  'web.incidental.title.GUEST': 'Gastos pedidos por el anfitrión',
  'web.incidental.link.GUEST': 'Gastos pedidos por el anfitrión',
  'web.incidental.back': 'Volver al viaje',
  'web.incidental.lead.HOST':
    'Puedes pedir combustible, limpieza o tabaco hasta el {date}, con fotos de la entrega o de la devolución. El viajero tendrá un plazo para pagar o impugnar.',
  'web.incidental.closed.HOST': 'El plazo para pedir gastos terminó el {date}.',
  'web.incidental.notEnded.HOST': 'Podrás pedir gastos después de la devolución del auto.',
  'web.incidental.lead.GUEST':
    'Puedes pagar o impugnar cada cargo hasta la hora indicada. Sin respuesta, {brand} decide y puede cobrar la tarjeta guardada.',
  'web.incidental.empty.HOST': 'No pediste ningún gasto en este viaje.',
  'web.incidental.empty.GUEST': 'El anfitrión no pidió ningún gasto.',
  'web.incidental.list': 'Solicitudes',
  'web.incidental.fee.FUEL': 'Combustible',
  'web.incidental.fee.CLEANING': 'Limpieza',
  'web.incidental.fee.SMOKING': 'Tabaco',
  'web.incidental.status.AWAITING_GUEST': 'Respuesta del viajero hasta el {date}',
  'web.incidental.status.ACCEPTED': 'Aceptado por el viajero: cobro en curso',
  'web.incidental.status.DISPUTED': 'Impugnado: {brand} revisa las pruebas',
  'web.incidental.status.DECIDED_CHARGE': '{brand} confirmó el cargo: cobro en curso',
  'web.incidental.status.CHARGED': 'Cobro solicitado',
  'web.incidental.status.REJECTED': '{brand} rechazó el cargo',
  'web.incidental.status.CANCELLED_BY_HOST': 'Cancelado por el anfitrión',
  'web.incidental.charge.PROCESSING': 'Pago en curso',
  'web.incidental.charge.PAID': 'Pagado',
  'web.incidental.charge.UNPAID': 'Pago rechazado: queda un saldo pendiente',
  'web.incidental.evidenceCount': 'Fotos adjuntas: {count}',
  'web.incidental.reason': 'Motivo del anfitrión',
  'web.incidental.disputeReason': 'Impugnación del viajero',
  'web.incidental.decision': 'Decisión de {brand}',
  'web.incidental.cancel': 'Cancelar la solicitud',
  'web.incidental.form.type': 'Tipo de gasto',
  'web.incidental.form.amount': 'Monto ({currency})',
  'web.incidental.form.amountHint': 'Ejemplo: {example}. Hay un máximo por tipo de gasto.',
  'web.incidental.form.description': 'Motivo',
  'web.incidental.form.descriptionHint': 'De 10 a 500 caracteres, sin nombres ni teléfonos.',
  'web.incidental.form.photos': 'Fotos de prueba',
  'web.incidental.form.photosHint':
    'Elige al menos una foto de la entrega o de la devolución. Combustible: el indicador a la salida y a la vuelta. Limpieza o tabaco: una foto del interior a la vuelta.',
  'web.incidental.form.submit': 'Enviar la solicitud',
  'web.incidental.form.amountInvalid': 'Ingresa un monto válido, por ejemplo {example}.',
  'web.incidental.form.descriptionInvalid': 'El motivo debe tener de 10 a 500 caracteres.',
  'web.incidental.form.photoRequired': 'Elige al menos una foto.',
  'web.incidental.form.noPhotos':
    'Este viaje no tiene fotos de entrega ni de devolución: no se puede pedir un gasto.',
  'web.incidental.photo': '{side} · {slot} · {by}',
  'web.incidental.side.CHECKIN': 'Entrega',
  'web.incidental.side.CHECKOUT': 'Devolución',
  'web.incidental.slot.EXTERIOR': 'carrocería',
  'web.incidental.slot.INTERIOR': 'habitáculo',
  'web.incidental.slot.FUEL': 'indicador de combustible',
  'web.incidental.slot.ODOMETER': 'odómetro',
  'web.incidental.slot.KEY': 'llave',
  'web.incidental.slot.DAMAGE': 'daño',
  'web.incidental.by.HOST': 'foto del anfitrión',
  'web.incidental.by.GUEST': 'foto del viajero',
  'web.incidental.payNotice': 'Al pagar, aceptas que se cobre este monto a tu tarjeta guardada.',
  'web.incidental.dispute.reason': '¿Por qué no estás de acuerdo?',
  'web.incidental.dispute.reasonHint': 'De 20 a 1000 caracteres, sin nombres ni teléfonos.',
  'web.incidental.dispute.photos': 'Fotos que te dan la razón',
  'web.incidental.dispute.submit': 'Enviar la impugnación',
  'web.incidental.dispute.reasonInvalid': 'El motivo debe tener de 20 a 1000 caracteres.',
  'web.incidental.done.submitted': 'Solicitud enviada. El viajero recibió el aviso.',
  'web.incidental.done.accepted': 'Gracias. {brand} cobrará la tarjeta guardada.',
  'web.incidental.done.disputed':
    'Impugnación enviada. {brand} revisa las pruebas y decide; no se cobra nada antes.',
  'web.incidental.done.cancelled': 'Solicitud cancelada.',
  'web.incidental.loadError': 'No pudimos cargar esta página.',
  'web.incidental.retry': 'Reintentar',
} as const satisfies Catalog;

export type MessageKey = keyof typeof ES_MESSAGES;
