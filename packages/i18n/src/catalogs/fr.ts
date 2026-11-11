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
  'common.rateLimit.retryLater': 'Trop de demandes. Attends un instant, puis réessaie.',
  'common.rateLimit.unavailable':
    'Impossible d’envoyer le message pour le moment. Réessaie plus tard.',
  'common.rateLimit.challengeRequired': 'Montre que tu es bien une personne pour continuer.',
  'web.home.tagline': 'Loue une voiture et découvre le prix final dès le départ.',
  'web.shell.skipToContent': 'Aller au contenu',
  'web.shell.homeLink': '{brand}, page d’accueil',
  'web.shell.languageHint': 'La page se recharge dans la langue choisie.',
  'web.offline.title': 'Hors connexion',
  'web.offline.body':
    'Vérifie ton réseau ou ton wifi. Dès que la connexion revient, on recharge la page.',
  'web.offline.retry': 'Réessayer',
  'common.offline.restored': 'Tu es de nouveau en ligne.',
  'web.s01.title': 'Réserve la voiture d’un voisin.',
  'web.s01.subtitle':
    'Des voitures de vraies personnes près de toi, que tu vives ici ou que tu sois de passage.',
  'web.s01.how.title': 'Comment ça marche',
  'web.s01.how.1': 'Trouve une voiture près de toi',
  'web.s01.how.1.body':
    'Des voitures de voisins, avec de vraies photos, des prix et des avis réels.',
  'web.s01.how.2': 'Réserve auprès de son propriétaire',
  'web.s01.how.2.body':
    'Tu réserves et tu conviens avec l’hôte de l’endroit où il te remet la voiture.',
  'web.s01.how.3': 'Récupère-la et profite',
  'web.s01.how.3.body': 'Tu la récupères au point convenu et tu la rends au même endroit.',
  'web.s01.owner.title': 'Gagne de l’argent avec ta voiture',
  'web.s01.owner.body':
    'Quand tu ne t’en sers pas, ta voiture peut dépanner un voisin et te rapporter un revenu en plus.',
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
  'common.auth.forbidden':
    'Tu n’as pas le droit de faire cette action. Elle a été enregistrée au journal.',
  'common.auth.twoFactorRequired':
    'Confirme ton identité avec le code de ton application d’authentification.',
  'common.auth.totpInvalid': 'Ce code n’est pas valide. Utilise le code actuel de ton application.',
  'common.auth.totpLocked':
    'Trop de codes incorrects. Attends 15 minutes ou demande à un administrateur de réinitialiser ton accès.',
  'common.auth.mfaUnavailable':
    'La vérification en deux étapes est indisponible pour le moment. Aucun accès n’a été accordé.',
  'common.auth.actionUnavailable':
    'Cette action n’est pas encore disponible dans la console. Elle a été enregistrée au journal.',
  'common.auth.actionRecorded': 'Action enregistrée.',
  'common.auth.actionDone': 'C’est fait. La modification a été enregistrée au journal.',
  'backoffice.login.heading': 'Connexion de l’équipe',
  'backoffice.login.email': 'Adresse e-mail',
  'backoffice.login.password': 'Mot de passe',
  'backoffice.login.submit': 'Se connecter',
  'backoffice.totp.heading': 'Vérification en deux étapes',
  'backoffice.totp.intro':
    'Saisis le code à 6 chiffres affiché par ton application d’authentification.',
  'backoffice.totp.code': 'Code à 6 chiffres',
  'backoffice.totp.submit': 'Vérifier',
  'backoffice.enroll.heading': 'Active ta vérification en deux étapes',
  'backoffice.enroll.intro':
    'Un administrateur t’a remis un code d’activation. Saisis-le pour afficher la clé de ton application d’authentification.',
  'backoffice.enroll.enrollmentCode': 'Code d’activation',
  'backoffice.enroll.reveal': 'Afficher la clé',
  'backoffice.enroll.secret': 'Clé pour ton application (affichée une seule fois)',
  'backoffice.enroll.openApp': 'Ouvrir dans mon application d’authentification',
  'backoffice.enroll.confirm': 'Activer',
  'backoffice.denied.heading': 'Accès refusé',
  'backoffice.denied.notStaff': 'Ton compte n’a aucun rôle de l’équipe interne.',
  'backoffice.denied.noTotp':
    'Ton compte d’équipe n’a pas de vérification en deux étapes. Demande un code d’activation à un administrateur.',
  'backoffice.console.roles': 'Tes rôles',
  'backoffice.console.countries': 'Pays · {countries}',
  'backoffice.console.signOut': 'Se déconnecter',
  'backoffice.role.SUPPORT_AGENT': 'Assistance',
  'backoffice.role.OPS_AGENT': 'Opérations',
  'backoffice.role.FINANCE': 'Finances',
  'backoffice.role.ADMIN': 'Administrateur',
  'backoffice.role.SUPERADMIN': 'Super-administrateur',
  'backoffice.content.gaps.title': {
    one: '{count} texte publié à revoir',
    other: '{count} textes publiés à revoir',
  },
  'backoffice.content.gaps.hint':
    'En attendant, la page affiche le texte d’origine dans cette langue.',
  'backoffice.content.gaps.missing': '{key} · {scope} : manque {locales}',
  'backoffice.content.gaps.invalid': '{key} · {scope} : format non autorisé ({locales})',
  'backoffice.content.gaps.common': 'commun',
  'backoffice.content.gaps.error': 'Impossible de vérifier les textes publiés.',
  'backoffice.journal.caption': 'Journal d’activité',
  'backoffice.journal.when': 'Date et heure',
  'backoffice.journal.who': 'Auteur',
  'backoffice.journal.action': 'Opération',
  'backoffice.journal.subject': 'Objet',
  'backoffice.journal.empty': 'Aucune activité enregistrée pour l’instant.',
  'backoffice.action.heading': 'Action sur un voyage',
  'backoffice.action.subject': 'Identifiant du voyage',
  'backoffice.action.reason': 'Motif',
  'backoffice.action.reasonHint': 'Entre 10 et 1 000 caractères. Il est conservé au journal.',
  'backoffice.action.CANCEL_TRIP_PLATFORM': 'Annuler au nom de la plateforme',
  'backoffice.action.DECLARE_NO_SHOW': 'Déclarer une non-présentation',
  'backoffice.action.RECORD_CLAIM': 'Enregistrer une réclamation',
  'backoffice.error.network':
    'Impossible de joindre le serveur. Vérifie ta connexion, puis réessaie.',
  'backoffice.journal.error': 'Impossible de charger le journal d’activité.',
  'backoffice.journal.scope': 'Tu ne vois que les actions des pays de tes rôles.',
  // Gabarits de notification (US-021, NTF-001 ; catalogue réduit de la bêta). PROPOSÉS : à
  // reporter dans 10b §4.3 et à relire par l'UX. Variables nommées, identiques dans les quatre langues.
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
  'common.brand.tokensInvalid': 'Le format du thème est invalide. Vérifiez les valeurs signalées.',
  'common.brand.fontNotApproved': 'La police {font} ne figure pas dans la liste approuvée.',
  'common.brand.contrastInsufficient':
    'Non publiée : la paire {pair} n’atteint pas le contraste WCAG 2.2 AA.',
  'common.brand.versionNotFound': 'Cette version n’existe pas.',
  'common.brand.versionUnavailable':
    'Le thème publié est indisponible ; le thème par défaut s’affiche.',
  'common.brand.versionConflict': 'Cette version a déjà changé. Rechargez puis réessayez.',
  'common.brand.assetInvalid':
    'Fichier invalide : PNG, JPEG ou WebP (WOFF2 pour une police), texte alternatif en espagnol, anglais, français et portugais, et licence indiquée.',
  'common.brand.assetUnavailable':
    'Le stockage des fichiers est indisponible. Réessayez plus tard.',
  'common.brand.contentLocaleMissing':
    'Texte manquant en {locale} : un bloc est publié en espagnol, anglais, français et portugais.',
  'common.brand.contentKeyForbidden': 'Les textes juridiques ne se modifient pas ici.',
  'common.brand.contentMarkdownForbidden':
    'Le texte contient du HTML ou un lien externe. Seuls les liens internes sont permis.',
  'common.brand.contentNotFound': 'Ce bloc ou cette version n’existe pas.',
  'common.brand.contentKeyNotEditable': 'Ce texte ne se modifie pas comme un bloc.',
  // Règles photo d'US-031 (ADR-069 point 7), versées depuis
  // `packages/design-tokens/rules/photo.messages.json` sans changer clés ni textes (ADR-071) ;
  // un test de `packages/i18n` vérifie que les deux restent identiques.
  'web.photo.angle.extFront.hint':
    'De face, à trois pas environ, tout le pare-chocs dans le cadre.',
  'web.photo.angle.extFront.label': 'Avant',
  'web.photo.angle.extFront34Driver.hint':
    'Depuis l’angle avant côté conducteur\u00a0: on voit l’avant et le flanc.',
  'web.photo.angle.extFront34Driver.label': 'Avant, côté conducteur',
  'web.photo.angle.extFront34Passenger.hint':
    'Depuis l’angle avant côté passager\u00a0: on voit l’avant et le flanc.',
  'web.photo.angle.extFront34Passenger.label': 'Avant, côté passager',
  'web.photo.angle.extProfileDriver.hint':
    'Tout le flanc côté conducteur, d’une roue à l’autre, depuis le milieu.',
  'web.photo.angle.extProfileDriver.label': 'Profil côté conducteur',
  'web.photo.angle.extProfilePassenger.hint':
    'Tout le flanc côté passager, d’une roue à l’autre, depuis le milieu.',
  'web.photo.angle.extProfilePassenger.label': 'Profil côté passager',
  'web.photo.angle.extRear.hint': 'Face au coffre, tout le pare-chocs arrière dans le cadre.',
  'web.photo.angle.extRear.label': 'Arrière',
  'web.photo.angle.extRear34Driver.hint':
    'Depuis l’angle arrière côté conducteur\u00a0: on voit l’arrière et le flanc.',
  'web.photo.angle.extRear34Driver.label': 'Arrière, côté conducteur',
  'web.photo.angle.extRear34Passenger.hint':
    'Depuis l’angle arrière côté passager\u00a0: on voit l’arrière et le flanc.',
  'web.photo.angle.extRear34Passenger.label': 'Arrière, côté passager',
  'web.photo.angle.extSideDriverFront.hint': 'Portière avant, aile et rétroviseur côté conducteur.',
  'web.photo.angle.extSideDriverFront.label': 'Flanc conducteur, moitié avant',
  'web.photo.angle.extSideDriverRear.hint': 'Portière arrière et aile arrière côté conducteur.',
  'web.photo.angle.extSideDriverRear.label': 'Flanc conducteur, moitié arrière',
  'web.photo.angle.extSidePassengerFront.hint':
    'Portière avant, aile et rétroviseur côté passager.',
  'web.photo.angle.extSidePassengerFront.label': 'Flanc passager, moitié avant',
  'web.photo.angle.extSidePassengerRear.hint': 'Portière arrière et aile arrière côté passager.',
  'web.photo.angle.extSidePassengerRear.label': 'Flanc passager, moitié arrière',
  'web.photo.angle.extWheelDriverFront.hint': 'De près\u00a0: jante et pneu en entier.',
  'web.photo.angle.extWheelDriverFront.label': 'Roue avant côté conducteur',
  'web.photo.angle.extWheelDriverRear.hint': 'De près\u00a0: jante et pneu en entier.',
  'web.photo.angle.extWheelDriverRear.label': 'Roue arrière côté conducteur',
  'web.photo.angle.extWheelPassengerFront.hint': 'De près\u00a0: jante et pneu en entier.',
  'web.photo.angle.extWheelPassengerFront.label': 'Roue avant côté passager',
  'web.photo.angle.extWheelPassengerRear.hint': 'De près\u00a0: jante et pneu en entier.',
  'web.photo.angle.extWheelPassengerRear.label': 'Roue arrière côté passager',
  'web.photo.angle.extWindshieldRoof.hint':
    'Lève un peu le téléphone\u00a0: tout le pare-brise et, si possible, le toit.',
  'web.photo.angle.extWindshieldRoof.label': 'Pare-brise et toit',
  'web.photo.angle.gaugeFuel.hint':
    'Moteur allumé\u00a0: le niveau de carburant ou de batterie se lit bien.',
  'web.photo.angle.gaugeFuel.label': 'Carburant ou charge',
  'web.photo.angle.gaugeOdometer.hint':
    'Moteur allumé\u00a0: tous les chiffres du compteur se lisent.',
  'web.photo.angle.gaugeOdometer.label': 'Compteur kilométrique',
  'web.photo.angle.intCenterConsole.hint': 'Levier, écran et porte-gobelets, de près.',
  'web.photo.angle.intCenterConsole.label': 'Console centrale',
  'web.photo.angle.intDashboard.hint':
    'Depuis le milieu de la banquette\u00a0: tout le tableau de bord et le volant.',
  'web.photo.angle.intDashboard.label': 'Tableau de bord',
  'web.photo.angle.intDriverSeat.hint':
    'Portière ouverte\u00a0: siège, plancher et panneau de porte côté conducteur.',
  'web.photo.angle.intDriverSeat.label': 'Siège conducteur',
  'web.photo.angle.intFrontSeats.hint':
    'Par la portière conducteur ouverte\u00a0: les deux sièges avant.',
  'web.photo.angle.intFrontSeats.label': 'Sièges avant',
  'web.photo.angle.intHeadliner.hint':
    'Vise vers le haut depuis le siège avant\u00a0: plafond et rétroviseur intérieur.',
  'web.photo.angle.intHeadliner.label': 'Ciel de toit',
  'web.photo.angle.intPassengerSeat.hint':
    'Portière ouverte\u00a0: siège, plancher et panneau de porte côté passager.',
  'web.photo.angle.intPassengerSeat.label': 'Siège passager',
  'web.photo.angle.intRearSeats.hint':
    'Par une portière arrière ouverte\u00a0: toute la banquette.',
  'web.photo.angle.intRearSeats.label': 'Banquette arrière',
  'web.photo.angle.intRearSeatsDriver.hint':
    'Portière arrière côté conducteur ouverte\u00a0: siège, plancher et panneau.',
  'web.photo.angle.intRearSeatsDriver.label': 'Arrière, côté conducteur',
  'web.photo.angle.intRearSeatsPassenger.hint':
    'Portière arrière côté passager ouverte\u00a0: siège, plancher et panneau.',
  'web.photo.angle.intRearSeatsPassenger.label': 'Arrière, côté passager',
  'web.photo.angle.intTrunk.hint': 'Coffre ouvert et vide, plancher visible.',
  'web.photo.angle.intTrunk.label': 'Coffre',
  'web.photo.check.blurry': 'La photo est floue. Tiens bien ton téléphone et reprends-la.',
  'web.photo.check.galleryForbidden':
    'Pour la remise, prends la photo maintenant avec l’appareil photo de l’appli.',
  'web.photo.check.personVisible':
    'Une personne apparaît sur la photo. Reprends-la sans personne dans le cadre.',
  'web.photo.check.plateVisible': 'La plaque est lisible. Nous la flouterons avant la publication.',
  'web.photo.check.portrait': 'Tourne ton téléphone à l’horizontale pour cette photo.',
  'web.photo.check.tooDark': 'La photo est trop sombre. Trouve plus de lumière et reprends-la.',
  'web.photo.check.tooSmall':
    'La photo est trop petite. Utilise l’appareil photo principal du téléphone.',
  'web.photo.handover.both':
    'L’hôte et le voyageur prennent chacun leur série. L’une ne remplace pas l’autre.',
  'web.photo.handover.camera':
    'Utilise l’appareil photo de l’appli. Les photos de la galerie ne sont pas acceptées.',
  'web.photo.handover.count':
    'Prends {exterior} photos extérieures, {interior} intérieures, plus le carburant et le compteur.',
  'web.photo.handover.plate':
    'Ici, la plaque peut se voir\u00a0: ces photos servent de preuve et ne sont jamais publiées.',
  'web.photo.handover.title': 'Photos de remise',
  'web.photo.listing.count':
    'Ajoute au moins {min} photos. Avec {recommended}, on voit toute la voiture.',
  'web.photo.listing.cover':
    'C’est la photo de couverture\u00a0: la première que voient les voyageurs.',
  'web.photo.listing.title': 'Photos de ta voiture',
  'web.photo.rule.forbidden.aiGenerated':
    'Les images créées ou modifiées par intelligence artificielle sont refusées.',
  'web.photo.rule.forbidden.contact':
    'Ni numéro, ni QR code, ni lien\u00a0: tout passe par les messages de {brand}.',
  'web.photo.rule.forbidden.documents':
    'Ne photographie ni document ni écran affichant des données personnelles.',
  'web.photo.rule.forbidden.offensive':
    'Rien d’indécent, de violent ni de blessant pour une personne ou un groupe.',
  'web.photo.rule.forbidden.overlay': 'Ni texte, ni logo, ni cadre, ni filigrane sur la photo.',
  'web.photo.rule.forbidden.people': 'Aucune personne sur la photo, même dans un reflet.',
  'web.photo.rule.forbidden.plate':
    'Si la plaque est lisible, nous la floutons avant de publier la photo.',
  'web.photo.rule.forbidden.stock':
    'Seulement des photos de ta voiture, jamais d’internet ni d’un catalogue.',
  'web.photo.rule.forbidden.unsafe':
    'La voiture ne doit pas apparaître sur une dépanneuse, accidentée ni dans un lieu dangereux.',
  'web.photo.rule.framing.background': 'Choisis un fond dégagé, sans autre voiture ni personne.',
  'web.photo.rule.framing.clean':
    'Lave la voiture et retire tes objets personnels avant les photos.',
  'web.photo.rule.framing.fill': 'La voiture occupe presque toute la largeur, sans être coupée.',
  'web.photo.rule.framing.height': 'Pour l’extérieur, place le téléphone à hauteur des phares.',
  'web.photo.rule.framing.level': 'Tiens ton téléphone à l’horizontale, l’horizon bien droit.',
  'web.photo.rule.framing.safeArea':
    'Laisse de l’air autour de la voiture\u00a0: la couverture est un peu rognée en haut et en bas.',
  'web.photo.rule.light.backlight': 'Garde le soleil dans ton dos, pas derrière la voiture.',
  'web.photo.rule.light.daylight':
    'Photographie de jour, en lumière douce\u00a0: matin, fin d’après-midi ou ciel couvert.',
  'web.photo.rule.light.night':
    'De nuit, seulement pour la remise\u00a0: allume une lumière et approche-toi de chaque dégât.',
  'web.photo.rule.light.noFilter':
    'Ni filtre ni retouche\u00a0: la photo montre la voiture telle qu’elle est.',
  'web.photo.rule.light.reflections':
    'Décale-toi si tu vois ton reflet sur la carrosserie ou les vitres.',
  'web.photo.slot.damage': 'Dégât {number}',
  'web.photo.slot.key': 'Clé',
} as const satisfies Readonly<Record<MessageKey, Message>>;
