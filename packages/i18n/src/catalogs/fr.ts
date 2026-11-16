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
  'backoffice.content.gaps.notEditable':
    '{key} · {scope} : cette clé n’est pas un texte modifiable ; elle n’est jamais affichée.',
  'backoffice.content.gaps.common': 'commun',
  'backoffice.content.gaps.error': 'Impossible de vérifier les textes publiés.',
  'backoffice.o02.open': 'Apparence et marque',
  'backoffice.o02.title': 'Apparence et marque',
  'backoffice.o02.intro':
    "Changez le nom, le logo, les couleurs, les polices et les textes de l'accueil. Le site ne change pas tant que vous ne publiez pas.",
  'backoffice.o02.back': 'Retour à la console',
  'backoffice.o02.denied':
    'Cet écran est réservé aux administrateurs dont la session est vérifiée. Ouvrez la console et connectez-vous avec votre code.',
  'backoffice.o02.noVersion':
    "Aucune version n'est encore publiée : le site utilise le thème par défaut (Lienzo · Tinta).",
  'backoffice.o02.loadError': "Impossible de charger l'historique des versions. Rechargez la page.",
  'backoffice.o02.history.title': 'Historique des versions',
  'backoffice.o02.history.version': 'Version {no} · {name}',
  'backoffice.o02.history.publish': 'Publier la version {no}',
  'backoffice.o02.status.DRAFT': 'Brouillon',
  'backoffice.o02.status.PUBLISHED': 'Publiée',
  'backoffice.o02.status.ARCHIVED': 'Archivée',
  'backoffice.o02.rollback.action': 'Revenir à la version précédente',
  'backoffice.o02.rollback.hint':
    "Rétablit en un clic la version publiée avant l'actuelle. L'action est inscrite au journal.",
  'backoffice.o02.rollback.done':
    'Version précédente rétablie (version {no}). Le site l’affiche en moins d’une minute.',
  'backoffice.o02.publish.done': 'Version {no} publiée. Le site l’affiche en moins d’une minute.',
  'backoffice.o02.publish.refused':
    "Publication refusée : ces paires de couleurs n'atteignent pas le contraste minimal (WCAG 2.2 AA).",
  'backoffice.o02.contrast.pair': '{pair}, mode {mode} : {ratio}:1 (minimum {min}:1)',
  'backoffice.o02.contrast.ok':
    'Contraste AA : toutes les paires de couleurs passent. Ce brouillon peut être publié.',
  'backoffice.o02.contrast.failing': {
    one: "{count} paire de couleurs n'atteint pas le contraste : la publication sera refusée.",
    other:
      "{count} paires de couleurs n'atteignent pas le contraste : la publication sera refusée.",
  },
  'backoffice.o02.mode.light': 'clair',
  'backoffice.o02.mode.dark': 'sombre',
  'backoffice.o02.draft.title': 'Nouveau brouillon',
  'backoffice.o02.draft.base': 'Point de départ',
  'backoffice.o02.draft.fromVersion': 'Version {no} · {name}',
  'backoffice.o02.draft.fromPalette': 'Palette {palette}',
  'backoffice.o02.draft.fromPaletteFailing':
    'Palette {palette} (contraste insuffisant : corrigez les couleurs avant de publier)',
  'backoffice.o02.draft.brandName': 'Nom de la marque',
  'backoffice.o02.draft.colors': 'Couleurs, mode {mode}',
  'backoffice.o02.draft.invalid': "Ce brouillon n'est pas valide : corrigez les champs signalés.",
  'backoffice.o02.draft.save': 'Enregistrer le brouillon',
  'backoffice.o02.draft.saved':
    "Brouillon enregistré (version {no}). Vérifiez-le dans l'aperçu et publiez-le depuis l'historique.",
  'backoffice.o02.color.primary': "Couleur d'action",
  'backoffice.o02.color.onPrimary': "Texte sur la couleur d'action",
  'backoffice.o02.color.accent': 'Accent',
  'backoffice.o02.color.onAccent': "Texte sur l'accent",
  'backoffice.o02.color.surface': 'Fond de page',
  'backoffice.o02.color.surfaceRaised': 'Fond des cartes',
  'backoffice.o02.color.text': 'Texte',
  'backoffice.o02.color.textMuted': 'Texte secondaire',
  'backoffice.o02.color.hint': 'Format #RRGGBB : six chiffres hexadécimaux.',
  'backoffice.o02.color.invalid': 'Saisissez une couleur au format #RRGGBB.',
  'backoffice.o02.font.heading': 'Police des titres',
  'backoffice.o02.font.body': 'Police du texte',
  'backoffice.o02.font.keep': 'Celle du point de départ',
  'backoffice.o02.font.hint': 'Uniquement les polices de la liste approuvée (licence vérifiée).',
  'backoffice.o02.logo.light': 'Logo (fichier SVG)',
  'backoffice.o02.logo.dark': 'Logo pour le mode sombre (fichier SVG)',
  'backoffice.o02.logo.hint':
    'SVG simple, de 20 000 caractères au plus, sans script, lien ni ressource externe. Sans fichier, le logo du point de départ est conservé.',
  'backoffice.o02.logo.invalid':
    'Logo refusé : il doit être un SVG simple, sans script, lien ni ressource externe.',
  'backoffice.o02.preview.title': 'Aperçu',
  'backoffice.o02.preview.hint':
    'Voici le site avec ce brouillon. Le site public ne change pas tant que vous ne publiez pas.',
  'backoffice.o02.preview.options': "Options de l'aperçu",
  'backoffice.o02.preview.light': 'Clair',
  'backoffice.o02.preview.dark': 'Sombre',
  'backoffice.o02.preview.mobile': 'Mobile',
  'backoffice.o02.preview.desktop': 'Ordinateur',
  'backoffice.o02.preview.unavailable':
    "Aperçu indisponible : le thème du brouillon n'est pas valide.",
  'backoffice.o02.preview.s01': 'Accueil',
  'backoffice.o02.preview.s03': 'Fiche de la voiture',
  'backoffice.o02.preview.s05': 'Paiement',
  'backoffice.o02.preview.a02': "Espace de l'hôte",
  'backoffice.o02.preview.email': 'E-mail',
  'backoffice.o02.sample.where': 'Où voulez-vous prendre la voiture ?',
  'backoffice.o02.sample.search': 'Chercher une voiture',
  'backoffice.o02.sample.car': "Voiture d'exemple · 2020",
  'backoffice.o02.sample.host': 'Ana',
  'backoffice.o02.sample.guest': 'Luis',
  'backoffice.o02.sample.verified': 'Identité vérifiée',
  'backoffice.o02.sample.checkout': 'Confirmez et payez',
  'backoffice.o02.sample.plan1': 'Protection de base',
  'backoffice.o02.sample.plan2': 'Protection standard',
  'backoffice.o02.sample.plan3': 'Protection complète',
  'backoffice.o02.sample.checkoutNote': "L'hôte vous remet la voiture au lieu convenu.",
  'backoffice.o02.sample.pay': 'Confirmer et payer',
  'backoffice.o02.sample.greeting': 'Bonjour, Ana',
  'backoffice.o02.sample.confirmed': 'Confirmée',
  'backoffice.o02.sample.pending': 'À approuver',
  'backoffice.o02.sample.late': 'En retard',
  'backoffice.o02.sample.nextTrip': 'Prochaine remise : demain',
  'backoffice.o02.sample.addCar': 'Ajouter une voiture',
  'backoffice.o02.sample.mailTitle': 'Votre réservation est confirmée',
  'backoffice.o02.sample.mailBody':
    'Ana vous attend au lieu convenu. Consultez les détails de votre location.',
  'backoffice.o02.sample.mailCta': 'Voir ma réservation',
  'backoffice.o02.sample.mailFooter':
    'Vous recevez cet e-mail parce que vous avez réservé une voiture.',
  'backoffice.o02.assets.title': 'Images de la marque',
  'backoffice.o02.assets.hint':
    "PNG, JPEG ou WebP de 64 Ko au plus. Chaque image passe par l'antivirus avant d'être enregistrée ; si l'antivirus est indisponible, elle est refusée.",
  'backoffice.o02.assets.kind': "Type d'image",
  'backoffice.o02.assets.kind.LOGO': 'Logo',
  'backoffice.o02.assets.kind.FAVICON': "Icône d'onglet",
  'backoffice.o02.assets.kind.PWA_ICON': "Icône de l'application",
  'backoffice.o02.assets.kind.HERO_IMAGE': "Image de l'accueil",
  'backoffice.o02.assets.file': 'Fichier',
  'backoffice.o02.assets.alt': 'Texte alternatif en {language}',
  'backoffice.o02.assets.license': "Origine et licence de l'image",
  'backoffice.o02.assets.upload': "Envoyer l'image",
  'backoffice.o02.assets.done': "Image reçue et analysée par l'antivirus.",
  'backoffice.o02.assets.empty': 'Choisissez un fichier.',
  'backoffice.o02.assets.tooBig': "L'image dépasse {max} Ko.",
  'backoffice.o02.assets.badType': 'Seules les images PNG, JPEG ou WebP sont acceptées.',
  'backoffice.o02.content.title': "Textes de l'accueil",
  'backoffice.o02.content.key': 'Texte à modifier',
  'backoffice.o02.content.body': 'Texte en {language}',
  'backoffice.o02.content.hintPlain':
    'Une seule ligne, {max} caractères au plus, dans les quatre langues.',
  'backoffice.o02.content.hintRich':
    'Paragraphes, listes, **gras**, *italique* et liens internes ; {max} caractères au plus, dans les quatre langues.',
  'backoffice.o02.content.publish': 'Enregistrer et publier',
  'backoffice.o02.content.rollback': 'Revenir au texte précédent',
  'backoffice.o02.content.published':
    'Texte publié dans les quatre langues (version {no}). Le site l’affiche en moins d’une minute.',
  'backoffice.o02.content.rolledBack': 'Texte précédent rétabli.',
  'backoffice.o02.content.refused': "Rien n'a été enregistré :",
  'backoffice.o02.content.legal':
    'Modification impossible ici : le mot « {word} » désigne un texte juridique (conditions, contrat, confidentialité, assurance…). Les textes juridiques sont des gabarits versionnés, hors de cet écran.',
  'backoffice.o02.content.zwj':
    'Texte en {language} : il contient un caractère de liaison invisible (ZWJ). Les émojis composés, comme les familles, une personne et son métier ou certains drapeaux, ne sont pas acceptés, car ce caractère peut déguiser un texte. Utilisez un émoji simple.',
  'backoffice.o02.content.blank':
    'Texte en {language} : il est vide ou ne contient que des espaces.',
  'backoffice.o02.content.tooLong': 'Texte en {language} : il dépasse {max} caractères.',
  'backoffice.o02.content.format':
    'Texte en {language} : format non autorisé (ni HTML, ni lien externe, ni caractère invisible ; une seule ligne pour les textes simples).',
  'backoffice.journal.caption': 'Journal d’activité',
  'backoffice.journal.when': 'Date et heure',
  'backoffice.journal.who': 'Auteur',
  'backoffice.journal.action': 'Opération',
  'backoffice.journal.subject': 'Objet',
  'backoffice.journal.empty': 'Aucune activité enregistrée pour l’instant.',
  'backoffice.action.heading': 'Action de console',
  'backoffice.action.subject': 'Identifiant de l’objet (voyage, compte, dossier…)',
  'backoffice.action.reason': 'Motif',
  'backoffice.action.reasonHint': 'Entre 10 et 1 000 caractères. Il est conservé au journal.',
  'backoffice.action.CANCEL_TRIP_PLATFORM': 'Annuler au nom de la plateforme',
  'backoffice.action.DECLARE_NO_SHOW': 'Déclarer une non-présentation',
  'backoffice.action.RECORD_CLAIM': 'Enregistrer une réclamation',
  // Cadre des actions de console (US-101), PROPOSÉS
  'common.auth.actionRequested':
    'Demande enregistrée. Une autre personne de l’équipe doit l’approuver.',
  'common.auth.actionRefused':
    'L’action a été refusée : l’état actuel ne la permet pas. Elle a été enregistrée au journal.',
  'common.auth.selfApproval':
    'Tu ne peux pas approuver ta propre demande. Une autre personne doit le faire.',
  'backoffice.action.evidence': 'Pièces justificatives (identifiants)',
  'backoffice.action.evidenceHint':
    'Obligatoires pour un enregistrement : identifiants des fichiers reçus, séparés par des virgules (20 au plus).',
  'backoffice.action.groupState': 'Changer un état',
  'backoffice.action.groupRecord': 'Enregistrer seulement (avec pièces)',
  'backoffice.action.groupFinance': 'Décisions financières (deux personnes)',
  'backoffice.action.amountNote': 'Tu ne saisis jamais de montant : la plateforme le calcule.',
  'backoffice.action.CANCEL_TRIP_GUEST': 'Annuler à la demande du voyageur',
  'backoffice.action.CANCEL_TRIP_HOST': 'Annuler à la demande de l’hôte',
  'backoffice.action.REFUSE_AT_PICKUP': 'Refuser à la remise',
  'backoffice.action.KYC_DECISION': 'Décider une vérification d’identité',
  'backoffice.action.HOST_VERIFICATION_DECISION': 'Décider la vérification d’un hôte',
  'backoffice.action.PUBLISH_LISTING': 'Publier l’annonce',
  'backoffice.action.ESCALATE_OVERDUE': 'Escalader un retard de retour',
  'backoffice.action.REVIEW_FLAGGED_BOOKING': 'Examiner une réservation signalée',
  'backoffice.action.ISSUE_DECISION': 'Enregistrer une décision',
  'backoffice.action.RECORD_CHARGEBACK': 'Enregistrer une rétrofacturation',
  'backoffice.action.OPEN_INCIDENT': 'Ouvrir un incident',
  'backoffice.action.RECORD_REVIEW': 'Enregistrer un avis reçu par e-mail',
  'backoffice.action.HANDLE_DSR': 'Traiter une demande sur les données personnelles',
  'backoffice.action.ISSUE_BORDEREAU': 'Demander l’émission du bordereau',
  'backoffice.action.DECIDE_ADVANCE': 'Demander la décision d’une avance',
  'backoffice.action.WRITE_OFF_RECEIVABLE': 'Demander le passage en perte d’une créance',
  // Compte d'hôte d'une personne physique (US-107), PROPOSÉS
  'common.host.accountOpened':
    'Ton compte d’hôte est ouvert. Termine la vérification pour publier ta voiture.',
  'common.host.accountExists': 'Tu as déjà un compte d’hôte ici.',
  'common.host.entityNotAllowed':
    'Seuls les particuliers peuvent être hôtes. Nous n’acceptons ni sociétés ni agences.',
  'common.host.underAge': 'Tu n’as pas encore l’âge minimum pour être hôte.',
  'common.host.notEligible':
    'Confirme ton adresse e-mail et vérifie l’état de ton compte avant de devenir hôte.',
  'common.host.unavailable':
    'Impossible d’ouvrir un compte d’hôte pour le moment. Réessaie plus tard.',
  // Téléphone par OTP (US-104, 16 VER-013 ; PROPOSÉ, common.error.phoneDigits : 10b §4.3)
  'common.otp.sent': 'Nous t’avons envoyé un code par SMS.',
  'common.otp.verified': 'C’est fait : ton téléphone est vérifié.',
  'common.otp.alreadyVerified': 'Ce numéro est déjà vérifié sur ton compte.',
  'common.otp.invalid': 'Ce code n’est pas le bon. Essais restants : {attempts}.',
  'common.otp.expired': 'Ce code a expiré. Demandes-en un nouveau.',
  'common.otp.locked': 'Trop d’essais. Réessaie dans {minutes} min.',
  'common.otp.duplicatePhone':
    'Ce numéro est déjà vérifié sur un autre compte. Utilise un autre numéro ou écris-nous.',
  'common.otp.notEligible': 'Confirme ton adresse e-mail avant de vérifier ton téléphone.',
  'common.otp.phoneRequired': 'Vérifie ton téléphone pour continuer.',
  'common.otp.unavailable': 'Impossible d’envoyer un code pour le moment. Réessaie plus tard.',
  'common.otp.sms':
    '{brand} : ton code est {code}. Il expire dans {minutes} min. Ne le partage avec personne.',
  'common.error.phoneDigits': 'Le numéro doit comporter {digits} chiffres, par exemple {example}.',
  'backoffice.action.CREATE_HOST_ACCOUNT': 'Créer le compte d’hôte d’une personne',
  // Files de revue, fiche 360°, notes, dossiers, pièces et restrictions (US-109), PROPOSÉS
  'common.ops.caseRequired':
    'Pour consulter ou annoter cette fiche, ouvre un dossier ou prends un élément de file qui la couvre.',
  'common.ops.selfForbidden':
    'Tu ne peux pas traiter un dossier qui te concerne (ton compte, ta voiture ou un compte lié). Une autre personne de l’équipe doit s’en charger.',
  'common.ops.itemTaken': 'Une autre personne de l’équipe a déjà pris cet élément.',
  'common.bookingReview.notBooking':
    'Cet élément n’est pas une réservation signalée. Ouvre-le depuis la fiche 360°.',
  'common.ops.userNotFound': 'Personne avec cette adresse e-mail dans ta portée.',
  'common.evidence.rejected':
    'Fichier refusé : seuls les JPEG, PNG, HEIC ou PDF sains, de taille limitée.',
  'common.evidence.unavailable':
    'Impossible de recevoir des fichiers pour le moment. Rien n’a été enregistré.',
  'backoffice.action.RESTRICT_ACCOUNT': 'Restreindre le compte',
  'backoffice.action.LIFT_RESTRICTION': 'Lever la restriction',
  'backoffice.queues.current': 'File affichée',
  'common.evidence.tooLarge': 'Fichier trop lourd : {max} Kio au plus.',
  'common.evidence.badType': 'Format refusé : JPEG, PNG, HEIC ou PDF seulement.',
  'common.evidence.scanRefused': 'L’analyse antivirus a refusé le fichier.',
  'backoffice.queues.heading': 'Files de revue',
  'backoffice.queues.summary': '{total} ouverts · {late} en retard',
  'backoffice.queues.show': 'Afficher la file',
  'backoffice.queues.caption': 'Éléments de la file',
  'backoffice.queues.subject': 'Objet',
  'backoffice.queues.due': 'Échéance',
  'backoffice.queues.state': 'Attribution',
  'backoffice.queues.actions': 'Gestes',
  'backoffice.queues.overdue': 'En retard',
  'backoffice.queues.onTime': 'Dans les délais',
  'backoffice.queues.unassigned': 'Non attribué',
  'backoffice.queues.mine': 'À toi',
  'backoffice.queues.taken': 'Pris par une autre personne',
  'backoffice.queues.claim': 'Prendre',
  'backoffice.queues.openKyc': 'Ouvrir le dossier KYC',
  'backoffice.queues.empty': 'Aucun élément ouvert.',
  'backoffice.queues.error': 'Lecture des files impossible.',
  'backoffice.queue.KYC': 'Identité',
  'backoffice.queue.LISTING': 'Annonces',
  'backoffice.queue.HOST_VERIFICATION': 'Vérification des hôtes',
  'backoffice.queue.RISK_BOOKING': 'Réservations signalées',
  'backoffice.queue.CATALOG_ADDITION': 'Ajouts au catalogue',
  'backoffice.queue.OVERDUE': 'Retours en retard',
  'backoffice.queue.GRAY_MARKET': 'Contournement de la plateforme',
  'backoffice.queue.LEG_RECONCILIATION': 'Rapprochement des jambes',
  'backoffice.kyc.heading': 'Dossier KYC',
  'backoffice.kyc.logged': 'Cette consultation est inscrite au journal d’accès.',
  'backoffice.kyc.birthDate': 'Date de naissance',
  'backoffice.kyc.residence': 'Résidence déclarée',
  'backoffice.kyc.unknown': 'Non renseigné',
  'backoffice.kyc.NOT_STARTED': 'Vérification non commencée',
  'backoffice.kyc.PHONE_VERIFIED': 'Téléphone vérifié',
  'backoffice.kyc.DOCS_SUBMITTED': 'Pièces envoyées',
  'backoffice.kyc.AUTO_CHECKS': 'Contrôles automatiques',
  'backoffice.kyc.MANUAL_REVIEW': 'En revue manuelle',
  'backoffice.kyc.MORE_INFO_REQUIRED': 'Nouvelle pièce demandée',
  'backoffice.kyc.APPROVED': 'Approuvée',
  'backoffice.kyc.RECHECK': 'À revérifier',
  'backoffice.kyc.EXPIRED': 'Expirée',
  'backoffice.kyc.REVOKED': 'Retirée',
  'backoffice.kyc.REJECTED': 'Refusée',
  'backoffice.kyc.APPEAL': 'En appel',
  'backoffice.kyc.REJECTED_FINAL': 'Refus définitif',
  'backoffice.kyc.BANNED': 'Exclue',
  'backoffice.kyc.reason': 'Motif',
  'backoffice.kyc.reason.PROVIDER_REVIEW': 'Le fournisseur demande une revue',
  'backoffice.kyc.reason.PROVIDER_DECLINED': 'Refusé par le fournisseur',
  'backoffice.kyc.reason.DOCUMENT_MISSING': 'Champs du permis absents',
  'backoffice.kyc.reason.DOCUMENT_NOT_LICENSE': 'La pièce n’est pas un permis de conduire',
  'backoffice.kyc.reason.LICENSE_PROVISIONAL': 'Permis provisoire ou non confirmé',
  'backoffice.kyc.reason.LICENSE_EXPIRED': 'Permis expiré',
  'backoffice.kyc.reason.CONSENT_WITHDRAWN': 'Consentement biométrique retiré',
  'backoffice.kyc.reason.LIVENESS_FAILED': 'Preuve de vie ou selfie non concluants',
  'backoffice.kyc.reason.ID_DOCUMENT_REFUSED': 'Pièce d’identité refusée',
  'backoffice.kyc.reason.LICENSE_NOT_ACCEPTED': 'Permis hors de la liste acceptée',
  'backoffice.kyc.reason.DUPLICATE_ACCOUNT': 'Compte en double ou lié',
  'backoffice.kyc.reason.MORE_INFO_REQUESTED': 'Nouvelle pièce demandée par l’ops',
  'backoffice.kyc.reason.LEGAL_NAME_MISMATCH': 'Nom du compte différent de celui du permis',
  'backoffice.kyc.reason.LEGAL_NAME_MISSING': 'Nom du titulaire absent ou illisible sur le permis',
  'backoffice.kyc.reason.LEGAL_NAME_CHANGED': 'Nom légal modifié après l’approbation',
  'backoffice.kyc.attempt': 'Tentative et pays du dossier',
  'backoffice.kyc.consentMissing':
    'Consentement biométrique absent ou périmé : aucune approbation possible.',
  'backoffice.kyc.document': 'Permis rendu par le fournisseur',
  'backoffice.kyc.noDocument': 'Aucun champ de permis reçu.',
  'backoffice.kyc.documentType': 'Nature de la pièce',
  'backoffice.kyc.issuingCountry': 'Pays de délivrance',
  'backoffice.kyc.expiresOn': 'Échéance',
  'backoffice.kyc.licenseClass': 'Catégorie',
  'backoffice.kyc.permanent': 'Permis définitif',
  'backoffice.kyc.holderName': 'Nom sur le permis',
  'backoffice.kyc.nameMatch': 'Nom du compte et nom du permis',
  'backoffice.kyc.nameMatch.MATCH': 'Concordants',
  'backoffice.kyc.nameMatch.MISMATCH': 'Différents : à comparer',
  'backoffice.kyc.nameMatch.MISSING': 'Le nom du permis n’a pas été lu',
  'backoffice.kyc.yes': 'Oui',
  'backoffice.kyc.no': 'Non',
  'backoffice.kyc.biometrics': 'Scores biométriques (lecture journalisée)',
  'backoffice.kyc.noScores': 'Aucun score conservé (effacé ou non reçu).',
  'backoffice.kyc.livenessScore': 'Preuve de vie',
  'backoffice.kyc.faceMatchScore': 'Ressemblance du visage',
  'backoffice.kyc.percent': '{value} %',
  'backoffice.kyc.doc.DRIVER_LICENSE': 'Permis de conduire',
  'backoffice.kyc.doc.NATIONAL_ID': 'Carte d’identité nationale',
  'backoffice.kyc.doc.FOREIGN_RESIDENT_ID': 'Carte de résident étranger',
  'backoffice.kyc.doc.PASSPORT': 'Passeport',
  'backoffice.kyc.doc.IDP': 'Permis international (IDP)',
  'backoffice.kyc.decisionHeading': 'Décision KYC',
  'backoffice.kyc.decisionHint':
    'Cocher chaque contrôle fait dans le portail du fournisseur. Approuver seulement si les quatre sont réussis et si le permis est définitif ; refuser si au moins un a échoué.',
  'backoffice.kyc.check.livenessCheck': 'Selfie et preuve de vie',
  'backoffice.kyc.check.idDocumentCheck': 'Pièce d’identité selon le statut',
  'backoffice.kyc.check.licenseListCheck': 'Permis dans la liste acceptée',
  'backoffice.kyc.check.duplicateCheck': 'Aucun compte en double ni lié',
  'backoffice.kyc.passed': 'Réussi',
  'backoffice.kyc.failed': 'Échoué',
  'backoffice.kyc.reasonHint':
    'Entre 10 et 1 000 caractères, conservé au journal avec l’auteur et les contrôles cochés. Jamais visible de la personne.',
  'backoffice.kyc.decide.APPROVED': 'Approuver',
  'backoffice.kyc.decide.REJECTED': 'Refuser',
  'backoffice.kyc.decide.MORE_INFO_REQUIRED': 'Demander une nouvelle pièce',
  'backoffice.kyc.decided': 'Décision enregistrée au journal ; l’élément de la file est clos.',
  'backoffice.queues.openHost': 'Ouvrir le dossier de l’hôte',
  'backoffice.host.heading': 'Dossier de l’hôte',
  'backoffice.host.intro':
    'Revue par exception : un dossier complet et sans signal est approuvé automatiquement à la fin du délai de revue. Les motifs de signal, s’il y en a, figurent ci-dessous.',
  'backoffice.host.status': 'État du dossier',
  'backoffice.host.status.NOT_SUBMITTED': 'Non soumis',
  'backoffice.host.status.OPEN': 'Ouvert',
  'backoffice.host.status.DOCS_PENDING': 'Incomplet',
  'backoffice.host.status.IN_REVIEW': 'En revue',
  'backoffice.host.status.APPROVED': 'Approuvé',
  'backoffice.host.status.REJECTED': 'Refusé',
  'backoffice.host.status.REVOKED': 'Révoqué',
  'backoffice.host.hold':
    'Retenue de sanctions : correspondance possible à revoir par un ADMIN. L’hôte n’en est jamais informé.',
  'backoffice.host.reviewReasons': 'Motif de la revue',
  'backoffice.host.reason.SCREENING_HOLD': 'Correspondance sur une liste de sanctions',
  'backoffice.host.reason.ACCOUNT_RESTRICTED':
    'Compte restreint, fermé ou sous une restriction active',
  'backoffice.host.reason.COUNTRY_REVIEW':
    'La configuration impose une revue par l’équipe des opérations',
  'backoffice.host.noReason': 'Aucun signal',
  'backoffice.host.checklist': 'Liste de contrôle',
  'backoffice.host.item.IDENTITY': 'Identité vérifiée',
  'backoffice.host.item.AGE': 'Âge minimal',
  'backoffice.host.item.RESIDENCE': 'Résidence',
  'backoffice.host.item.SANCTIONS': 'Listes de sanctions',
  'backoffice.host.item.TAX_PROFILE': 'Profil fiscal',
  'backoffice.host.item.HOST_TERMS': 'Conditions de l’hôte acceptées',
  'backoffice.host.item.PAYOUT_ACCOUNT': 'Compte de versement chez le prestataire',
  'backoffice.host.item.PSP_CAPABILITIES': 'Capacités du prestataire de paiement',
  'backoffice.host.item.COUNTRY_OPEN': 'Marché ouvert aux hôtes particuliers',
  'backoffice.host.item.INSURER_CONTRACT': 'Contrat de l’assureur actif',
  'backoffice.host.state.OK': 'Rempli',
  'backoffice.host.state.MISSING': 'Manquant',
  'backoffice.host.state.BLOCKED': 'Bloqué',
  'backoffice.host.state.HELD': 'Retenu',
  'backoffice.host.screening': 'Filtrage des sanctions',
  'backoffice.host.source': 'Source',
  'backoffice.host.source.OPS_MANUAL': 'Consultation manuelle par l’équipe des opérations',
  'backoffice.host.source.MANUAL': 'Revue par un ADMIN',
  'backoffice.host.screenedAt': 'Date du filtrage',
  'backoffice.host.result': 'Résultat',
  'backoffice.host.result.CLEAR': 'Aucune correspondance',
  'backoffice.host.result.POTENTIAL_MATCH': 'Correspondance possible',
  'backoffice.host.result.CONFIRMED_MATCH': 'Correspondance confirmée',
  'backoffice.host.noScreening': 'Aucun filtrage enregistré pour l’instant.',
  'backoffice.host.evidence': {
    one: '{count} pièce jointe au filtrage',
    other: '{count} pièces jointes au filtrage',
  },
  'backoffice.host.subject': 'Identifiant du compte d’hôte',
  'backoffice.host.screeningHeading': 'Filtrage manuel des sanctions',
  'backoffice.host.screeningHint':
    'Consultez chaque liste, puis indiquez son résultat. Une correspondance passe à un ADMIN ; l’hôte n’en est jamais informé.',
  'backoffice.host.list.unList': 'Liste consolidée des Nations unies',
  'backoffice.host.list.ofacList': 'Liste OFAC',
  'backoffice.host.list.nationalList': 'Liste nationale du compte',
  'backoffice.host.clear': 'Aucune correspondance',
  'backoffice.host.match': 'Correspondance possible',
  'backoffice.host.record': 'Enregistrer le filtrage',
  'backoffice.booking.open': 'Ouvrir la réservation',
  'backoffice.booking.heading': 'Réservation signalée',
  'backoffice.booking.introBefore':
    'Revue avant le débit : le voyageur ne paie rien avant ta décision.',
  'backoffice.booking.introAfter': 'Revue après le paiement : le voyage est peut-être déjà payé.',
  'backoffice.booking.status': 'État de la réservation',
  'backoffice.booking.expires': 'Échéance',
  'backoffice.booking.period': 'Période du voyage',
  'backoffice.booking.score': 'Score de risque',
  'backoffice.booking.signals': 'Signaux',
  'backoffice.booking.signal.ACCOUNT_AGE': 'Compte créé il y a moins de 24 h',
  'backoffice.booking.signal.START_SOON': 'Départ dans moins de 3 h',
  'backoffice.booking.signal.PREMIUM': 'Véhicule Premium',
  'backoffice.booking.signal.LUXE': 'Véhicule de luxe',
  'backoffice.booking.signal.ENTRY_NOT_DECLARED': 'Permis étranger, entrée non déclarée',
  'backoffice.booking.signal.RESIDENT_FOREIGN_LICENSE': 'Résident avec un permis étranger',
  'backoffice.booking.signal.BEYOND_90_DAYS': 'Fin du voyage plus de 90 jours après l’entrée',
  'backoffice.booking.entry': 'Entrée déclarée',
  'backoffice.booking.entryNone': 'Aucune déclaration',
  'backoffice.booking.entryTourist': 'Touriste, entré le {date}',
  'backoffice.booking.entryResident': 'Résident',
  'backoffice.booking.decisionHeading': 'Décision',
  'backoffice.booking.decisionHint':
    'Approuver donne au voyageur {minutes} min pour payer ; il n’est pas encore prévenu automatiquement. Refuser libère les dates sans aucun débit.',
  'backoffice.booking.decision': 'Ta décision',
  'backoffice.booking.approve': 'Approuver la réservation',
  'backoffice.booking.reject': 'Refuser la réservation',
  'backoffice.booking.record': 'Enregistrer la décision',
  'backoffice.booking.approved':
    'Réservation approuvée. Le voyageur a {minutes} min pour payer et n’est pas encore prévenu automatiquement : préviens-le.',
  'backoffice.booking.rejected':
    'Réservation refusée. Les dates sont libres, sans débit. Le voyageur n’est pas encore prévenu automatiquement.',
  'backoffice.booking.hold.ACTIVE': 'En revue',
  'backoffice.booking.hold.ACTIVE_OPEN': 'Active',
  'backoffice.booking.hold.PAYMENT_IN_FLIGHT': 'Paiement en cours',
  'backoffice.booking.hold.CONVERTED': 'Payée',
  'backoffice.booking.hold.EXPIRED': 'Échue',
  'backoffice.booking.hold.RELEASED': 'Libérée',
  'backoffice.booking.hold.COMPENSATED': 'Compensée',
  'backoffice.booking.refusal.alreadyDecided': 'Cette réservation a déjà une décision.',
  'backoffice.booking.refusal.bookingUnavailable':
    'La période de cette réservation est introuvable. Préviens un administrateur.',
  'backoffice.booking.refusal.paramMissing':
    'Un réglage du pays pour le délai de paiement manque. Préviens un administrateur.',
  'backoffice.booking.refusal.notFound': 'Cette évaluation n’est pas une réservation en revue.',
  'backoffice.booking.refusal.notClaimed': 'Prends l’élément dans la file avant de décider.',
  'backoffice.booking.refusal.notLive': 'Cette réservation n’est plus active.',
  'backoffice.booking.refusal.expired':
    'Le délai de revue est passé : refuse-la maintenant. Sinon elle sera libérée d’elle-même dans la minute, sans débit.',
  'backoffice.booking.refusal.startPassed':
    'Le voyage a déjà commencé. Tu peux seulement refuser la réservation.',
  'backoffice.booking.refusal.ineligible':
    'Le voyageur ne passe plus les contrôles. Tu peux seulement refuser la réservation.',
  'backoffice.booking.refusal.paymentInFlight':
    'Un paiement est en cours. Réessaie dans quelques minutes.',
  'backoffice.booking.refusal.cancellationUnavailable':
    'Le voyage est déjà payé. Son annulation remboursée n’est pas encore possible ici.',
  'backoffice.host.recorded': 'Filtrage enregistré.',
  'backoffice.host.refused.HOST_ALREADY_SCREENED': 'Ce dossier a déjà un filtrage enregistré.',
  'backoffice.host.refused.HOST_VERIFICATION_NOT_READY':
    'L’hôte n’a pas encore soumis son dossier.',
  'backoffice.host.refused.SELF_FORBIDDEN': 'Vous ne pouvez pas filtrer votre propre compte.',
  'backoffice.dsr.hint':
    'Enregistrez chaque étape d’une demande reçue par un dossier de support\u00a0: le délai légal est suivi et un retard est signalé.',
  'backoffice.dsr.subject': 'Identifiant du dossier de support',
  'backoffice.dsr.kind': 'Type de demande',
  'backoffice.dsr.kind.ACCESS': 'Accès',
  'backoffice.dsr.kind.RECTIFICATION': 'Rectification',
  'backoffice.dsr.kind.DELETION': 'Effacement',
  'backoffice.dsr.kind.OPPOSITION': 'Opposition',
  'backoffice.dsr.kind.PORTABILITY': 'Portabilité',
  'backoffice.dsr.step': 'Étape',
  'backoffice.dsr.step.RECEIVED': 'Reçue',
  'backoffice.dsr.step.VERIFYING': 'Vérification de l’identité',
  'backoffice.dsr.step.IN_PROGRESS': 'En cours (identité vérifiée)',
  'backoffice.dsr.step.BLOCKED_LEGAL_HOLD': 'Suspendue par une obligation légale de conservation',
  'backoffice.dsr.step.DONE': 'Répondue',
  'backoffice.dsr.step.REJECTED': 'Refusée',
  'backoffice.dsr.record': 'Enregistrer l’étape',
  'backoffice.dsr.recorded': 'Étape enregistrée\u00a0; le délai court jusqu’à la réponse.',
  'backoffice.dsr.refused.DSR_INPUT_REQUIRED': 'Indiquez le type de demande et l’étape.',
  'backoffice.dsr.refused.DSR_NOT_OPEN':
    'Ce dossier n’a pas encore de demande\u00a0: enregistrez d’abord l’étape «\u00a0Reçue\u00a0».',
  'backoffice.dsr.refused.DSR_ALREADY_OPEN': 'Ce dossier a déjà une demande ouverte.',
  'backoffice.dsr.refused.DSR_KIND_MISMATCH':
    'Le type ne correspond pas à celui de la demande ouverte sur ce dossier.',
  'backoffice.dsr.refused.DSR_TRANSITION_INVALID':
    'Cette étape ne peut pas suivre l’étape actuelle de la demande.',
  'backoffice.dsr.refused.DSR_DELAY_UNKNOWN':
    'Le délai de réponse de ce pays n’est pas configuré\u00a0: rien n’a été enregistré.',
  'backoffice.review.hint':
    'Enregistre un avis reçu par e-mail sur un voyage terminé, dans la fenêtre de notation qui suit sa fin. Joins l’e-mail en pièce.',
  'backoffice.review.subject': 'Identifiant du voyage',
  'backoffice.review.author': 'Auteur de l’avis',
  'backoffice.review.author.GUEST': 'Le voyageur (avis sur l’hôte et la voiture)',
  'backoffice.review.author.HOST': 'L’hôte (avis sur le voyageur)',
  'backoffice.review.overall': 'Note globale',
  'backoffice.review.overall.ONE': '1 étoile',
  'backoffice.review.overall.TWO': '2 étoiles',
  'backoffice.review.overall.THREE': '3 étoiles',
  'backoffice.review.overall.FOUR': '4 étoiles',
  'backoffice.review.overall.FIVE': '5 étoiles',
  'backoffice.review.record': 'Enregistrer l’avis',
  'backoffice.review.recorded': 'Avis enregistré et rattaché au voyage.',
  'backoffice.review.refused.REVIEW_INPUT_REQUIRED': 'Indique l’auteur de l’avis et la note.',
  'backoffice.review.refused.REVIEW_TRIP_NOT_COMPLETED':
    'Ce voyage n’est pas encore terminé\u00a0: rien n’a été enregistré.',
  'backoffice.review.refused.REVIEW_WINDOW_CLOSED':
    'La fenêtre de notation de ce voyage est close\u00a0: rien n’a été enregistré.',
  'backoffice.review.refused.REVIEW_WINDOW_UNKNOWN':
    'La fenêtre de notation de ce pays n’est pas configurée\u00a0: rien n’a été enregistré.',
  'backoffice.review.refused.REVIEW_AUTHOR_UNKNOWN':
    'L’auteur de cet avis est introuvable\u00a0: rien n’a été enregistré.',
  'backoffice.review.refused.REVIEW_ALREADY_RECORDED':
    'Cette personne a déjà noté ce voyage\u00a0: rien n’a été enregistré.',
  'backoffice.kyc.refused.CHECKS_REQUIRED':
    'Décision refusée : les quatre contrôles doivent être cochés.',
  'backoffice.kyc.refused.CHECKS_INCONSISTENT':
    'Décision refusée : une approbation exige quatre contrôles réussis, un refus au moins un contrôle échoué.',
  'backoffice.kyc.refused.ITEM_NOT_CLAIMED':
    'Décision refusée : prendre d’abord l’élément dans la file KYC.',
  'backoffice.kyc.refused.NOT_IN_REVIEW':
    'Décision refusée : le dossier n’est plus en revue (déjà décidé ou consentement retiré).',
  'backoffice.kyc.refused.SELF_FORBIDDEN':
    'Décision refusée : personne ne décide sa propre vérification.',
  'backoffice.kyc.refused.CONSENT_WITHDRAWN':
    'Approbation refusée : le consentement biométrique en vigueur manque.',
  'backoffice.kyc.refused.LICENSE_NOT_ACCEPTED':
    'Approbation refusée : seul un permis de conduire définitif et valable est accepté (un IDP seul ou un permis provisoire ne l’est pas).',
  'backoffice.kyc.refused.PRODUCTION_BLOCKED':
    'Décision indisponible : la vérification d’identité est fermée dans cet environnement.',
  'backoffice.profile.heading': 'Fiche 360°',
  'backoffice.profile.intro':
    'Chaque consultation est journalisée avec son motif. Le support et l’ops ont besoin d’un dossier ou d’un élément de file attribué.',
  'backoffice.profile.email': 'E-mail de la personne',
  'backoffice.profile.userId': 'Identifiant de la personne',
  'backoffice.profile.purpose': 'Motif de la consultation',
  'backoffice.profile.purposeHint': 'De 10 à 500 caractères ; inscrit au journal d’accès.',
  'backoffice.profile.search': 'Rechercher',
  'backoffice.profile.open': 'Ouvrir la fiche',
  'backoffice.profile.identity': 'Identité et contact',
  'backoffice.profile.verified': 'vérifié',
  'backoffice.profile.notVerified': 'non vérifié',
  'backoffice.profile.accountStatus': 'État du compte : {status}',
  'backoffice.profile.kycStatus': 'Vérification d’identité',
  'backoffice.profile.restricted':
    'Compte restreint : aucune réservation, et ses voitures sont fermées à la réservation.',
  'backoffice.profile.restrictions': 'Limitations du compte',
  'backoffice.profile.kind': 'Nature',
  'backoffice.profile.reason': 'Motif',
  'backoffice.profile.since': 'Depuis',
  'backoffice.profile.active': 'Active',
  'backoffice.profile.lifted': 'Levée',
  'backoffice.profile.noRestriction': 'Aucune restriction.',
  'backoffice.restriction.TS_HOLD': 'Blocage de sécurité',
  'backoffice.restriction.POLICY_VIOLATION': 'Manquement aux règles',
  'backoffice.restriction.UNPAID_BALANCE': 'Solde impayé',
  'backoffice.restriction.CHARGEBACK': 'Rétrofacturation',
  'backoffice.restriction.PAYMENT_PLAN_ACTIVE': 'Échéancier en cours',
  'backoffice.restriction.KYC_REVOKED': 'Vérification retirée',
  'backoffice.profile.restrictKind': 'Nature de la restriction',
  'backoffice.profile.hostAccounts': 'Comptes d’hôte',
  'backoffice.profile.bookable': 'Réservable',
  'backoffice.profile.closed': 'Fermé à la réservation',
  'backoffice.profile.noHost': 'Pas hôte.',
  'backoffice.profile.trips': 'Voyages comme voyageur',
  'backoffice.profile.noTrip': 'Aucun voyage.',
  'backoffice.profile.cases': 'Dossiers de support',
  'backoffice.profile.noCase': 'Aucun dossier.',
  'backoffice.profile.notes': 'Notes internes',
  'backoffice.profile.noNote': 'Aucune note.',
  'backoffice.profile.note': 'Note interne (jamais visible de la personne)',
  'backoffice.profile.addNote': 'Ajouter la note',
  'backoffice.profile.noteAdded': 'Note ajoutée.',
  'backoffice.case.heading': 'Ouvrir un dossier pour cette personne',
  'backoffice.case.category': 'Catégorie',
  'backoffice.case.channel': 'Canal de contact',
  'backoffice.case.open': 'Ouvrir le dossier',
  'backoffice.case.resolve': 'Marquer résolu',
  'backoffice.case.opened': 'Dossier ouvert et attribué à toi.',
  'backoffice.case.status.OPEN': 'Ouvert',
  'backoffice.case.status.PENDING': 'En attente',
  'backoffice.case.status.RESOLVED': 'Résolu',
  'backoffice.case.status.CLOSED': 'Clos',
  'backoffice.case.category.TRIP': 'Voyage',
  'backoffice.case.category.PAYMENT': 'Paiement',
  'backoffice.case.category.ACCOUNT': 'Compte',
  'backoffice.case.category.LISTING': 'Annonce',
  'backoffice.case.category.CLAIM': 'Dommage',
  'backoffice.case.category.SAFETY': 'Sécurité',
  'backoffice.case.category.OTHER': 'Autre',
  'backoffice.case.channel.WHATSAPP': 'Message WhatsApp',
  'backoffice.case.channel.EMAIL': 'Courriel',
  'backoffice.case.channel.PHONE': 'Téléphone',
  'backoffice.case.channel.IN_APP': 'Dans l’application',
  'backoffice.evidence.heading': 'Ajouter une pièce',
  'backoffice.evidence.file': 'Fichier JPEG, PNG, HEIC ou PDF (64 Kio au plus)',
  'backoffice.evidence.upload': 'Téléverser la pièce',
  'backoffice.evidence.received': 'Pièce reçue : {id}. Utilise-la dans une action de console.',
  'backoffice.approvals.caption': 'Demandes financières à approuver',
  'backoffice.approvals.hint': 'Une demande est approuvée par une autre personne que son auteur.',
  'backoffice.approvals.request': 'Demande',
  'backoffice.approvals.country': 'Pays',
  'backoffice.approvals.reason': 'Motif indiqué',
  'backoffice.approvals.requestedAt': 'Demandée le',
  'backoffice.approvals.approve': 'Approuver',
  'backoffice.approvals.empty': 'Aucune demande en attente.',
  'backoffice.approvals.error': 'Impossible de charger les demandes financières.',
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
  // US-102 : inscription (S15), consentements versionnés et e-mails d'identité
  'common.auth.emailVerification.subject': 'Confirme ton adresse e-mail sur {brand}',
  'common.auth.emailVerification.body':
    'Bonjour\u00a0: confirme ton adresse e-mail pour activer ton compte {brand}.\n\n{link}\n\nLe lien expire bientôt. Si tu n’as pas créé ce compte, ignore ce message.',
  'common.auth.accountExists.subject': 'Ton compte {brand}',
  'common.auth.accountExists.body':
    'Quelqu’un a voulu créer un compte {brand} avec cette adresse. Si c’était toi, tu as déjà un compte\u00a0: connecte-toi.\n\n{link}\n\nSinon, ignore ce message.',
  'common.legal.current': 'Tes documents sont à jour.',
  'common.legal.reacceptRequired':
    'Nous avons mis à jour les Conditions. Accepte-les pour continuer à réserver.',
  'common.legal.versionChanged': 'Les documents ont changé pendant ta lecture. Relis-les.',
  'common.legal.unavailable':
    'Impossible d’afficher les documents pour le moment. Réessaie plus tard.',
  'common.legal.countryUnknown':
    'Cette destination n’est pas encore disponible. Choisis-en une autre.',
  'common.legal.notFound': 'Nous ne trouvons pas ce document.',
  'common.legal.consentRecorded': 'C’est fait, ta préférence est enregistrée.',
  'web.s15.legalName': 'Prénom et nom comme sur ton permis',
  'web.s15.signup': 'Créer un compte',
  'web.s15.title': 'Crée ton compte pour réserver',
  'web.s15.intro': 'On ne te demande un compte qu’au moment de réserver.',
  'web.s15.email': 'Adresse e-mail',
  'web.s15.password': 'Mot de passe',
  'web.s15.passwordHint': 'Au moins 10 caractères.',
  'web.s15.terms': 'J’accepte les Conditions et la Politique de confidentialité',
  'web.s15.marketing': 'Je veux recevoir des nouveautés et des offres (facultatif)',
  'web.s15.login': 'J’ai déjà un compte',
  'web.s15.firstName': 'Prénom comme sur ton permis',
  'web.s15.lastName': 'Nom comme sur ton permis',
  'web.s15.readTerms': 'Lire les Conditions',
  'web.s15.readPrivacy': 'Lire la Politique de confidentialité',
  'web.s15.sent.title': 'Consulte ta boîte mail',
  'web.s15.sent.body':
    'Si l’adresse est correcte, nous t’avons envoyé un lien pour confirmer ton compte. Ouvre-le pour continuer.',
  'web.s15.sent.spam': 'Tu ne le vois pas\u00a0? Regarde dans tes courriers indésirables.',
  'web.s15.loginTitle': 'Connecte-toi',
  'web.s15.loginSubmit': 'Se connecter',
  'web.s15.createAccount': 'Créer un nouveau compte',
  'web.s15.verifyTitle': 'Confirme ton adresse e-mail',
  'web.s15.verifyCta': 'Confirmer mon adresse',
  'web.s15.loggedIn': 'Tu es connecté. Tu peux continuer.',
  'web.s15.reaccept.title': 'Nous avons mis à jour nos documents',
  'web.s15.reaccept.intro': 'Avant ta prochaine réservation, lis et accepte la nouvelle version.',
  'web.s15.reaccept.cta': 'Accepter et continuer',
  'web.legal.draft': 'BROUILLON — à valider par le juridique',
  // Étape OTP de S15 (US-104) : clés du prototype US-033 devenues officielles, puis PROPOSÉES
  'web.s15.phone': 'Téléphone',
  'web.s15.code': 'Code à 6 chiffres',
  'web.s15.verify': 'Vérifier',
  'web.s15.codeSent': 'Code envoyé au {phone}',
  'web.s15.resendIn': {
    one: 'Renvoyer dans {count} seconde',
    other: 'Renvoyer dans {count} secondes',
  },
  'web.s15.phoneTitle': 'Vérifie ton téléphone',
  'web.s15.phoneIntro':
    'Il sert à organiser la remise de la voiture. Nous ne le montrons jamais à l’hôte.',
  'web.s15.phoneCountry': 'Indicatif du pays',
  'web.s15.phoneHint': 'Par exemple {example}',
  'web.s15.sendCode': 'Envoyer le code',
  'web.s15.resend': 'Envoyer un nouveau code',
  'web.s15.changePhone': 'Utiliser un autre numéro',
  'web.s15.phoneVerified': 'Téléphone vérifié : {phone}',
  'web.s15.codeHint': 'Il arrive par SMS. Tu peux le coller.',
  'web.legal.version': 'Révision {version}',
  'web.legal.back': 'Retour au formulaire',
  'web.legal.validFrom': 'En vigueur depuis le {date}',
  'web.legal.translation': 'Traduction : le texte espagnol fait foi.',
  'web.legal.backHost': 'Retour à ton espace d’hôte',
  // US-113 : catalogue de référence des véhicules (16 HST-050), libellés partagés web / console
  // US-115 : écrans A10 (espace de l'hôte) et S03 (fiche publique d'une annonce)
  'web.host.title': 'Mettre ta voiture en location',
  'web.host.intro': 'Ton lieu de remise, ta voiture et son prix. Nous enregistrons ton avancée.',
  'web.host.loginRequired': 'Connecte-toi pour mettre ta voiture en location.',
  'web.host.login': 'Se connecter',
  'web.host.noAccount': 'Tu n’as pas encore de compte d’hôte',
  'web.host.noAccount.body':
    'Ouvre-le depuis ton profil pour mettre ta première voiture en location.',
  'web.host.error': 'Impossible de charger tes voitures. Vérifie ta connexion et réessaie.',
  'web.host.retry': 'Réessayer',
  'web.host.loading': 'Chargement de tes voitures…',
  'web.host.saved': 'Enregistré',
  'web.host.empty': 'Tu n’as encore publié aucune voiture',
  'web.host.empty.body': 'Nous te guidons pas à pas et enregistrons ton avancée.',
  'web.host.places.title': 'Lieux de remise',
  'web.host.places.empty': 'Ajoute le lieu où tu remets la voiture.',
  'web.host.place.kind': 'Type de lieu',
  'web.host.place.kind.HOME': 'Chez moi',
  'web.host.place.kind.POI': 'Lieu public',
  'web.host.place.kind.AIRPORT': 'Aéroport',
  'web.host.place.label': 'Nom du lieu (toi seul le vois)',
  'web.host.place.address': 'Adresse exacte',
  'web.host.place.city': 'Ville',
  'web.host.place.area': 'Quartier ou zone, sans rue ni numéro (le voyageur le voit)',
  'web.host.place.privacy': 'L’adresse exacte n’apparaît qu’après la réservation.',
  'web.host.place.add': 'Enregistrer le lieu',
  'web.host.cars.title': 'Tes voitures',
  'web.host.cars.needPlace': 'Ajoute d’abord un lieu de remise.',
  'web.host.car.plate': 'Plaque d’immatriculation',
  'web.host.car.vin': 'Numéro de châssis (VIN)',
  'web.host.car.vinHint':
    'VIN de 17 caractères (ex. : 1HGCM82633A004352) ou numéro de châssis d’une voiture importée (ex. : GRJ150-0012345).',
  'web.host.car.make': 'Marque',
  'web.host.car.model': 'Modèle',
  'web.host.car.year': 'Année',
  'web.host.car.seats': 'Places',
  'web.host.car.place': 'Lieu de remise',
  'web.host.car.transmission': 'Boîte de vitesses',
  'web.host.car.transmission.MANUAL': 'Manuelle',
  'web.host.car.transmission.AUTOMATIC': 'Automatique',
  'web.host.car.fuel': 'Carburant',
  'web.host.car.fuel.GASOLINE': 'Essence',
  'web.host.car.fuel.DIESEL': 'Diesel',
  'web.host.car.fuel.HYBRID': 'Hybride',
  'web.host.car.fuel.EV': 'Électrique',
  'web.host.car.add': 'Enregistrer la voiture',
  'web.host.listings.title': 'Tes annonces',
  'web.host.listings.needCar': 'Ajoute d’abord une voiture.',
  'web.host.listing.car': 'Voiture',
  'web.host.listing.price': 'Prix par jour ({currency})',
  'web.host.listing.km': 'Kilomètres inclus par jour (vide : illimité)',
  'web.host.listing.extraKm': 'Prix du kilomètre supplémentaire ({currency})',
  'web.host.listing.create': 'Créer le brouillon',
  'web.host.listing.photos': { one: '{count} photo', other: '{count} photos' },
  'web.host.listing.savePrice': 'Enregistrer le prix',
  'web.host.listing.photo': 'Photo de la voiture (JPEG, PNG ou WebP)',
  'web.host.listing.addPhoto': 'Ajouter la photo',
  'web.host.listing.submit': 'Publier l’annonce',
  'web.host.listing.delete': 'Supprimer le brouillon',
  'web.host.listing.unlist': 'Retirer l’annonce',
  'web.host.listing.relist': 'Republier',
  'web.host.account.market': 'Compte : {country} · prix en {currency}',
  'web.host.account.switch': 'Tes comptes d’hôte',
  'web.host.listing.photo.hint': 'Jusqu’à {max} par photo.',
  'web.host.listing.photo.closed':
    'Nous ne recevons pas encore de photos : tu pourras bientôt les ajouter. Ton brouillon est enregistré.',
  'web.host.listing.deleteListing': 'Supprimer l’annonce',
  'web.host.listing.deleteConfirm': 'Oui, supprimer cette annonce. C’est définitif.',
  'web.host.listing.view': 'Voir la fiche publique',
  'web.host.listing.unlimited': 'Kilométrage illimité',
  'web.host.listing.kmPerDay': { one: '{count} km par jour', other: '{count} km par jour' },
  'web.host.status.DRAFT': 'Brouillon',
  'web.host.status.BLOCKED_ELIGIBILITY': 'Bloquée',
  'web.host.status.PENDING_REVIEW': 'En revue',
  'web.host.status.LISTED': 'Publiée',
  'web.host.status.REJECTED': 'Refusée',
  'web.host.status.SNOOZED': 'En pause',
  'web.host.status.UNLISTED': 'Retirée',
  'web.host.status.RESTRICTED': 'Restreinte',
  'web.host.status.REMOVED_BY_PLATFORM': 'Retirée par la plateforme',
  'web.host.status.DELETED': 'Supprimée',
  // US-126 : CGU de l'hôte (A07, LEG-001)
  'web.host.terms.title': 'Conditions de l’hôte',
  'web.host.terms.intro':
    'Tu loues ta propre voiture directement au voyageur ; nous ne sommes qu’intermédiaires et ne sommes pas partie au contrat de location.',
  'web.host.terms.version': 'Version {version}, en vigueur depuis le {date}',
  'web.host.terms.read': 'Lire les Conditions de l’hôte',
  'web.host.terms.required': 'Accepte-les avant d’envoyer ta première annonce.',
  'web.host.terms.reaccept':
    'Nous avons publié une nouvelle version. Accepte-la pour continuer à envoyer des annonces.',
  'web.host.terms.checkbox': 'J’ai lu et j’accepte les Conditions de l’hôte',
  'web.host.terms.accept': 'Accepter les conditions',
  'web.host.terms.accepted': 'Tu as accepté la version {version} le {date}.',
  'web.listing.notFound': 'Cette voiture n’est plus disponible',
  'web.listing.notFound.body':
    'L’hôte l’a peut-être retirée. Cherche une autre voiture près de toi.',
  'web.listing.search': 'Chercher une autre voiture',
  'web.listing.error': 'Impossible de charger cette voiture. Réessaie.',
  'web.listing.loading': 'Chargement de la voiture…',
  'web.listing.perDay': '{amount} par jour',
  'web.listing.features': 'L’essentiel',
  'web.listing.seats': { one: '{count} siège', other: '{count} sièges' },
  'web.listing.instant': 'Confirmation immédiate',
  'web.listing.request': 'Réservation sur demande',
  'web.listing.meet.title': 'Où tu récupères la voiture',
  'web.listing.meet.approx': 'Zone approximative. L’adresse exacte apparaît à la confirmation.',
  // US-115 : lieux de remise, véhicules et annonces de l'hôte (codes de 16 A.8 et PROPOSÉS)
  'common.listing.locationCreated': 'Lieu de remise enregistré.',
  'common.listing.vehicleCreated': 'Voiture enregistrée.',
  'common.listing.created': 'Brouillon de l’annonce créé.',
  'common.listing.saved': 'Enregistré',
  'common.listing.submitted': 'Ton annonce est envoyée en revue.',
  'common.listing.published': 'Ton annonce est publiée.',
  'common.listing.unlisted': 'Ton annonce est retirée. Tu peux la republier quand tu veux.',
  'common.listing.hasFutureTrips':
    'Ta voiture a des voyages réservés à venir. Tu pourras retirer l’annonce quand ils seront terminés ou annulés.',
  'common.listing.vehicleEligibilityRequired':
    'Avant de publier, confirme les informations de ta voiture (propriété, kilométrage et numéro de châssis).',
  'common.listing.areaLooksLikeAddress':
    'Indique seulement le quartier ou la zone, sans rue ni numéro : le voyageur le voit avant de réserver.',
  'common.listing.cityInvalid': 'Indique seulement la ville, sans adresse, téléphone ni lien.',
  'common.listing.vehicleDescriptionInvalid':
    'Écris seulement la marque et le modèle de la voiture, sans téléphone, lien ni adresse.',
  'common.listing.photoAdded': 'Photo ajoutée.',
  'common.listing.deleted': 'Annonce supprimée.',
  'common.listing.hostSuspended':
    'Ton compte d’hôte est suspendu : tu ne peux pas modifier tes annonces.',
  'common.listing.hostNotFound': 'Ce compte d’hôte est introuvable.',
  'common.listing.locationNotFound': 'Ce lieu de remise est introuvable.',
  'common.listing.vehicleNotFound': 'Cette voiture est introuvable.',
  'common.listing.notFound': 'Cette annonce est introuvable.',
  'common.listing.variantNotFound':
    'Cette version n’est pas au catalogue pour ta voiture. Choisis-en une autre ou demande son ajout.',
  'common.listing.variantRetired':
    'Cette version n’est plus proposée au catalogue. Choisis-en une autre.',
  'common.listing.plateDuplicate':
    'Cette plaque ou ce numéro de châssis (VIN) est déjà enregistré.',
  'common.listing.exists': 'Cette voiture a déjà une annonce.',
  'common.listing.transitionForbidden':
    'Ce changement est impossible dans l’état actuel de l’annonce.',
  'common.listing.vehicleFieldRequired':
    'Vérifie les informations de la voiture : un champ obligatoire manque ou n’est pas valide.',
  'common.listing.locationFieldInvalid':
    'Vérifie le lieu de remise : un champ manque ou n’est pas valide.',
  'common.listing.priceInvalid': 'Le prix par jour n’est pas valide pour cette devise.',
  'common.listing.mileageInvalid':
    'Vérifie la distance incluse et le prix du kilomètre supplémentaire.',
  'common.listing.requestModeNotAllowed': 'À l’aéroport, la réservation est toujours immédiate.',
  'common.listing.photoMinCount':
    'Ajoute d’autres photos de ta voiture avant de publier l’annonce.',
  'common.listing.photoFormat': 'Cette photo est inutilisable. Envoie une photo JPEG, PNG ou WebP.',
  'common.listing.photoLimitReached':
    'Cette annonce a déjà le nombre maximal de photos. Retire une photo avant d’en ajouter une autre.',
  'common.listing.hostTermsRequired':
    'Avant de publier ton annonce, lis et accepte la version en vigueur des Conditions de l’hôte.',
  'common.listing.vehicleNotCovered':
    'Ce véhicule ne remplit pas les conditions de la protection des voyages (âge, valeur ou usage). Il ne peut pas être publié.',
  'common.listing.insurerInactive':
    'Tout est prêt de votre côté. La protection des voyages n’est pas encore disponible ici ; vous pourrez publier votre annonce dès qu’elle le sera.',
  'common.listing.hostNotActivated':
    'Tout est prêt de ton côté. Tu pourras publier ton annonce quand ton compte d’hôte sera actif et que nous ouvrirons aux hôtes ici.',
  // US-202 : devis (16 PRC-025, PRC-020) : prix impossible, dates invalides, prix changé
  'common.quote.unavailable':
    'Nous ne pouvons pas calculer le prix de cette voiture pour ces dates. Essaie d’autres dates ou choisis une autre voiture.',
  'common.quote.datesInvalid': 'Vérifie les dates : le retour doit être après la prise en charge.',
  'common.quote.changed': 'Le prix a changé. Vérifie le nouveau total avant de continuer.',
  'common.quote.line.tripFee': 'Frais de voyage',
  'common.quote.line.tripFeeHint':
    'Couvrent le service de la plateforme : la réservation, le paiement sécurisé et l’aide pendant le voyage. Remboursés si tu annules sans frais.',
  'common.listing.unavailable':
    'Impossible d’enregistrer ton annonce pour le moment. Réessaie plus tard.',
  'common.listing.photoUnavailable':
    'Nous ne pouvons pas encore recevoir de photos. Réessaie plus tard.',
  'common.listing.field.required': 'Ce champ est obligatoire.',
  'common.listing.field.invalid': 'Cette valeur n’est pas valide.',
  'common.listing.photoTooLarge': 'Cette photo est trop lourde : jusqu’à {max} par photo.',
  'common.listing.deleteConfirmRequired': 'Coche la case pour confirmer.',
  'common.listing.priceFormat': 'Écris le prix ainsi : {example}.',
  'common.vehicle.bodyType.suv': 'SUV',
  'common.vehicle.bodyType.pickup': 'Pick-up',
  'common.vehicle.bodyType.sedan': 'Berline',
  'common.vehicle.bodyType.hatchback': 'Compacte',
  'common.vehicle.bodyType.van': 'Fourgon',
  'common.vehicle.bodyType.minivan': 'Monospace',
  'common.vehicle.bodyType.coupe': 'Coupé',
  'common.vehicle.bodyType.convertible': 'Cabriolet',
  'common.vehicle.bodyType.wagon': 'Break',
  'common.vehicle.gearbox.manual': 'Manuelle',
  'common.vehicle.gearbox.automatic': 'Automatique',
  'common.vehicle.gearbox.cvt': 'Automatique (CVT)',
  'common.vehicle.gearbox.dualClutch': 'Automatique à double embrayage',
  'common.vehicle.fuel.gasoline': 'Essence',
  'common.vehicle.fuel.diesel': 'Diesel',
  'common.vehicle.fuel.hybrid': 'Hybride',
  'common.vehicle.fuel.plugInHybrid': 'Hybride rechargeable',
  'common.vehicle.fuel.electric': 'Électrique',
  'common.vehicle.fuel.lpg': 'GPL',
  'common.vehicle.drive.front': 'Traction avant',
  'common.vehicle.drive.rear': 'Propulsion',
  'common.vehicle.drive.allWheel': 'Transmission intégrale',
  'common.vehicle.drive.fourByFour': '4x4',
  'common.vehicle.consumption.value': '{value} L/100 km',
  'common.vehicle.consumption.usReference': 'référence US',
  'common.vehicle.catalog.notListed': 'Ma voiture n’est pas dans la liste',
  'common.vehicle.catalog.variantRetired':
    'Cette version n’est plus au catalogue. Choisis-en une autre.',
  'common.vehicle.catalog.variantNotFound':
    'Nous n’avons pas trouvé cette version dans le catalogue.',
  'common.catalogAddition.requested':
    'Nous avons demandé l’ajout de ta voiture au catalogue. Nous te préviendrons quand ce sera prêt.',
  'common.catalogAddition.pending':
    'Ta voiture n’est pas encore au catalogue. Tu pourras envoyer l’annonce quand l’équipe l’aura ajoutée.',
  'common.catalogAddition.duplicate': 'Une demande est déjà ouverte pour cette voiture.',
  'common.catalogAddition.alreadyLinked': 'Cette voiture est déjà au catalogue.',
  'common.catalogAddition.closed': 'Cette demande a déjà été tranchée.',
  'common.catalogAddition.variantExists':
    'Cette version est déjà au catalogue. Rattachez-la au lieu de la créer.',
  'common.catalogAddition.variantNotFound':
    'Cette version ne convient pas à cette voiture : autre marché, autre année ou retirée.',
  'common.catalogAddition.entryInvalid':
    'Vérifiez la version : une valeur est invalide ou elle ne couvre pas l’année de la voiture.',
  'web.host.car.catalogHint':
    'Si ta voiture n’est pas au catalogue, l’équipe la vérifie et l’ajoute avant ta publication.',
  'web.host.catalog.status.OPEN': 'En attente du catalogue',
  'web.host.catalog.status.APPROVED': 'Au catalogue',
  'web.host.catalog.status.MERGED': 'Au catalogue',
  'web.host.catalog.status.REJECTED': 'Non ajoutée',
  'web.host.catalog.pending':
    'L’équipe la vérifie avant le {date}. D’ici là, ton annonce reste en brouillon.',
  'web.host.catalog.reason.INSUFFICIENT_DETAILS':
    'Il manque des informations pour identifier ta voiture.',
  'web.host.catalog.reason.UNKNOWN_MODEL': 'Nous n’avons pas pu identifier la marque ou le modèle.',
  'web.host.catalog.reason.NOT_ELIGIBLE': 'Ce véhicule ne peut pas être publié sur la plateforme.',
  'web.host.catalog.retry': 'Corrige la marque et le modèle, puis redemande',
  'web.host.catalog.send': 'Redemander',
  'ntf.catalogAdditionApproved.email.subject': 'Ta voiture est au catalogue',
  'ntf.catalogAdditionApproved.email.body':
    'Bonjour {first_name}. Nous avons ajouté ta voiture au catalogue de {brand}. Tu peux maintenant envoyer ton annonce depuis ton espace hôte.',
  'ntf.catalogAdditionApproved.sms.body':
    '{brand} : ta voiture est au catalogue. Tu peux envoyer ton annonce.',
  'ntf.catalogAdditionRejected.email.subject': 'Ta voiture n’a pas été ajoutée au catalogue',
  'ntf.catalogAdditionRejected.email.body':
    'Bonjour {first_name}. Nous n’avons pas pu ajouter ta voiture au catalogue de {brand}. Ton espace hôte indique la raison et te permet de corriger la marque et le modèle.',
  'ntf.catalogAdditionRejected.sms.body':
    '{brand} : ta voiture n’a pas été ajoutée au catalogue. Raison dans ton espace hôte.',
  'ntf.tripHostRestricted.email.subject': 'Réservation {booking_ref} : information sur ton hôte',
  'ntf.tripHostRestricted.email.body':
    'Bonjour {first_name}. Nous examinons le compte de l’hôte de ta réservation {booking_ref}. Ta réservation reste enregistrée et nous te tenons informé. Si l’hôte l’annule, tu es remboursé intégralement. Détails dans l’appli.',
  'ntf.tripHostRestricted.sms.body':
    '{brand} : nous examinons le compte de l’hôte de ta réservation {booking_ref}. Remboursement intégral si l’hôte l’annule. Détails dans l’appli.',
  'backoffice.catalog.open': 'Ouvrir la demande',
  'backoffice.catalog.heading': 'Demande d’ajout au catalogue',
  'backoffice.catalog.requested': 'Saisie de l’hôte',
  'backoffice.catalog.vin': 'VIN (numéro de série masqué)',
  'backoffice.catalog.declared': 'Caractéristiques déclarées',
  'backoffice.catalog.due': 'À trancher avant le {date}',
  'backoffice.catalog.candidates': 'Versions du catalogue pour cette voiture',
  'backoffice.catalog.noCandidate':
    'Aucune version du catalogue ne correspond à la marque et à l’année.',
  'backoffice.catalog.version': 'Version',
  'backoffice.catalog.years': 'Années',
  'backoffice.catalog.modelMatch': 'Même modèle',
  'backoffice.catalog.merge': 'Rattacher cette version',
  'backoffice.catalog.approveHeading': 'Créer la version au catalogue',
  'backoffice.catalog.makeName': 'Marque',
  'backoffice.catalog.modelName': 'Modèle',
  'backoffice.catalog.bodyType': 'Carrosserie',
  'backoffice.catalog.yearFrom': 'À partir de l’année',
  'backoffice.catalog.yearTo': 'Jusqu’à l’année',
  'backoffice.catalog.trimName': 'Finition',
  'backoffice.catalog.transmission': 'Boîte de vitesses',
  'backoffice.catalog.fuel': 'Carburant',
  'backoffice.catalog.drive': 'Transmission',
  'backoffice.catalog.seats': 'Places',
  'backoffice.catalog.doors': 'Portes',
  'backoffice.catalog.licenseNote': 'Source et licence des données',
  'backoffice.catalog.licenseHint':
    'Indiquez d’où viennent les données, par exemple le titre du véhicule. Ne copiez jamais un autre site ni une annonce.',
  'backoffice.catalog.approve': 'Créer et rattacher',
  'backoffice.catalog.rejectHeading': 'Refuser avec un motif',
  'backoffice.catalog.reject.INSUFFICIENT_DETAILS': 'Informations insuffisantes',
  'backoffice.catalog.reject.UNKNOWN_MODEL': 'Modèle inconnu',
  'backoffice.catalog.reject.NOT_ELIGIBLE': 'Véhicule non admis',
  'backoffice.catalog.done.APPROVED': 'Version créée et rattachée. L’hôte est prévenu.',
  'backoffice.catalog.done.MERGED': 'Version rattachée. L’hôte est prévenu.',
  'backoffice.catalog.done.REJECTED': 'Demande refusée. L’hôte est prévenu.',
  'common.calendar.blockCreated': 'Dates bloquées.',
  'common.calendar.blockRemoved': 'Dates débloquées.',
  'common.calendar.noticeSaved': 'Préavis enregistré.',
  'common.calendar.vehicleUnavailable': 'Ces dates sont déjà prises. Choisis-en d’autres.',
  'common.calendar.notListed': 'Publie ton annonce avant de bloquer des dates.',
  'common.calendar.blockNotFound': 'Ce blocage n’existe plus.',
  'common.calendar.invalidPeriod':
    'Vérifie les dates : la fin doit suivre le début et ne pas être déjà passée.',
  'common.calendar.noticeInvalid': 'Choisis un préavis entre 1 heure et 7 jours.',
  'web.calendar.title': 'Calendrier',
  'web.calendar.intro':
    'Vois quand ta voiture est occupée, bloque des jours ou des heures et fixe ton préavis.',
  'web.calendar.open': 'Voir le calendrier',
  'web.calendar.back': 'Retour à mes voitures',
  'web.calendar.notFound': 'Nous n’avons pas trouvé cette voiture.',
  'web.calendar.timezone': 'Heures dans le fuseau horaire de la voiture ({timezone}).',
  'web.calendar.upcoming.title': 'Occupations à venir',
  'web.calendar.empty': 'Rien à venir : ta voiture est disponible.',
  'web.calendar.kind.TRIP': 'Voyage confirmé',
  'web.calendar.kind.HOLD': 'Réservation en cours',
  'web.calendar.kind.HOST_BLOCK': 'Bloqué par toi',
  'web.calendar.kind.BUFFER': 'Battement entre voyages',
  'web.calendar.range': 'Du {start} au {end}',
  'web.calendar.remove': 'Débloquer',
  'web.calendar.block.title': 'Bloquer des dates',
  'web.calendar.block.notListed': 'Tu pourras bloquer des dates quand ton annonce sera publiée.',
  'web.calendar.block.days': 'Bloquer des jours entiers',
  'web.calendar.block.from': 'Du jour',
  'web.calendar.block.to': 'Au jour (inclus)',
  'web.calendar.block.submitDays': 'Bloquer ces jours',
  'web.calendar.block.hours': 'Bloquer quelques heures',
  'web.calendar.block.date': 'Jour',
  'web.calendar.block.start': 'De',
  'web.calendar.block.end': 'À',
  'web.calendar.block.hoursHint': 'Par tranches d’une demi-heure.',
  'web.calendar.block.submitHours': 'Bloquer ces heures',
  'web.calendar.notice.title': 'Préavis minimum',
  'web.calendar.notice.intro':
    'Délai minimum entre la réservation et le début du voyage à ton lieu de remise. Personne ne pourra réserver plus tard.',
  'web.calendar.notice.label': 'Préavis',
  'web.calendar.notice.default': 'Valeur par défaut',
  'web.calendar.notice.current': 'Préavis en vigueur : {duration}.',
  'web.calendar.notice.save': 'Enregistrer le préavis',
  'web.calendar.duration.hours': { one: '{count} heure', other: '{count} heures' },
  'web.calendar.duration.days': { one: '{count} jour', other: '{count} jours' },
  'web.calendar.duration.hoursDecimal': '{value} heures',
  // Vérification d’identité et consentement biométrique (US-105, 16 VER-001, VER-004 ; écran S04,
  // 10b §4.3 : web.s04.checking, .result.verified, .result.retake ; autres clés PROPOSÉES)
  'common.kyc.state': 'État de ta vérification d’identité.',
  'common.kyc.consentRecorded': 'Nous avons enregistré ta réponse sur le consentement biométrique.',
  'common.kyc.consentVersionChanged':
    'Le texte du consentement a changé. Relis-le avant d’accepter.',
  'common.kyc.consentUnavailable':
    'Nous ne pouvons pas afficher le consentement pour le moment. Réessaie plus tard.',
  'common.kyc.sessionStarted':
    'Nous t’emmenons sur la page sécurisée de notre prestataire de vérification.',
  'common.kyc.sessionInProgress':
    'Tu as déjà commencé ta vérification : tu peux la reprendre là où tu l’as laissée.',
  'common.kyc.consentMissing':
    'Pour vérifier ton identité, accepte d’abord le consentement biométrique.',
  'common.kyc.notEligible':
    'Nous ne pouvons pas vérifier ton identité d’ici. Écris-nous pour qu’on regarde ensemble.',
  'common.kyc.inReview':
    'Ta vérification est en cours d’examen : nous te prévenons dès que nous avons la décision.',
  'common.kyc.alreadyApproved': 'Ton identité est déjà vérifiée. Tu n’as rien d’autre à faire.',
  'common.kyc.documentUnsupported':
    'Nous ne pouvons pas encore vérifier un permis délivré là-bas. Choisis-en un autre ou écris-nous.',
  'common.kyc.sessionFailed':
    'Nous n’avons pas pu ouvrir la vérification. Réessaie dans quelques minutes.',
  'common.kyc.providerUnavailable':
    'La vérification d’identité n’est pas disponible pour le moment. Réessaie plus tard.',
  'common.kyc.notApproved': 'Vérifie ton identité et ton permis avant de payer.',
  'common.kyc.licenseExpired':
    'Ton permis expire avant la fin du voyage. Mets-le à jour pour pouvoir payer.',
  'common.kyc.driverEligible': 'Ton permis est valable pour tout le voyage.',
  'common.kyc.legalNameUpdated':
    'Nous avons enregistré ton nom. Si ton identité était déjà vérifiée, vérifie-la de nouveau avant ton prochain voyage.',
  'common.kyc.legalNameUnchanged': 'Ton nom était déjà celui-ci. Nous n’avons rien changé.',
  'common.kyc.legalNameRequired':
    'Saisis ton prénom et ton nom tels qu’ils figurent sur ton permis de conduire.',
  'common.kyc.legalNameLocked':
    'Nous vérifions ton identité. Tu pourras changer ton nom une fois la vérification terminée.',
  'common.kyc.entryDeclared':
    'Ta date d’entrée est enregistrée. L’équipe la vérifiera si ta réservation le demande.',
  'common.kyc.entryDateInvalid':
    'Vérifie la date d’entrée : elle ne peut pas être après aujourd’hui.',
  'web.s04.title': 'Vérifie ton identité',
  'web.s04.intro':
    'Nous le faisons avant le paiement pour que tu ne paies jamais si tu ne peux pas conduire.',
  'web.s04.progress': 'Étape {step} sur {total}',
  'web.s04.consent.heading': 'Consentement biométrique',
  'web.s04.consent.checkbox':
    'J’accepte que le prestataire utilise mes données biométriques pour vérifier mon identité.',
  'web.s04.consent.submit': 'Accepter et continuer',
  'web.s04.consent.required': 'Coche la case pour accepter le consentement biométrique.',
  'web.s04.consent.refusal':
    'Sans ce consentement, nous ne pouvons pas te vérifier, et tu ne pourras ni réserver ni publier une voiture.',
  'web.s04.consent.withdraw': 'Retirer mon consentement',
  'web.s04.consent.withdrawHeading': 'Ton consentement biométrique',
  'web.s04.consent.withdrawHint':
    'Tu peux le retirer à tout moment. Nous demanderons au prestataire d’effacer tes données biométriques, et tu ne pourras plus réserver ni publier une voiture avant une nouvelle vérification.',
  'web.s04.consent.given': 'Tu as accepté le consentement biométrique.',
  'web.s04.country': 'Lieu de délivrance de ton permis',
  'web.s04.start': 'Vérifier mon identité',
  'web.s04.resume': 'Reprendre ma vérification',
  'web.s04.hosted':
    'Tu prendras les photos sur la page sécurisée du prestataire. Nous ne gardons aucune photo : seulement le résultat.',
  'web.s04.checking': 'Vérification…',
  'web.s04.result.verified': 'Vérifié',
  'web.s04.result.retake': 'Il nous faut une autre photo',
  'web.s04.licenseValid': 'Permis valable jusqu’au {date}.',
  'web.s04.result.rejected':
    'Ta vérification d’identité n’a pas été approuvée. Tu ne peux pas réserver pour l’instant.',
  'web.s04.result.rejectedHelp':
    'Ton compte reste ouvert. Tu peux retirer ton consentement biométrique ci-dessous à tout moment.',
  'web.s04.moreInfo.LIVENESS_FAILED':
    'Refais le selfie avec ton permis, visage bien éclairé, sans lunettes de soleil ni chapeau.',
  'web.s04.moreInfo.ID_DOCUMENT_REFUSED':
    'Ta pièce d’identité n’a pas pu être acceptée : utilise une pièce valable, adaptée à ton statut (passeport si tu es touriste).',
  'web.s04.moreInfo.LICENSE_NOT_ACCEPTED':
    'Il nous faut ton permis de conduire physique et définitif, recto et verso. Un permis international seul ou un permis provisoire ne suffit pas.',
  'web.s04.moreInfo.generic': 'Recommence la vérification avec des photos nettes de tes pièces.',
  'web.s04.phoneFirst':
    'Vérifie d’abord ton téléphone : il sert à organiser la remise de la voiture.',
  'web.s04.phoneLink': 'Vérifier mon téléphone',
  'common.hostVerification.state': 'État de ta vérification d’hôte.',
  'common.hostVerification.submitted': 'Nous avons reçu ta demande pour devenir hôte.',
  'common.hostVerification.taxSaved': 'Nous avons enregistré ton numéro fiscal.',
  'common.hostVerification.ageUnverified':
    'Nous n’avons pas pu confirmer ta date de naissance. Vérifie à nouveau ton identité.',
  'common.hostVerification.kycRequired': 'Vérifie d’abord ton identité et ton permis.',
  'common.hostVerification.residenceMismatch':
    'Ta résidence vérifiée ne correspond pas au lieu de ton compte d’hôte.',
  'common.hostVerification.accountNotEligible':
    'Ton compte d’hôte ne peut pas recevoir cette demande pour le moment. Écris-nous.',
  'common.hostVerification.locked':
    'Ta demande est en cours d’examen ou a déjà été examinée. Pour changer une information, écris-nous.',
  'common.hostVerification.taxKindInvalid': 'Choisis l’un des types de numéro fiscal de la liste.',
  'common.hostVerification.taxIdInvalid':
    'Vérifie ton numéro fiscal : chiffres, lettres et tirets seulement.',
  'common.hostVerification.vaultUnavailable':
    'Nous ne pouvons pas enregistrer ton numéro fiscal en sécurité pour le moment. Réessaie plus tard.',
  'common.hostVerification.unavailable':
    'Nous ne pouvons pas traiter ta demande d’hôte pour le moment. Réessaie plus tard.',
  'web.a07.loginRequired': 'Connecte-toi pour voir tes tâches d’hôte.',
  'web.a07.login': 'Se connecter',
  'web.a07.noHostAccount': 'Tu n’as pas encore de compte d’hôte.',
  'web.a07.openHost': 'Aller à mon espace d’hôte',
  'web.a07.error': 'Nous n’avons pas pu charger tes tâches.',
  'web.a07.retry': 'Réessayer',
  'web.a07.tasksHeading': 'Tes tâches',
  'web.a07.done': 'Fait',
  'web.a07.todo': 'À faire',
  'web.a07.waiting': 'En attente',
  'web.a07.task.identityAction': 'Vérifier mon identité',
  'web.a07.task.age': 'Âge minimum pour être hôte',
  'web.a07.task.ageHint': 'Nous la lisons sur ton identité vérifiée ou, à défaut, sur ton compte.',
  'web.a07.task.termsAction': 'Lire et accepter',
  'web.a07.task.screening': 'Contrôles de sécurité',
  'web.a07.task.screeningHint': 'Nous les faisons quand tu envoies ta demande.',
  'web.a07.task.payments': 'Compte de versement examiné par le prestataire de paiement',
  'web.a07.task.paymentsHint': 'Ce contrôle est fait par le prestataire de paiement, pas par toi.',
  'web.a07.tax.heading': 'Ton numéro fiscal',
  'web.a07.tax.kind': 'Type de numéro',
  'web.a07.tax.number': 'Numéro',
  'web.a07.tax.numberHint': 'Tel qu’il figure sur ton document, avec ou sans tirets.',
  'web.a07.tax.regime': 'Régime fiscal',
  'web.a07.tax.regimeHint': 'Code en majuscules, si tu le connais.',
  'web.a07.tax.save': 'Enregistrer mon numéro',
  'web.a07.tax.saved': 'Numéro enregistré ({kind}).',
  'web.a07.tax.private': 'Nous le gardons chiffré et ne le montrons jamais aux voyageurs.',
  'web.a07.tax.individualOnly': 'Particuliers seulement : nous n’acceptons pas les sociétés.',
  'web.a07.optional': 'Facultatif',
  'web.a07.tax.optionalHint':
    'Tu peux ajouter ton numéro fiscal maintenant ou plus tard. Nous ne te le demanderons que si notre prestataire de paiement en a besoin pour te payer.',
  'web.a07.tax.reminder':
    'Tes impôts relèvent de ta responsabilité. Selon les règles fiscales locales, tu dois peut-être t’inscrire auprès de l’administration fiscale, par exemple pour obtenir un numéro de contribuable, dans un délai fixé après tes premiers revenus de location. Renseigne-toi auprès de l’administration fiscale ou d’un comptable.',
  'web.a07.submit': 'Envoyer ma demande',
  'web.a07.submitHint':
    'Tu peux l’envoyer même s’il manque une tâche : nous te dirons ce qui reste.',
  'web.a07.status.DOCS_PENDING': 'Ta demande est incomplète.',
  'web.a07.status.IN_REVIEW': 'Nous examinons ta demande.',
  'web.a07.status.APPROVED': 'Nous avons approuvé ta demande.',
  'web.a07.status.REJECTED':
    'Nous n’avons pas pu approuver ta demande. Écris-nous pour en savoir plus.',
  'web.a07.missing': 'Il manque : {tasks}.',
  'web.a07.pendingActivation':
    'Nous avons approuvé ta demande, mais ton compte d’hôte n’est pas encore actif.',
  'web.a07.active': 'Ton compte d’hôte est actif.',
  'web.a07.back': 'Retour à mon espace d’hôte',
  'web.host.verificationLink': 'Ma vérification d’hôte',
  'web.a07.waitingCountry':
    'Tout est prêt de ton côté. Nous te préviendrons quand {brand} ouvrira aux hôtes au {country}.',
  'web.a07.title': 'Avant d’accueillir des voyageurs',
  'web.a07.intro':
    'On te dit ce qui reste et qui s’en charge. Tu peux partir et revenir quand tu veux.',
  'web.a07.task.identity': 'Ton identité',
  'web.a07.task.tax': 'Données fiscales',
  'web.a07.task.terms': 'Conditions pour les hôtes',
  // US-127 : refus d'une réservation par l'hôte lui-même ou un compte lié (16 ACC-014,
  // SELF_BOOKING_FORBIDDEN) ; le même texte dans tous les cas, sans dire pourquoi (ADR-110)
  'common.booking.selfBookingForbidden.title': 'Tu ne peux pas réserver cette voiture',
  'common.booking.selfBookingForbidden.body':
    'Cette voiture ne peut pas être réservée avec ton compte. Choisis-en une autre, ou écris-nous si tu penses qu’il s’agit d’une erreur.',
  // US-207 : refus des commandes de la machine à états du trip (16 TRP-045 ; 08 BR-CXL règle 3)
  'common.trip.transitionForbidden':
    'Cette action n’est plus possible pour cette réservation. Recharge la page pour voir où elle en est.',
  'common.trip.concurrentUpdate':
    'Cette réservation vient de changer. Recharge la page puis réessaie.',
  'common.trip.noShowTooEarly':
    'Il est trop tôt pour signaler l’absence du voyageur. Réessaie après la fin du temps d’attente indiqué dans la réservation.',
  // US-125 : avertissements réglementaires versionnés par pays (16 LEG-021), textes PROPOSÉS
  'common.regulatory.heading': 'Avertissement important',
  'common.regulatory.version': 'Version {version} de cet avertissement',
  'common.regulatory.unavailable':
    'Les avertissements sont indisponibles pour le moment. Réessaie plus tard.',
  'common.regulatory.privatePlate.v1.host.title':
    'Plaque « particular » et location entre particuliers',
  'common.regulatory.privatePlate.v1.host.body':
    'Au Panama, une voiture à plaque « particular » est immatriculée pour un usage privé. La location entre particuliers d’une telle voiture fait l’objet d’une analyse juridique en cours. Avant de la publier, vérifie auprès de ton assureur et de ta carte grise que tu peux la proposer.',
  'common.regulatory.privatePlate.v1.guest.title': 'Une voiture de particulier',
  'common.regulatory.privatePlate.v1.guest.body':
    'Cette voiture appartient à un particulier et porte une plaque « particular ». La location entre particuliers avec ce type de plaque fait l’objet d’une analyse juridique en cours au Panama. Vérifie les conditions de location avant de réserver.',
  'common.regulatory.hostTaxStatus.v1.host.title': 'Ta situation fiscale d’hôte',
  'common.regulatory.hostTaxStatus.v1.host.body':
    'Au Paraguay, les revenus tirés de la location de ta voiture peuvent devoir être déclarés selon ta situation fiscale. Le régime fiscal des hôtes particuliers fait l’objet d’une analyse en cours. Renseigne ton numéro fiscal et conserve tes relevés de gains.',
  'common.regulatory.hostTaxStatus.v1.guest.title': 'Location auprès d’un particulier',
  'common.regulatory.hostTaxStatus.v1.guest.body':
    'Cette voiture est louée par un particulier. Au Paraguay, la situation fiscale des hôtes particuliers fait l’objet d’une analyse en cours. Ton reçu détaille ce que tu paies.',
  'common.catalogAddition.rejected':
    'Ta voiture n’a pas été ajoutée au catalogue. Consulte la raison sous la voiture.',
  'common.catalogAddition.notAllowed':
    'Tu ne peux plus demander l’ajout de cette voiture. Si c’est une erreur, écris au support.',
  'web.host.catalog.final':
    'Cette voiture ne peut pas être publiée. Si c’est une erreur, écris au support.',
  'backoffice.catalog.choose': 'Choisissez une option',
  'backoffice.catalog.rejectConfirm': 'Je confirme le refus : l’hôte sera prévenu.',
  'backoffice.catalog.ongoing': 'en cours',
  'common.vehicleDocs.declarationSaved': 'Informations de la voiture enregistrées.',
  'common.vehicleDocs.documentAdded': 'Document reçu. Nous allons le vérifier.',
  'common.vehicleDocs.submitted': 'Envoyé pour vérification. Nous te dirons le résultat.',
  'common.vehicleDocs.claimOpened': 'Réclamation reçue. Nous allons l’examiner avec ton titre.',
  'common.vehicleDocs.underReview':
    'Cette voiture est en cours de vérification : tu ne peux pas la modifier avant la fin.',
  'common.vehicleDocs.ineligible': 'Cette voiture ne peut pas être publiée.',
  'common.vehicleDocs.released': 'Cette voiture a été retirée de ton compte après une réclamation.',
  'common.vehicleDocs.alreadyEligible': 'Cette voiture est déjà approuvée.',
  'common.vehicleDocs.claimNotNeeded':
    'Aucun autre compte n’a cette plaque ni ce VIN : tu peux enregistrer ta voiture.',
  'common.vehicleDocs.claimDuplicate':
    'Tu as déjà envoyé une réclamation pour cette voiture. Nous l’examinons.',
  'common.vehicleDocs.claimLimitReached':
    'Tu as déjà plusieurs réclamations en cours d’examen. Attends notre réponse avant d’en envoyer une autre.',
  'common.vehicleDocs.tooOld': 'La voiture dépasse l’âge maximal autorisé dans ton pays.',
  'common.vehicleDocs.mileageTooHigh': 'Le kilométrage dépasse le maximum autorisé dans ton pays.',
  'common.vehicleDocs.titleMismatch':
    'Déclare que tu es propriétaire de la voiture ou que le propriétaire t’autorise.',
  'common.vehicleDocs.lenderConsentRequired':
    'La voiture est financée : déclare que tu as l’accord du créancier.',
  'common.vehicleDocs.documentRequired': 'Il manque un document obligatoire de la voiture.',
  'common.vehicleDocs.documentExpired':
    'Un document de la voiture est expiré. Ajoute un document valide.',
  'common.vehicleDocs.documentInvalid':
    'Nous n’avons pas pu accepter ce fichier. Ajoute une photo (JPG, PNG, HEIC) ou un PDF.',
  'common.vehicleDocs.uploadUnavailable':
    'L’envoi de documents n’est pas encore disponible. Réessaie plus tard.',
  'common.vehicleReview.closed': 'Cette voiture n’est plus en vérification.',
  'common.listingReview.closed': 'Cette annonce n’est plus en revue.',
  'common.listingReview.rationaleRequired': 'Choisis le motif du refus.',
  'common.listingReview.notPublishable':
    'Approbation impossible : l’annonce échoue à un contrôle automatique ({reason}).',
  'common.vehicleReview.checklistInvalid':
    'Coche chaque point de contrôle et donne un verdict pour chaque document.',
  'common.vehicleReview.claimClosed': 'Cette réclamation a déjà été tranchée.',
  'common.vehicleReview.claimReasonInvalid': 'Choisis un motif pour rejeter ; aucun pour accepter.',
  'common.vehicleReview.adminRequired':
    'Seul un administrateur peut libérer la voiture d’un autre compte.',
  'common.vehicleReview.fileNotFound': 'Ce document n’appartient pas à cet élément.',
  'common.vehicleReview.fileUnavailable':
    'Nous n’avons pas pu ouvrir le document. Réessaie plus tard.',
  'web.vehicleDocs.open': 'Valider la voiture',
  'web.vehicleDocs.title': 'Valider ta voiture',
  'web.vehicleDocs.intro':
    'Confirme quelques informations et ta voiture est prête à être publiée. Nous ne demandons des documents que si besoin.',
  'web.vehicleDocs.back': 'Retour à mes voitures',
  'web.vehicleDocs.notFound': 'Nous n’avons pas trouvé cette voiture',
  'web.vehicleDocs.status.ELIGIBLE': 'Approuvée',
  'web.vehicleDocs.status.PENDING': 'À vérifier',
  'web.vehicleDocs.status.INELIGIBLE': 'Non publiable',
  'web.vehicleDocs.underReview': 'En cours de vérification. Nous te dirons le résultat.',
  'web.vehicleDocs.released': 'Cette voiture a été retirée de ton compte après une réclamation.',
  'web.vehicleDocs.publishable': 'Prête à être publiée',
  'web.vehicleDocs.reasons': 'Ce qu’il manque',
  'web.vehicleDocs.reason.CATALOG_ADDITION_PENDING':
    'Le modèle n’est pas encore dans notre catalogue.',
  'web.vehicleDocs.reason.VEHICLE_TOO_OLD': 'La voiture dépasse l’âge maximal.',
  'web.vehicleDocs.reason.VEHICLE_MILEAGE_TOO_HIGH': 'Le kilométrage dépasse le maximum.',
  'web.vehicleDocs.reason.VEHICLE_FIELD_REQUIRED':
    'Complète les informations de la voiture : numéro de châssis (VIN), kilométrage et titulaire.',
  'web.vehicleDocs.reason.VEHICLE_TITLE_MISMATCH':
    'Il te reste à déclarer que tu es propriétaire ou autorisé par le propriétaire.',
  'web.vehicleDocs.reason.VEHICLE_LENDER_CONSENT_REQUIRED':
    'Il te reste à déclarer que tu as l’accord du créancier.',
  'web.vehicleDocs.reason.VEHICLE_DOCUMENT_REQUIRED': 'Il manque un document obligatoire.',
  'web.vehicleDocs.reason.VEHICLE_DOCUMENT_EXPIRED': 'Un document est expiré.',
  'web.vehicleDocs.reason.VEHICLE_PLATE_MISMATCH': 'La plaque ne correspond pas au titre.',
  'web.vehicleDocs.reason.VEHICLE_VIN_MISMATCH':
    'Le numéro de châssis (VIN) ne correspond pas au titre.',
  'web.vehicleDocs.reason.VEHICLE_INSPECTION_INVALID': 'Le contrôle technique n’est pas valide.',
  'web.vehicleDocs.reason.VEHICLE_DOCUMENT_REJECTED':
    'Nous avons refusé un document : vois le motif plus bas.',
  'web.vehicleDocs.reason.VEHICLE_TITLE_FORBIDDEN': 'Le titre ne permet pas de louer la voiture.',
  'web.vehicleDocs.reason.VEHICLE_REGISTRY_FLAGGED':
    'Le registre public signale un problème sur la voiture.',
  'web.vehicleDocs.reason.VEHICLE_RELEASED': 'La voiture a été retirée de ton compte.',
  'web.vehicleDocs.reason.other': 'Il reste un point à régler. Écris au support.',
  'web.vehicleDocs.declaration.title': 'Informations de la voiture',
  'web.vehicleDocs.declaration.holder': 'Au nom de qui est le titre ?',
  'web.vehicleDocs.declaration.holder.HOST': 'À mon nom',
  'web.vehicleDocs.declaration.holder.THIRD_PARTY':
    'Au nom d’une autre personne (avec son autorisation notariée)',
  'web.vehicleDocs.declaration.lien': 'La voiture est financée (gage ou crédit en cours)',
  'web.vehicleDocs.declaration.odometer': 'Kilométrage actuel',
  'web.vehicleDocs.declaration.save': 'Enregistrer',
  'web.vehicleDocs.type.TITLE': 'Titre ou carte grise',
  'web.vehicleDocs.type.OWNER_AUTHORIZATION': 'Autorisation notariée du propriétaire',
  'web.vehicleDocs.type.PLATE_VIN_PHOTO': 'Photo de la plaque et du VIN',
  'web.vehicleDocs.type.INSPECTION': 'Contrôle technique valide',
  'web.vehicleDocs.type.LENDER_CONSENT': 'Accord écrit du créancier',
  'web.vehicleDocs.type.COMPULSORY_INSURANCE': 'Assurance obligatoire de la voiture',
  'web.vehicleDocs.doc.status.SUBMITTED': 'En vérification',
  'web.vehicleDocs.doc.status.VALID': 'Valide',
  'web.vehicleDocs.doc.status.REJECTED': 'Refusé',
  'web.vehicleDocs.doc.missing': 'Manquant',
  'web.vehicleDocs.doc.validUntil': 'Expire le {date}',
  'web.vehicleDocs.doc.rejected.ILLEGIBLE': 'Illisible',
  'web.vehicleDocs.doc.rejected.EXPIRED': 'Expiré',
  'web.vehicleDocs.doc.rejected.MISMATCH': 'Ne correspond pas à la voiture',
  'web.vehicleDocs.doc.rejected.WRONG_DOCUMENT': 'Ce n’est pas le document demandé',
  'web.vehicleDocs.doc.rejected.SUSPECTED_FORGERY': 'Nous n’avons pas pu le valider',
  'web.vehicleDocs.documents.title': 'Documents',
  'web.vehicleDocs.upload.title': 'Ajouter un document',
  'web.vehicleDocs.upload.type': 'Type de document',
  'web.vehicleDocs.upload.file': 'Fichier (photo ou PDF)',
  'web.vehicleDocs.upload.validUntil': 'Valable jusqu’au (s’il a une date)',
  'web.vehicleDocs.upload.send': 'Envoyer',
  'web.vehicleDocs.upload.max':
    'Jusqu’à {max}. Seuls toi et notre équipe de vérification le voient.',
  'web.vehicleDocs.upload.closed':
    'L’envoi de documents n’est pas encore disponible. Tu peux compléter les informations de la voiture.',
  'web.vehicleDocs.upload.tooLarge': 'Le fichier dépasse {max}.',
  'web.vehicleDocs.submit.title': 'Valider',
  'web.vehicleDocs.submit.intro':
    'Nous vérifions tes informations tout de suite. Si ton pays demande des documents, notre équipe les vérifie.',
  'web.vehicleDocs.submit.send': 'Valider ma voiture',
  'web.vehicleDocs.claims.title': 'Ta plaque est déjà enregistrée ?',
  'web.vehicleDocs.claims.intro':
    'Si un autre compte a enregistré ta voiture, envoie-nous ton titre et nous vérifions.',
  'web.vehicleDocs.claims.open': 'Réclamer ma plaque',
  'web.vehicleDocs.claims.plate': 'Plaque d’immatriculation',
  'web.vehicleDocs.claims.vin': 'Numéro de châssis (VIN), si tu l’as',
  'web.vehicleDocs.claims.file': 'Titre à ton nom (photo ou PDF)',
  'web.vehicleDocs.claims.send': 'Envoyer la réclamation',
  'web.vehicleDocs.claims.mine': 'Mes réclamations',
  'web.vehicleDocs.claims.status.OPEN': 'En vérification',
  'web.vehicleDocs.claims.status.UPHELD': 'Acceptée : tu peux enregistrer ta voiture',
  'web.vehicleDocs.claims.status.DISMISSED': 'Rejetée',
  'backoffice.vehicle.open': 'Ouvrir la voiture',
  'backoffice.vehicle.heading': 'Vérification de la voiture',
  'backoffice.vehicle.holder': 'Titulaire du compte',
  'backoffice.vehicle.plate': 'Plaque',
  'backoffice.vehicle.vin': 'VIN',
  'backoffice.vehicle.titleHolder': 'Titre déclaré',
  'backoffice.vehicle.lien': 'Financée',
  'backoffice.vehicle.documents': 'Documents',
  'backoffice.vehicle.viewFile': 'Voir le document',
  'backoffice.vehicle.checklist': 'Liste de contrôle (coche chaque point)',
  'backoffice.vehicle.check.TITLE_HOLDER': 'Titre au nom de l’hôte ou autorisation notariée',
  'backoffice.vehicle.check.TITLE_CLEAN': 'Titre sans restriction (ni épave, ni vol)',
  'backoffice.vehicle.check.PLATE_MATCH': 'La plaque correspond au titre',
  'backoffice.vehicle.check.VIN_MATCH': 'Le VIN correspond au titre',
  'backoffice.vehicle.check.LIEN': 'Gage : pas de financement, ou accord du créancier valide',
  'backoffice.vehicle.check.INSPECTION': 'Contrôle technique valide',
  'backoffice.vehicle.check.REGISTRY': 'Registre public consulté',
  'backoffice.vehicle.pass': 'Conforme',
  'backoffice.vehicle.fail': 'Non conforme',
  'backoffice.vehicle.notConsultable': 'Non consultable',
  'backoffice.vehicle.verdict.VALID': 'Valide',
  'backoffice.vehicle.verdict.REJECTED': 'Refuser',
  'backoffice.vehicle.validUntil': 'Valable jusqu’au',
  'backoffice.vehicle.decide': 'Enregistrer la vérification',
  'backoffice.vehicle.result.ELIGIBLE': 'Voiture approuvée.',
  'backoffice.vehicle.result.PENDING': 'La voiture reste en attente avec ses motifs.',
  'backoffice.vehicle.result.INELIGIBLE': 'Voiture non publiable.',
  'backoffice.vehicle.claim.open': 'Ouvrir la réclamation',
  'backoffice.vehicle.claim.heading': 'Réclamation de plaque ou de VIN',
  'backoffice.vehicle.claim.claimant': 'Demandeur',
  'backoffice.vehicle.claim.target': 'Voiture enregistrée par l’autre compte',
  'backoffice.vehicle.claim.uphold': 'Accepter et libérer la voiture (administrateur)',
  'backoffice.vehicle.claim.dismiss': 'Rejeter avec un motif',
  'backoffice.vehicle.claim.reason.INSUFFICIENT_PROOF': 'Preuve insuffisante',
  'backoffice.vehicle.claim.reason.CLAIMANT_NOT_OWNER': 'Le demandeur n’est pas le propriétaire',
  'backoffice.vehicle.claim.done.UPHELD': 'Réclamation acceptée : la voiture a été libérée.',
  'backoffice.vehicle.claim.done.DISMISSED': 'Réclamation rejetée.',
  'backoffice.vehicle.purpose': 'Motif de la consultation',
  'web.listing.hostName': 'Hôte : {name}',
  'common.vehicleReview.dossierNotRead': 'Lis le dossier de la réclamation avant de décider.',
  'common.vehicleReview.noteRequired': 'Écris le motif de la décision (10 à 500 caractères).',
  'common.vehicleReview.checksFailed':
    'Un point de contrôle n’est pas conforme : rejette la réclamation.',
  'common.vehicleReview.targetReleased':
    'La voiture en cause a déjà été libérée : rejette cette réclamation.',
  'common.vehicleReview.targetBooked': {
    one: 'La voiture a {count} réservation en cours ou à venir : elle ne peut pas être libérée.',
    other: 'La voiture a {count} réservations en cours ou à venir : elle ne peut pas être libérée.',
  },
  'common.vehicleReview.sameAdmin':
    'Un autre administrateur doit décider : tu as déjà libéré cette plaque.',
  'common.vehicleDocs.confirmed': 'Voiture validée : tu peux la publier.',
  'web.vehicleDocs.declaration.owner':
    'Je suis propriétaire de la voiture ou le propriétaire m’autorise à la louer',
  'web.vehicleDocs.declaration.lienOk':
    'La voiture n’est pas gagée, ou j’ai l’accord écrit du créancier',
  'web.vehicleDocs.declaration.vin': 'Numéro de châssis (VIN)',
  'web.vehicleDocs.declaration.vinHint':
    'VIN de 17 caractères (ex. : 1HGCM82633A004352) ou numéro de châssis d’une voiture importée (ex. : GRJ150-0012345).',
  'common.vehicleDocs.vinInvalid':
    'Ce numéro de châssis n’est pas valide. Saisis le VIN de 17 caractères (sans I, O ni Q) ou le numéro de châssis de ta voiture importée, par exemple GRJ150-0012345.',
  'web.vehicleDocs.declaration.attested': 'Tu l’as déclaré le {date}.',
  'backoffice.catalog.specsPending': 'Fiche technique à compléter',
  // US-219 (ADR-128) : espace hôte, accueil A02 et réservations A05
  'common.hostTrips.notFound': 'Réservation introuvable.',
  'common.hostTrips.unavailable':
    'Tes réservations ne sont pas disponibles pour le moment. Réessaie dans quelques minutes.',
  'web.a02.empty': 'Pas encore de réservations. Ta voiture est déjà visible par les voyageurs.',
  'web.a02.upcoming.title': 'Prochaines remises',
  'web.a02.returns.title': 'Prochains retours',
  'web.a02.trips.all': 'Voir toutes mes réservations',
  'web.a05.heading': 'Mes réservations',
  'web.a05.intro': 'Prépare chaque remise : date, lieu et ce que tu peux voir du voyageur.',
  'web.a05.empty': 'Aucune réservation pour l’instant',
  'web.a05.tab.UPCOMING': 'À venir',
  'web.a05.tab.IN_PROGRESS': 'En cours',
  'web.a05.tab.DONE': 'Terminées',
  'web.a05.tab.CANCELLED': 'Annulées',
  'web.a05.tabs': 'État des réservations',
  'web.a05.filter.title': 'Filtrer',
  'web.a05.filter.vehicle': 'Voiture',
  'web.a05.filter.allVehicles': 'Toutes mes voitures',
  'web.a05.filter.from': 'Du',
  'web.a05.filter.to': 'Au',
  'web.a05.filter.apply': 'Appliquer les filtres',
  'web.a05.filter.invalid':
    'Vérifie les filtres : la date de fin ne peut pas précéder la date de début.',
  'web.a05.reference': 'Réservation n° {ref}',
  'web.a05.place': 'Remise à {place}',
  'web.a05.start': 'Remise : {date}',
  'web.a05.end': 'Retour : {date}',
  'web.a05.guest.title': 'Voyageur',
  'web.a05.guest.age': '{age} ans',
  'web.a05.guest.unverified': 'Identité non vérifiée',
  'web.a05.guest.noRating': 'Pas encore d’avis',
  'web.a05.guest.rating': 'Note : {rating}',
  'web.a05.guest.hidden': 'Données non disponibles',
  'web.a05.privacy':
    'Pour ta sécurité et celle du voyageur, tu ne vois jamais son permis ni ses pièces d’identité.',
  'web.a05.payment.CONFIRMED': 'Paiement confirmé',
  'web.a05.payment.REFUNDED_PARTIAL': 'Remboursée en partie',
  'web.a05.payment.REFUNDED': 'Remboursée',
  'web.a05.earnings': 'Gains estimés : {amount}',
  'web.a05.earnings.note':
    'Estimation selon ton plan ; le montant final apparaît dans tes gains après le trajet.',
  'web.a05.open': 'Voir la réservation',
  'web.a05.back': 'Retour à mes réservations',
  'web.a05.loadError': 'Impossible de charger tes réservations.',
  'web.a05.retry': 'Réessayer',
  // US-201 : recherche publique par zone, lieu, dates et heures (S01, S02 simplifié, S03)
  'common.search.locationRequired': 'Choisis où tu veux récupérer la voiture.',
  'common.search.datesInvalid':
    'Vérifie les dates : le retour doit suivre le départ, à l’heure pile ou à la demie, et le départ ne peut pas être passé.',
  'common.search.durationExceeded': 'Ce voyage est trop long. Choisis une durée plus courte.',
  'common.search.unavailable':
    'La recherche n’est pas disponible pour le moment. Réessaie dans quelques minutes.',
  'web.search.title': 'Chercher une voiture',
  'web.search.where': 'Où tu la récupères',
  'web.search.choosePlace': 'Choisis un lieu',
  'web.search.wholeCity': '{city} (toute la ville)',
  'web.search.from': 'Départ',
  'web.search.until': 'Retour',
  'web.search.date': 'Date',
  'web.search.time': 'Heure',
  'web.search.localTime': 'Les heures sont celles du lieu où tu récupères la voiture.',
  'web.search.go': 'Chercher des voitures',
  'web.search.noAreas.title': 'Pas de voiture à louer pour l’instant',
  'web.search.noAreas.body': 'Aucune voiture n’est encore disponible. Reviens plus tard.',
  'web.search.areasError': 'Nous n’avons pas pu charger les lieux.',
  'web.search.results.title': 'Voitures disponibles',
  'web.search.results.none': 'Aucune voiture disponible à ces dates',
  'web.search.results.none.body': 'Essaie d’autres dates ou une autre zone.',
  'web.search.result.period': 'Du {from} au {to}',
  'web.search.result.timezone': 'Heure locale de {city}',
  'web.search.loading': 'Recherche de voitures…',
  'web.search.result.open': 'Voir la voiture',
  'web.search.results.count': {
    one: '{count} voiture disponible',
    other: '{count} voitures disponibles',
  },
  'web.search.deposit.amount': 'Dépôt de garantie : {amount}, bloqué sur ta carte',
  'web.search.deposit.maybe':
    'Un dépôt de garantie peut être demandé selon le profil du conducteur.',
  'web.search.map.title': 'Carte des voitures',
  'web.search.map.sameAsList':
    'Les emplacements sont approximatifs. Les mêmes voitures et les mêmes prix sont dans la liste.',
  'web.search.map.marker': '{car}, {total} au total',
  'web.search.map.noPoint': 'Sans point sur la carte',
  'web.listing.dates.title': 'Tes dates',
  'web.listing.dates.change': 'Modifier la recherche',
  'common.listing.datesNoticeTooShort': {
    one: 'L’hôte demande au moins {count} heure de préavis. Choisis une heure de départ plus tardive.',
    other:
      'L’hôte demande au moins {count} heures de préavis. Choisis une heure de départ plus tardive.',
  },
  'common.listing.datesUnavailable':
    'Cette voiture n’est pas disponible à ces dates. Essaie d’autres dates.',
  'common.listing.meetingPointNotFound':
    'Aucune réservation confirmée de cette voiture sur ton compte.',
  'web.s03.photos': '{n} / {total} · photos prises par {host_name}',
  'web.listing.gallery.title': 'Photos de la voiture',
  'web.listing.gallery.photoAlt': '{car}, photo {n} sur {total}',
  'web.listing.gallery.broken': 'Photo indisponible',
  'web.listing.slot.title': 'Choisis tes dates',
  'web.listing.slot.check': 'Vérifier la disponibilité',
  'web.listing.slot.ok': 'Disponible à ces dates.',
  'web.listing.slot.error': 'Nous n’avons pas pu vérifier ces dates. Réessaie.',
  'web.listing.meet.exact.title': 'Adresse du rendez-vous',
  'web.listing.meet.exact.only':
    'Elle n’est visible que par toi : tu as une réservation confirmée de cette voiture.',
  'web.listing.meet.sameReturn': 'Tu rends la voiture au même endroit.',
  // US-205 (ADR-138) : conditions de la fiche S03 (annulation, distance, protection, caution)
  'web.listing.cancel.title': 'Annulation',
  'web.listing.cancel.until': 'Annulation gratuite jusqu’au {date}.',
  'web.listing.cancel.lastMinute': {
    one: 'Annulation gratuite pendant {count} heure après la réservation.',
    other: 'Annulation gratuite pendant {count} heures après la réservation.',
  },
  'web.listing.cancel.lead': {
    one: 'Annulation gratuite jusqu’à {count} heure avant le début du voyage.',
    other: 'Annulation gratuite jusqu’à {count} heures avant le début du voyage.',
  },
  'web.listing.cancel.late': {
    one: 'Si tu réserves moins de {count} heure à l’avance, elle est gratuite pendant {window} h après la réservation.',
    other:
      'Si tu réserves moins de {count} heures à l’avance, elle est gratuite pendant {window} h après la réservation.',
  },
  'web.listing.cancel.after':
    'Ensuite, une partie de la location est retenue selon la durée du voyage.',
  'web.listing.cancel.policyLink': 'Voir la politique d’annulation',
  'web.listing.cancel.unavailable':
    'Nous n’avons pas pu afficher la politique d’annulation. Vérifie-la avant de payer.',
  'web.listing.distance.title': 'Distance incluse',
  'web.listing.distance.total': { one: '{count} km inclus', other: '{count} km inclus' },
  'web.listing.distance.extra': 'Chaque km supplémentaire : {amount}',
  'web.listing.protection.title': 'Protection',
  'web.listing.protection.insurer':
    'La protection est vendue pour le compte de {insurer}, l’assureur partenaire, qui la couvre.',
  'web.listing.protection.license': 'Agrément de {name} : {ref}',
  'web.listing.protection.broker': 'Courtier en assurance : {broker}',
  'web.listing.protection.rc':
    'Responsabilité civile envers les tiers incluse à tous les niveaux : jusqu’à {amount} par événement.',
  'web.listing.protection.basic':
    'La protection de base est obligatoire et déjà comprise dans le prix final. Tu peux la renforcer en réservant.',
  'web.listing.protection.deductibles': 'Ce que tu paies pour un dommage couvert (franchise)',
  'web.listing.protection.noDeductible': 'Aucune franchise',
  'web.listing.protection.exclusions': 'Ce qui n’est pas couvert',
  'web.listing.protection.unavailable':
    'Cette voiture n’a pas encore de protection disponible : elle ne peut pas être réservée pour l’instant.',
  'web.listing.protection.error':
    'Nous n’avons pas pu charger la protection ni le dépôt de cette voiture. Réessaie.',
  // US-205b (ADR-140) : dernière minute en minutes, jusqu'au départ ; conditions du checkout S05
  'web.listing.cancel.untilStart': 'Annulation gratuite jusqu’au début du voyage ({date}).',
  'web.listing.cancel.lastMinuteMinutes': {
    one: 'Annulation gratuite pendant {count} minute après la réservation.',
    other: 'Annulation gratuite pendant {count} minutes après la réservation.',
  },
  'web.listing.cancel.lateMinutes': {
    one: 'Si tu réserves moins de {count} heure à l’avance, elle est gratuite pendant {window} min après la réservation.',
    other:
      'Si tu réserves moins de {count} heures à l’avance, elle est gratuite pendant {window} min après la réservation.',
  },
  'web.listing.protection.unavailableShort':
    'Cette voiture n’a pas encore de protection disponible.',
  'web.s05.conditions.title': 'Conditions du voyage',
  'web.s05.conditions.ifNow': 'Dates calculées si tu réserves maintenant, à l’heure du lieu.',
  'web.s05.cancel.retainedDay':
    'Ensuite, 1 jour de location est retenu, taxes comprises : {amount}.',
  'web.s05.cancel.retainedHalfDay':
    'Ensuite, une demi-journée de location est retenue, taxes comprises : {amount}.',
  'web.s05.cancel.ifCancelDay':
    'Si tu annules, 1 jour de location est retenu, taxes comprises : {amount}.',
  'web.s05.cancel.ifCancelHalfDay':
    'Si tu annules, une demi-journée de location est retenue, taxes comprises : {amount}.',
  // US-208 (ADR-133) : refus de la route du checkout (devis figé et pose du hold)
  'common.quote.notFound': 'Nous ne trouvons pas ce devis. Reviens à la fiche de la voiture.',
  'common.quote.rateLimited':
    'Tu as demandé beaucoup de prix en peu de temps. Attends quelques minutes et réessaie.',
  'common.quote.expired': 'Ce prix n’est plus valable. Voici le prix à jour.',
  'common.quote.lineNotSupported':
    'Cette option ne peut pas encore être réservée. Retire-la pour continuer.',
  'common.quote.protectionRequired':
    'Choisis une protection pour continuer : chaque voyage comprend au moins la protection de base.',
  'common.quote.protectionNotEligible':
    'Cette protection n’est pas disponible pour ce conducteur ou cette voiture. Choisis-en une autre.',
  'common.quote.insurerContractInactive':
    'La protection des voyages n’est pas encore disponible ici : on ne peut pas encore réserver.',
  'common.listing.earningsPlanSaved':
    'Plan de gains enregistré. Il s’applique aux voyages réservés à partir de maintenant ; les voyages déjà réservés gardent leur plan.',
  'common.listing.earningsPlanNotAvailable':
    'Ce plan de gains n’est pas disponible là où tu publies ta voiture. Choisis-en un dans la liste.',
  'common.quote.line.protection': 'Protection',
  'common.quote.line.protectionBasica': 'Protection de base',
  'common.quote.line.protectionEstandar': 'Protection standard',
  'common.quote.line.protectionTotal': 'Protection totale',
  'common.checkout.requestModeUnavailable':
    'Cette voiture se réserve sur demande à l’hôte, ce qui n’est pas encore possible. Choisis une autre voiture.',
  'common.checkout.manualNotConfirmed':
    'Cette voiture a une boîte manuelle. Confirme que tu sais la conduire pour continuer.',
  'common.checkout.driverMustBeAccountHolder':
    'Seul le titulaire du compte peut conduire. Écris ton nom comme sur ton compte.',
  'common.checkout.termsNotAccepted':
    'Accepte les conditions, la politique d’annulation et les zones de circulation pour réserver.',
  'common.checkout.quoteAlreadyUsed': 'Tu as déjà réservé à ce prix. Consulte ta réservation.',
  'common.checkout.holdNotFound': 'Nous ne trouvons pas cette réservation dans ton compte.',
  'common.checkout.noticeTooShort':
    'L’hôte a besoin de plus de préavis. Choisis une heure de début plus tardive.',
  'common.checkout.guestOverlap': 'Tu as déjà un trajet à ces dates. Choisis-en d’autres.',
  'common.checkout.holdAlreadyLive':
    'Tu es déjà en train de réserver cette voiture. Termine cette réservation ou attends quelques minutes.',
  'common.checkout.holdLimit':
    'Tu as trop de réservations en cours. Termines-en une avant d’en commencer une autre.',
  'common.checkout.holdRateLimited':
    'Tu as essayé de réserver cette voiture de nombreuses fois. Attends un peu et réessaie.',
  'common.checkout.accountRestricted':
    'Ton compte ne peut pas réserver pour le moment. Écris-nous pour en savoir plus.',
  'common.checkout.listingUnavailable':
    'Cette voiture ne peut pas être réservée pour le moment. Choisis-en une autre.',
  // US-209 (209a, ADR-135) : âge minimum de la classe (16 BKG-012)
  'common.checkout.ageClassMismatch':
    'Tu n’as pas l’âge minimum pour conduire cette voiture le jour où le voyage commence, ou ta date de naissance n’est pas vérifiée. Vérifie ton profil ou choisis une autre voiture.',
  'common.checkout.unavailable':
    'Nous ne pouvons pas prendre ta réservation pour le moment. Réessaie plus tard.',
  // US-208 (208b, ADR-134) : total de la fiche S03, checkout S05, hold posé
  'web.listing.total.title': 'Prix final',
  'web.listing.total.hint': 'Taxes et frais du voyage compris. Tu le confirmes à l’étape suivante.',
  'web.s05.title': 'Confirme ta réservation',
  'web.s05.intro':
    'Vérifie le voyage, saisis ton nom et accepte les conditions. Tu ne paies rien pour l’instant.',
  'web.s05.loading': 'Chargement de ta réservation…',
  'web.s05.error': 'Nous n’avons pas pu charger ta réservation. Réessaie.',
  'web.s05.notFound': 'Devis indisponible',
  'web.s05.priceChanged': 'Le prix a changé',
  'web.s05.summary.title': 'Ton voyage',
  'web.s05.summary.host': 'Voiture de {host_name}',
  'web.s05.summary.pickup': 'Prise en charge',
  'web.s05.summary.return': 'Retour',
  'web.s05.summary.place': 'Zone de remise',
  'web.s05.price.title': 'Prix',
  'web.s05.line.tripPrice': {
    one: 'Location · {count} jour',
    other: 'Location · {count} jours',
  },
  'web.s05.line.taxes': 'Taxes',
  'web.s05.validUntil': 'Prix garanti jusqu’à {time}.',
  'web.s05.expired.title': 'Ce prix n’est plus valable',
  'web.s05.expired.body': 'Demande le prix à jour pour ces dates avant de réserver.',
  'web.s05.expired.cta': 'Voir le prix à jour',
  'web.s05.driver.title': 'Conducteur',
  'web.s05.driver.hint':
    'Toi seul peux conduire cette voiture. Saisis ton nom tel qu’il figure sur ton compte.',
  'web.s05.driver.first': 'Prénom',
  'web.s05.driver.last': 'Nom',
  'web.s05.driver.firstRequired': 'Saisis ton prénom.',
  'web.s05.driver.lastRequired': 'Saisis ton nom.',
  'web.s05.manual': 'Je sais conduire une boîte manuelle',
  'web.s05.manual.hint': 'Cette voiture a une boîte manuelle.',
  'web.s05.terms.title': 'Documents que tu acceptes',
  'web.s05.terms.accept': 'J’accepte : {title}',
  'web.s05.terms.read': 'Lire « {title} », version {version} (s’ouvre dans un nouvel onglet)',
  'web.s05.hold.notice': 'Rien ne t’est débité pour l’instant.',
  'web.s05.hold.cta': 'Réserver pour {amount}',
  'web.s05.hold.missing': 'Saisis ton nom et coche chaque case pour continuer.',
  'web.s05.hold.title': 'Nous te gardons la voiture',
  'web.s05.hold.until': 'Nous te gardons cette voiture jusqu’à {time}',
  'web.s05.hold.ended':
    'Cette voiture n’est plus gardée pour toi. Retourne sur sa fiche pour réserver de nouveau.',
  'web.s05.hold.notFound': 'Réservation indisponible',
  'web.s05.hold.total': 'Total : {amount}',
  'web.s05.hold.documents': 'Tu as accepté',
  'web.s05.hold.accepted': '{document}, version {version}',
  // US-223 partie 223b (ADR-142) : paiement du hold (S05) et attente de la preuve (S06) ; refus
  // du paiement rendus par l'API (common.payment.*) ; aucune durée écrite (heures lues dans l'API)
  'common.payment.unavailable':
    'Le paiement en ligne n’est pas disponible pour le moment. Aucun débit n’a été effectué.',
  'common.payment.payoutRailUnavailable':
    'Nous ne pouvons pas encore encaisser de réservation pour cette voiture. Aucun débit n’a été effectué.',
  'common.payment.underReview':
    'Nous vérifions ta réservation avant tout débit. Nous te préviendrons quand tu pourras payer.',
  'common.payment.holdExpired':
    'Nous ne gardons plus cette voiture pour toi. Aucun débit n’a été effectué : relance une recherche.',
  'common.payment.holdNotPayable': 'Cette réservation ne peut plus être payée. Vérifie son état.',
  'common.payment.startPassed':
    'L’heure de début est passée : nous ne pouvons pas encaisser cette réservation. Aucun débit n’a été effectué.',
  'common.payment.attemptsExceeded':
    'Tu as atteint le nombre maximum de tentatives de paiement pour cette réservation. Aucun débit n’a été effectué.',
  'common.payment.methodUnavailable':
    'Ce moyen de paiement n’est pas disponible pour cette réservation.',
  'web.s05.cta': 'Payer {amount}',
  'web.s05.pay.title': 'Paie ta réservation',
  'web.s06.pre.leaving':
    'Tu vas payer {amount} sur une page sécurisée de notre prestataire de paiement.',
  'web.s06.status.title': 'État de ton paiement',
  'web.s06.verifying.title': 'Paiement en cours de vérification',
  'web.s06.verifying.body':
    'Cela prend en général moins d’une minute. Ne paie pas une seconde fois.',
  'web.s06.verifying.slow': 'Nous attendons toujours la confirmation de ta banque.',
  'web.s06.verifying.notify': 'Nous t’écrirons dès qu’il sera confirmé.',
  'web.s06.refresh': 'Actualiser l’état',
  'web.s06.reference': 'Numéro de réservation : {reference}',
  'web.s06.support': 'Contacter l’assistance',
  'web.s06.supportBody':
    'Garde ton numéro de réservation et écris-nous en l’indiquant. Si un débit a eu lieu et que la réservation n’est pas confirmée, nous te remboursons tout le paiement.',
  'web.s06.payAgain': 'Payer à nouveau',
  'web.s06.confirmed.title': 'Paiement confirmé !',
  'web.s06.confirmed.body':
    'Ta réservation est confirmée. La fiche de la voiture montre maintenant le lieu exact de remise.',
  'web.s06.confirmed.cta': 'Voir la voiture',
  'web.s06.declined.title': 'Paiement non effectué',
  'web.error.paymentDeclined':
    'Ta banque a refusé le paiement. Aucun débit n’a été effectué. Nous gardons ta réservation jusqu’à {hold_end_time} : essaie une autre carte.',
  'web.s06.ended.title': 'Réservation expirée',
  'web.s06.ended.body':
    'Nous ne gardons plus cette voiture pour toi. Aucun débit n’a été effectué.',
  'web.s06.unproven.title': 'Nous n’avons pas pu confirmer ton paiement',
  'web.s06.unproven.body': 'Ta réservation n’est pas confirmée. Ne paie pas une seconde fois.',
  'web.s06.refund.title': 'Nous te remboursons',
  'web.error.paidAfterRelease':
    'Nous avons reçu ton paiement, mais la voiture n’était plus réservée pour toi. Nous te remboursons {amount} en totalité ; voici des voitures à proximité.',
  'web.s05.doc.TOS_GUEST': 'Conditions générales',
  'web.s05.doc.CANCELLATION_POLICY': 'Politique d’annulation',
  'web.s05.doc.GEO_TERMS': 'Zones de circulation',
  'web.s05.back': 'Retour à la voiture',
  'web.legal.backCheckout': 'Retour à ta réservation',
  // US-226 partie 226b (ADR-137) : choix de la protection sur S05, mention « protection de base
  // incluse » des cartes et de la fiche, plan de gains de l'hôte (A11)
  'web.s05.protection.title': 'Choisis ta protection',
  'web.s05.protection.intro':
    'Chaque voyage comprend au moins la protection de base. Tu peux en choisir une plus complète : le prix se met à jour avant la réservation.',
  'web.s05.protection.legend': 'Niveau de protection',
  'web.s05.protection.price': '{daily} par jour · {total} au total',
  'web.s05.protection.minAge': 'Disponible dès {age} ans.',
  'web.s05.protection.ageNeeded': 'Indique ton âge pour la choisir.',
  'web.s05.protection.apply': 'Mettre à jour le prix',
  'web.s05.protection.unchanged':
    'Choisis une autre protection ou change ton âge pour mettre à jour le prix.',
  'web.s05.protection.updated':
    'Protection mise à jour. Vérifie le nouveau total avant de réserver.',
  'web.s05.age.label': 'Âge du conducteur',
  'web.s05.age.hint':
    'Il sert seulement à afficher les protections possibles. Indique l’âge réel de la personne qui conduit.',
  'web.s05.age.invalid': 'Écris ton âge en années, entre {min} et {max}.',
  'common.price.protectionIncluded': 'Protection de base incluse',
  'web.a11.plan.open': 'Plan de gains',
  'web.a11.plan.title': 'Plan de gains',
  'web.a11.plan.intro':
    'Ton plan fixe la part du prix de chaque voyage que tu reçois. Le voyageur paie à part les frais du voyage et sa protection.',
  'web.a11.plan.current': 'Plan actuel : {plan}',
  'web.a11.plan.option': '{plan} · tu reçois {share} % du prix',
  'web.a11.plan.default': 'Attribué par défaut. Tu peux le changer quand tu veux.',
  'web.a11.plan.chosen': 'Choisi par toi. Tu peux le changer quand tu veux.',
  'web.a11.plan.newTripsOnly':
    'Un changement s’applique aux voyages réservés à partir de maintenant ; les voyages déjà réservés gardent leur plan.',
  'web.a11.plan.only': 'Pour l’instant, c’est le seul plan proposé là où tu publies ta voiture.',
  'web.a11.plan.choose': 'Choisis ton plan',
  'web.a11.plan.save': 'Enregistrer le plan',
  'web.a11.plan.name.ESTANDAR': 'Standard',
  'web.a11.plan.name.other': 'Plan à {share} %',
  'web.a11.coverage.title': 'Ce que couvre ton plan',
  'web.a11.coverage.period':
    'Quand la protection de l’assureur partenaire sera active là où tu publies, ta voiture sera couverte pendant la période de chaque réservation.',
  'web.a11.coverage.contract':
    'Les exclusions et ta franchise viennent du contrat de l’assureur partenaire : nous les afficherons ici, mot pour mot, avant que tu puisses recevoir des voyages.',
} as const satisfies Readonly<Record<MessageKey, Message>>;
