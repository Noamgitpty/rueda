import type { MessageKey } from './es.ts';
import type { Message } from './types.ts';

/**
 * Catalogue français (DEC-FONDATEUR-17), aligné clé pour clé sur `es.ts` (qui fait foi). Le
 * `satisfies` fait échouer `pnpm typecheck` si une clé manque ou est en trop.
 *
 * Registre : **tutoiement** dans l'interface, comme Turo en France (journal
 * `docs/team/COMME_TURO.md`, PROPOSÉ) ; le **vouvoiement** est réservé au contrat et aux textes
 * juridiques, comme « usted » en espagnol (UX-12). Typographie française : espace insécable
 * (U+00A0) avant « : », « ; », « ? » et « ! », apostrophe typographique « ’ ».
 *
 * Pluriels (CLDR du français) : `one` couvre 0 et 1 (« 0 jour », « 1 jour »), `other` le reste ;
 * la catégorie `many` (1 000 000) se replie sur `other`.
 */
export const FR_MESSAGES = {
  'common.locale.switchLabel': 'Langue',
  'common.locale.current': 'Langue actuelle\u00a0: {language}',
  'common.price.finalForDays': {
    one: 'Prix final · {count} jour',
    other: 'Prix final · {count} jours',
  },
  'common.auth.sessionRequired': 'Ta session est terminée. Reconnecte-toi.',
  'common.auth.invalidCredentials': 'E-mail ou mot de passe incorrect.',
  'common.auth.emailInvalid': 'Saisis une adresse e-mail valide.',
  'common.auth.passwordWeak': 'Le mot de passe doit comporter au moins {min} caractères.',
  'common.auth.termsNotAccepted':
    'Tu dois accepter les Conditions et la Politique de confidentialité pour continuer.',
  'common.auth.linkExpired': 'Ce lien n’est plus valide. Demandes-en un nouveau.',
  'common.auth.rateLimited': 'Trop de tentatives. Attends quelques minutes, puis réessaie.',
  'common.auth.requestInvalid': 'Vérifie les informations saisies.',
  'common.auth.signupAccepted': 'Consulte tes e-mails pour continuer.',
  'common.auth.emailVerified': 'Ton adresse e-mail est confirmée.',
  'web.home.tagline': 'Loue une voiture et découvre le prix final dès le départ.',
  'backoffice.meta.title': '{brand} — back-office',
  'backoffice.meta.description': 'Console interne.',
  'backoffice.home.heading': '{brand} — back-office',
  'backoffice.home.intro': 'Console interne de l’équipe.',
  'common.offline.banner': 'Hors connexion. Voici les dernières informations enregistrées.',
  'common.error.server':
    'Un problème est survenu de notre côté. Rien de ce que tu as saisi n’a été perdu. Réessaie ; si le problème continue, écris-nous sur WhatsApp avec le code {code}.',
  'common.price.perDay': '{amount} par jour',
  'common.price.details': 'Détail du prix',
  'common.price.total': 'Total',
  'common.ui.loading': 'Chargement…',
  'common.ui.optional': '(facultatif)',
  'common.ui.errorSummary.title': {
    one: 'Vérifie {count} champ',
    other: 'Vérifie {count} champs',
  },
  'common.ui.error.code': 'Code : {code}',
  'common.ui.rating.label': 'Note : {rating} sur 5',
  'common.ui.rating.trips': { one: '{count} voyage', other: '{count} voyages' },
  'common.ui.distance': 'À {distance} km',
  'common.ui.car.save': 'Enregistrer {car}',
  'common.ui.steps.progress': 'Étape {current} sur {total}',
  'common.ui.steps.done': 'terminée',
  'common.ui.host.since': 'Membre depuis {year}',
  'common.ui.host.responseRate': 'Taux de réponse : {rate} %',
  'common.ui.host.responseTime': {
    one: 'Répond en général sous {count} heure',
    other: 'Répond en général sous {count} heures',
  },
  'common.ui.photo.take': 'Prendre la photo : {angle}',
  'common.ui.photo.retake': 'Reprendre la photo : {angle}',
  'common.ui.photo.empty': 'Pas encore de photo',
  'common.ui.photo.saved': 'Enregistrée sur ce téléphone',
  'common.ui.photo.uploading': 'Envoi en cours…',
  'common.ui.photo.uploaded': 'Envoyée',
  'common.ui.photo.failed': 'Pas encore envoyée. Nous réessaierons.',
  'web.common.save': 'Enregistrer',
  'web.s01.owner.cta': 'Publie ta voiture',
  'web.s02.new': 'Nouveau',
  'web.s02.empty': 'Aucune voiture n’est disponible à ces dates.',
  'web.s03.cta': 'Réserver',
  'web.s03.host.titleMasc': 'Ton hôte',
  'web.s03.host.titleFem': 'Ton hôtesse',
  'web.s03.host.titleNeutral': 'Qui te loue la voiture',
  'web.host.guest.verified': 'Identité vérifiée',
  'web.s03.deposit.title': 'Dépôt de garantie',
  'web.deposit.amount': 'Montant',
  'web.deposit.holder':
    'Il est bloqué sur ta carte par {merchant_name} ; {host_name} ne l’encaisse jamais.',
  'web.deposit.how.preauth': 'C’est un blocage temporaire sur ta carte, pas un débit.',
  'web.deposit.how.chargeRefund': 'Il est débité au début et remboursé à la fin.',
  'web.deposit.covers':
    'Il couvre seulement ces frais du voyage : carburant manquant, retard au retour, kilomètres en plus, nettoyage, tabac ou animaux, et péages.',
  'web.deposit.notCovers': 'Les dommages ne sont jamais prélevés sur ce dépôt.',
  'web.deposit.releaseBy': 'Il est libéré au plus tard le {date}.',
  'web.deposit.contest': 'Vérifier et répondre',
  'web.deposit.debitWarning':
    'Le dépôt est débité puis remboursé. Nous émettrons le remboursement le {date} ; ta banque peut mettre de 3 à 10 jours ouvrés à l’afficher.',
  'web.catalog.title': 'Bibliothèque de composants',
  'web.catalog.intro':
    'Chaque composant dans ses états. Choisis la langue, le thème et la largeur pour les passer en revue.',
  'web.catalog.controls.theme': 'Thème',
  'web.catalog.controls.auto': 'Automatique',
  'web.catalog.controls.light': 'Clair',
  'web.catalog.controls.dark': 'Sombre',
  'web.catalog.controls.width': 'Largeur',
  'web.catalog.controls.mobile': 'Mobile, 360 px',
  'web.catalog.controls.full': 'Pleine largeur',
  'web.catalog.state.normal': 'Normal',
  'web.catalog.state.empty': 'Vide',
  'web.catalog.state.loading': 'En chargement',
  'web.catalog.state.error': 'Erreur',
  'web.catalog.state.disabled': 'Désactivé',
  'web.catalog.section.buttons': 'Boutons',
  'web.catalog.section.fields': 'Champs de formulaire',
  'web.catalog.section.badges': 'Pastilles, notes et avatars',
  'web.catalog.section.price': 'Prix final',
  'web.catalog.section.carCard': 'Carte de voiture',
  'web.catalog.section.host': 'Bloc de l’hôte',
  'web.catalog.section.deposit': 'Bloc du dépôt',
  'web.catalog.section.banners': 'Bandeaux',
  'web.catalog.section.steps': 'Étapes',
  'web.catalog.section.photo': 'Capture photo',
  'web.catalog.section.table': 'Tableaux de la console',
  'web.catalog.sample.emailLabel': 'Adresse e-mail',
  'web.catalog.sample.emailHint': 'Nous t’enverrons ici la confirmation de ta réservation.',
  'web.catalog.sample.nameLabel': 'Prénom',
  'web.catalog.sample.terms': 'J’accepte les Conditions et la Politique de confidentialité.',
  'web.catalog.sample.step.dates': 'Dates',
  'web.catalog.sample.step.identity': 'Identité',
  'web.catalog.sample.step.payment': 'Paiement',
  'web.catalog.sample.step.confirmation': 'Confirmation',
  'web.catalog.sample.line.rent': {
    one: 'Location · {count} jour',
    other: 'Location · {count} jours',
  },
  'web.catalog.sample.line.tripFee': 'Frais de voyage',
  'web.catalog.sample.line.protection': 'Protection de base',
  'web.catalog.sample.line.tax': 'Taxes',
  'web.catalog.sample.table.caption': 'Prochaines remises',
  'web.catalog.sample.table.trip': 'Voyage',
  'web.catalog.sample.table.dates': 'Dates',
  'web.catalog.sample.table.status': 'Statut',
  'web.catalog.sample.table.earnings': 'Ton revenu',
  'web.catalog.sample.table.confirmed': 'Confirmée',
  'web.catalog.sample.table.pending': 'En attente',
  'web.catalog.sample.table.empty': 'Aucune remise pour l’instant.',
  'web.catalog.sample.photo.front': 'Avant',
  'web.catalog.sample.photo.rear': 'Arrière',
  'web.catalog.sample.photo.driverSide': 'Côté conducteur',
  'web.catalog.sample.photo.passengerSide': 'Côté passager',
  'web.catalog.sample.photo.dashboard': 'Tableau de bord',
  'web.catalog.sample.hostQuote': 'Je remets la voiture propre et avec le plein.',
  'web.catalog.sample.retry': 'Réessayer',
  // Gabarits de notification (US-021, NTF-001 ; catalogue réduit de la bêta). PROPOSÉS : à
  // reporter dans 10b §4.3 et à relire par l'UX. Variables nommées, identiques dans les trois langues.
  'ntf.kycApproved.email.subject': 'Ton identité est vérifiée · {brand}',
  'ntf.kycApproved.email.body':
    'Bonjour {first_name}. Nous avons vérifié ton identité : tu peux maintenant réserver des voitures sur {brand}.',
  'ntf.kycApproved.sms.body':
    '{brand} : {first_name}, ton identité est vérifiée. Tu peux maintenant réserver.',
  'ntf.bookingConfirmed.email.subject': 'Réservation {booking_ref} confirmée',
  'ntf.bookingConfirmed.email.body':
    'Bonjour {first_name}. Ta réservation {booking_ref} est confirmée : du {start_at} au {end_at}. Dans l’appli, tu trouves le lieu de remise, le contrat et les messages de la réservation.',
  'ntf.bookingConfirmed.sms.body':
    '{brand} : réservation {booking_ref} confirmée, du {start_at} au {end_at}. Détails dans l’appli.',
  'ntf.bookingCancelled.email.subject': 'Réservation {booking_ref} annulée',
  'ntf.bookingCancelled.email.body':
    'Bonjour {first_name}. La réservation {booking_ref} a été annulée. Dans l’appli, tu vois le détail et, le cas échéant, ton remboursement.',
  'ntf.bookingCancelled.sms.body':
    '{brand} : la réservation {booking_ref} a été annulée. Détails dans l’appli.',
  'ntf.tripOverdue.email.subject': 'Réservation {booking_ref} : retour en retard',
  'ntf.tripOverdue.email.body':
    'Bonjour {first_name}. La voiture de la réservation {booking_ref} devait être rendue le {end_at} et le retour n’est pas encore enregistré. Écris à l’autre partie depuis les messages de la réservation.',
  'ntf.tripOverdue.sms.body':
    '{brand} : retour en retard pour la réservation {booking_ref}, prévu le {end_at}. Écris depuis les messages de l’appli.',
  'ntf.payoutSent.email.subject': 'Nous t’avons envoyé {amount}',
  'ntf.payoutSent.email.body':
    'Bonjour {first_name}. Nous avons envoyé ton versement de {amount}. Ta banque peut mettre un peu de temps à le créditer. Le détail est dans tes gains.',
  'ntf.payoutSent.sms.body':
    '{brand} : nous t’avons envoyé un versement de {amount}. Détail dans tes gains.',
  'ntf.payoutOnHold.email.subject': 'Ton versement de {amount} est retenu',
  'ntf.payoutOnHold.email.body':
    'Bonjour {first_name}. Ton versement de {amount} est retenu pour l’instant. Tes gains indiquent la raison et la marche à suivre.',
  'ntf.payoutOnHold.sms.body':
    '{brand} : ton versement de {amount} est retenu. Raison dans tes gains.',
} as const satisfies Readonly<Record<MessageKey, Message>>;
